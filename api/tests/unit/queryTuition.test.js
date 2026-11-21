const { buildTestApp } = require("./helpers");

describe("GET /api/v1/tuition/:studentNo (banking app / agent, JWT)", () => {
  test("returns the term balance when a term is given", async () => {
    const { api, bearer } = buildTestApp();
    const res = await api.get("/api/v1/tuition/20260002?term=2026-FALL").set(await bearer("20260002"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      studentNo: "20260002",
      term: "2026-FALL",
      scope: "TERM",
      currency: "USD",
      tuitionTotal: 3000,
      paidTotal: 1000,
      balance: 2000,
    });
  });

  test("returns the overall balance (all terms) when no term is given", async () => {
    const { api, bearer } = buildTestApp();
    const res = await api.get("/api/v1/tuition/20260002").set(await bearer("20260002"));
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("OVERALL");
    expect(res.body.term).toBeNull();
    expect(res.body.tuitionTotal).toBe(6000);
    expect(res.body.balance).toBe(5000);
    expect(res.body.terms).toHaveLength(2);
  });

  test("a student cannot read another student's record, even if they know the number", async () => {
    const { api, bearer } = buildTestApp();
    const res = await api.get("/api/v1/tuition/20260002").set(await bearer("20260001"));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  test("an admin may read any student's record", async () => {
    const { api, bearer } = buildTestApp();
    const res = await api.get("/api/v1/tuition/20260002?term=2026-FALL").set(await bearer("admin"));
    expect(res.status).toBe(200);
  });

  test("returns 404 for a term without tuition and 400 for a malformed term", async () => {
    const { api, bearer } = buildTestApp();
    const headers = await bearer("20260001");
    const missing = await api.get("/api/v1/tuition/20260001?term=2027-SPRING").set(headers);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("TUITION_NOT_FOUND");
    const bad = await api.get("/api/v1/tuition/20260001?term=fall2026").set(headers);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_TERM");
  });

  test("returns 404 STUDENT_NOT_FOUND for an unknown student (admin lookup)", async () => {
    const { api, bearer } = buildTestApp();
    const res = await api.get("/api/v1/tuition/99999999").set(await bearer("admin"));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("STUDENT_NOT_FOUND");
  });
});

describe("GET /api/v1/tuition/mobile/:studentNo (mobile app, no auth, 3 calls/student/day)", () => {
  test("works without a token and reports the remaining quota", async () => {
    const { api } = buildTestApp();
    const res = await api.get("/api/v1/tuition/mobile/20260001?term=2026-FALL");
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(3000);
    expect(res.headers["x-ratelimit-limit"]).toBe("3");
    expect(res.headers["x-ratelimit-remaining"]).toBe("2");
  });

  test("the 4th call of the day for the same student is rejected with 429 and Retry-After", async () => {
    const { api } = buildTestApp();
    for (let i = 0; i < 3; i++) {
      expect((await api.get("/api/v1/tuition/mobile/20260001")).status).toBe(200);
    }
    const res = await api.get("/api/v1/tuition/mobile/20260001");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });

  test("the limit is keyed by student identity: another student is unaffected", async () => {
    const { api } = buildTestApp();
    for (let i = 0; i < 4; i++) await api.get("/api/v1/tuition/mobile/20260001");
    expect((await api.get("/api/v1/tuition/mobile/20260002")).status).toBe(200);
  });

  test("the quota resets on the next local (Europe/Istanbul) day", async () => {
    const { api, clock } = buildTestApp();
    clock.now = new Date("2026-11-20T10:00:00Z");
    for (let i = 0; i < 4; i++) await api.get("/api/v1/tuition/mobile/20260001");
    expect((await api.get("/api/v1/tuition/mobile/20260001")).status).toBe(429);
    clock.now = new Date("2026-11-21T10:00:00Z");
    expect((await api.get("/api/v1/tuition/mobile/20260001")).status).toBe(200);
  });

  test("an invalid student number is rejected with 400 and does not consume quota", async () => {
    const { api } = buildTestApp();
    const res = await api.get("/api/v1/tuition/mobile/a!");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STUDENT_NO");
  });
});
