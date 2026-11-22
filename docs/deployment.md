# Cloud deployment (Azure for Students)

Everything runs in one resource group, `rg-se4458-midterm` (Sweden Central), tag `se4458-midterm: tuition-assistant`.
No secret value is stored in this repository. Secrets are typed by the owner directly into the Azure portal.

## Resources

| Resource | Kind / size | Notes |
|---|---|---|
| `cae-se4458` + `law-se4458` | Container Apps (Express) environment + Log Analytics | |
| `pg-se4458-tuition-yasmin` | PostgreSQL Flexible Server 16, Burstable B1ms, 32 GiB | TLS verified (CA bundle in `api/certs`); firewall "Allow Azure services" |
| `tuition-api` | Container App, 0.25 vCPU / 0.5 GiB, min 0 / max 1 replica, **external** ingress, port 3000 | image `ghcr.io/yasminmlgr/tuition-api:latest` |
| `tuition-mcp` | Container App, 0.25 vCPU / 0.5 GiB, min 0 / max 1, **external** ingress (HTTPS only) + `MCP_AUTH_TOKEN`, port 3100 | image `ghcr.io/yasminmlgr/tuition-mcp:latest` |
| `apim-se4458-tuition-yasmin` | API Management **Consumption** tier | gateway `https://apim-se4458-tuition-yasmin.azure-api.net` |
| `tuition-agent` | Container App, 0.25 vCPU / 0.5 GiB, min 0 / max 1, external ingress, port 3200 | image `ghcr.io/yasminmlgr/tuition-agent:<commit SHA>` |

Images are built by `.github/workflows/build-images.yml` and published to GitHub Container Registry (public packages), tagged `latest` **and** with the commit SHA.
Azure did not re-pull a changed `:latest` tag for the agent, so the agent is deployed with the immutable commit-SHA tag.
Scale-to-zero keeps the cost near zero; the first request after idle time is a cold start (the API applies the schema and seed on start-up).

## Secrets and environment variables

`tuition-api` (secret refs are bound with "Reference a secret"):

| Env var | Source |
|---|---|
| `DATABASE_URL` | secret `db-url` (PostgreSQL connection string, `sslmode`/TLS on) |
| `JWT_SECRET` | secret `jwt-secret` |
| `GATEWAY_SECRET` | secret `gateway-secret` |
| `SEED_STUDENT_PASSWORD`, `SEED_ADMIN_PASSWORD` | secrets `seed-student-password`, `seed-admin-password` |
| `DATABASE_SSL=true`, `SEED_DEMO_DATA=true` | plain values |

