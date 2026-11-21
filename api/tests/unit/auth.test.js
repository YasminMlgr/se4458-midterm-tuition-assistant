const { buildTestApp } = require("./helpers");

describe("POST /api/v1/auth/login", () => {
  test("returns a bearer token for valid credentials", async () => {
    const { api } = buildTestApp();
    const res = await api.post("/api/v1/auth/login").send({ username: "20260001", password: "Pass123!" });
    expect(res.status).toBe(200);
    expect(res.body.tokenType).toBe("Bearer");
    expect(res.body.role).toBe("student");
    expect(res.body.accessToken.split(".")).toHaveLength(3);
  });

  test("rejects a wrong password with 401 and a generic message", async () => {
    const { api } = buildTestApp();
    const res = await api.post("/api/v1/auth/login").send({ username: "20260001", password: "nope" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  test("rejects an unknown user exactly like a wrong password", async () => {
    const { api } = buildTestApp();
    const res = await api.post("/api/v1/auth/login").send({ username: "ghost", password: "Pass123!" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  test("rejects a body without credentials with 400", async () => {
    const { api } = buildTestApp();
    const res = await api.post("/api/v1/auth/login").send({});
    expect(res.status).toBe(400);
  });

  test("protected routes reject missing, malformed and tampered tokens", async () => {
    const { api, bearer } = buildTestApp();
    expect((await api.get("/api/v1/tuition/20260001")).status).toBe(401);
    expect((await api.get("/api/v1/tuition/20260001").set("Authorization", "Bearer garbage")).status).toBe(401);
    const good = (await bearer("20260001")).Authorization;
    const tampered = good.slice(0, -2) + (good.endsWith("aa") ? "bb" : "aa");
    expect((await api.get("/api/v1/tuition/20260001").set("Authorization", tampered)).status).toBe(401);
  });
});
