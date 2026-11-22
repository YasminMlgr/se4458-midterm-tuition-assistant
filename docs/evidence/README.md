# Evidence files

Put these files here (PNG screenshots or text). **No passwords, JWTs, tokens, API keys or `X-Gateway-Secret` may be visible** - crop or blur them.

| File | Must show |
|---|---|
| `01-agent-mcp-only-deadline.png` | Agent chat: "When is the Fall tuition deadline?" with the Tool Trace (`search_tuition_policies`, input, matches, final answer with section numbers) |
| `02-agent-api-only-balance.png` | "What is my current tuition balance?" with Tool Trace (`get_my_tuition`, HTTP 200, 3000 USD) |
| `03-agent-combined-installments.png` | "Can I pay in installments, and how much do I owe?" with Tool Trace showing both `search_tuition_policies` and `get_my_tuition` |
| `04-agent-payment-confirmation-prompt.png` | Payment request (500 USD): the agent asks for explicit confirmation, nothing charged yet |
| `05-agent-payment-201-balance-2500.png` | After "yes": `POST /api/v1/tuition/payments` 201 and `GET /api/v1/tuition/20260001` 200 with balance 2500 USD |
| `06-mcp-retrieval-deadline.png` | MCP retrieval test 1 on the deployed system (deadline; sections 8.1 / 2.1) |
| `07-mcp-retrieval-installments.png` | MCP retrieval test 2 (installments; sections 3.2, 3.3, 3.4) |
| `08-mcp-retrieval-refund.png` | MCP retrieval test 3 (early-withdrawal refund; sections 6.1, 6.2, 6.3) |
| `09-gateway-protected-401-without-jwt.png` | Gateway URL: protected route without JWT → 401 (the gateway error response) |
| `10-gateway-protected-200-with-jwt.png` | Same route with a valid JWT → 200 (hide the token) |
| `11-gateway-direct-backend-403.png` | Direct call to the API `/api/v1/...` without the gateway secret → 403 `GATEWAY_REQUIRED` |
| `12-unit-tests-api.txt` | Output of `cd api && npm test` |
| `13-unit-tests-mcp.txt` | Output of `cd mcp-server && npm test` |
| `14-unit-tests-agent.txt` | Output of `cd agent && npm test` |
| `15-azure-resources.png` | Azure portal: resource group `rg-se4458-midterm` with the Container Apps environment, three apps, PostgreSQL and API Management |
| `16-swagger-ui.png` | Swagger UI of the Tuition API |

Already in the repository: `mcp-retrieval-local.md` (the three retrieval queries run locally before deployment; labelled as a local run, not a deployed test).

Capture the text outputs with e.g. `npm test 2>&1 | tee ../docs/evidence/12-unit-tests-api.txt`.