API Management **Named Values** (both *secret* type): `gateway-secret` (must equal the API's `GATEWAY_SECRET`) and
`jwt-signing-key-b64` (Base64 of the exact `JWT_SECRET` string; `validate-jwt` uses it for HS256).

`tuition-mcp`: `MCP_AUTH_TOKEN` = secret `mcp-auth-token` (long random alphanumeric value typed by the owner).

`tuition-agent`:

| Env var | Value |
|---|---|
| `GATEWAY_URL` | `https://apim-se4458-tuition-yasmin.azure-api.net` (no trailing slash, no `/api/v1`) |
| `MCP_URL` | `https://tuition-mcp.icyfield-a4e76f6b.swedencentral.azurecontainerapps.io/mcp` |
| `MCP_AUTH_TOKEN` | secret `mcp-auth-token` (same value as on `tuition-mcp`) |
| `GEMINI_API_KEY` | secret `gemini-api-key` (typed by the owner; revoke the key after grading) |
| `LLM_MODEL` | `gemini-3.5-flash-lite` |
| `BUILD_REF` | short commit SHA; only used to force a new revision |

## Why the MCP app has external ingress

The first attempt used internal ingress. In this Container Apps **Express** environment it did not work: from inside the agent container the MCP FQDN
(`tuition-mcp.icyfield-...azurecontainerapps.io`, ingress `external: false`, target port 3100) resolved to the environment's public address and both
`GET /health` and `POST /mcp` returned `404 {"error":"Not found"}` from the environment proxy; the MCP container never received the request.
The `.internal` host name used first did not resolve. A Microsoft Q&A answer states that Express app-to-app calls use the apps' public URLs instead of internal service
discovery (community answer, not verified against product documentation). Decision (approved by the owner): external ingress, HTTPS only, target port 3100, protected by
`MCP_AUTH_TOKEN`. The MCP server only serves policy text. The MCP path stays separate from the API gateway path.

## Gateway policy

[`gateway/apim-api-policy.xml`](../gateway/apim-api-policy.xml) is applied at API level ("All operations") of the imported `tuition-api`:
it overrides `X-Gateway-Secret`, leaves login/health/mobile-query public, and requires a valid JWT (admin role for `/api/v1/admin/*`).
The file matches the policy saved in Azure (child element order `issuer-signing-keys`, `audiences`, `issuers`, `required-claims` is mandatory).
Subscription key is not required. APIM Consumption has no `rate-limit-by-key` with a daily window, so the 3-calls-per-day rule lives in the API.

## Verification commands

Replace `<TOKEN>` with a JWT obtained from the login call (type the password yourself; do not paste it into shared logs):

```bash
GW=https://apim-se4458-tuition-yasmin.azure-api.net
curl -i $GW/api/v1/health                                   # expect 200
curl -i -X POST $GW/api/v1/auth/login -H 'Content-Type: application/json' \
     -d '{"username":"20260001","password":"<student password>"}'   # expect 200 + accessToken
curl -i $GW/api/v1/tuition/20260001 -H "Authorization: Bearer <TOKEN>" # expect 200
curl -i $GW/api/v1/tuition/20260001 -H "Authorization: Bearer invalid" # expect 401
curl -i https://tuition-api.<environment-default-domain>/api/v1/health # direct, no gateway secret: expect 403 GATEWAY_REQUIRED
```

## Verified (22-23 Nov 2026)

Gateway tests (browser-based test page run by the owner, passwords typed by the owner):

| Test | Result |
|---|---|
| Student login via gateway | 200 |
| Own tuition with valid JWT | 200 |
| Another student's tuition with a valid JWT | 403 |
| Invalid JWT | 401 |
| No JWT | 401 |
| Student JWT on an admin route | 401 (gateway `validate-jwt` role check) |
| Admin login | 200 |
| Admin JWT on an admin route | 200 |
| Mobile query (no auth) | 200 |
| Direct API call without the gateway secret | 403 `GATEWAY_REQUIRED` |

Agent and MCP (deployed):
- `tuition-agent` `/health` → `{"status":"ok","thoughtSignatureEcho":true}` on the revision running image tag `4c2c3e33d652d9d1f058d5f2735d0a3b08a8a13b` (the marker only proves the deployed image contains the fix).
- From the agent container (token read from the environment, never printed): `POST /mcp` without a token → **401**; with the token `tools/list` → 200 (`search_tuition_policies`) and `search_tuition_policies("Fall tuition payment deadline")` → 200 with section 8.1 (September 30, 2026; see 2.1).
- Through the agent chat (owner's manual run): deadline, installments (3.2, 3.3, 3.4) and early-withdrawal refund (6.1, 6.2, 6.3) retrievals; balance 3000 USD via the gateway; combined MCP + REST answer;
  500 USD payment: explicit confirmation requested, after "yes" `POST /api/v1/tuition/payments` → 201, `GET /api/v1/tuition/20260001` → 200 with balance 2500 USD; no Gemini `thought_signature` error.

## Problems found and fixed (for reproducibility)

1. **Gateway returned an empty HTTP 400** for forwarded requests. Cause: the stored `gateway-secret` Named Value produced an invalid HTTP header value (replacing `{{gateway-secret}}` with a literal made the request reach the API).
   Fix: the secret was re-entered as a plain letters-and-digits value in both APIM and the Container App. Use only `[A-Za-z0-9]` for `GATEWAY_SECRET`.
2. **Gemini `503 UNAVAILABLE`** with `gemini-flash-latest`: switched `LLM_MODEL` to `gemini-3.5-flash-lite`.
3. **Gemini `400 ... missing a thought_signature`**: the agent now returns `extra_content` of each tool call to the model.
4. **MCP unreachable** through internal ingress: see "Why the MCP app has external ingress".
5. **Image not refreshed** for `:latest`: deploy by commit-SHA tag.

## Cleanup after grading

Delete the resource group `rg-se4458-midterm` (stops all charges), revoke the Gemini API key and rotate any shared secrets.
