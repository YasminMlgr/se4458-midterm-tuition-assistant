const { buildTestApp } = require("./helpers");

describe("gateway-only access (GATEWAY_SECRET configured)", () => {
  test("API calls that bypass the gateway are rejected with 403", async () => {
    const { api } = buildTestApp({ GATEWAY_SECRET: "gw-secret" });
    const res = await api.post("/api/v1/auth/login").send({ username: "20260001", password: "Pass123!" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("GATEWAY_REQUIRED");
    expect((await api.get("/api/v1/tuition/mobile/20260001").set("X-Gateway-Secret", "wrong")).status).toBe(403);
  });

  test("calls carrying the gateway secret are served normally", async () => {
    const { api } = buildTestApp({ GATEWAY_SECRET: "gw-secret" });
    const login = await api.post("/api/v1/auth/login").set("X-Gateway-Secret", "gw-secret").send({ username: "20260001", password: "Pass123!" });
    expect(login.status).toBe(200);
    const res = await api.get("/api/v1/tuition/20260001?term=2026-FALL").set("X-Gateway-Secret", "gw-secret").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
  });

  test("documentation and health stay reachable without the secret", async () => {
    const { api } = buildTestApp({ GATEWAY_SECRET: "gw-secret" });
    expect((await api.get("/health")).status).toBe(200);
    expect((await api.get("/openapi.json")).status).toBe(200);
  });
});
