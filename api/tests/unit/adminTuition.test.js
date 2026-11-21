const { buildTestApp } = require("./helpers");

const addTuition = (api, headers, body) => api.post("/api/v1/admin/tuition").set(headers).send(body);

describe("POST /api/v1/admin/tuition (Add Tuition)", () => {
  test("creates a new tuition record (201 CREATED)", async () => {
    const { api, bearer, repo } = buildTestApp();
    const res = await addTuition(api, await bearer("admin"), {
      studentNo: "20269999",
      term: "2027-spring",
      amount: 4200.5,
      currency: "usd",
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ status: "CREATED", studentNo: "20269999", term: "2027-SPRING", amount: 4200.5, currency: "USD" });
    expect(await repo.getStudent("20269999")).not.toBeNull(); // student auto-registered
  });

  test("a second call for the same student and term updates the amount (200 UPDATED)", async () => {
    const { api, bearer } = buildTestApp();
    const headers = await bearer("admin");
    const res = await addTuition(api, headers, { studentNo: "20260001", term: "2026-FALL", amount: 3500, currency: "USD" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("UPDATED");
    const q = await api.get("/api/v1/tuition/20260001?term=2026-FALL").set(headers);
    expect(q.body.tuitionTotal).toBe(3500);
  });

  test("rejects lowering the amount below what was already paid (409)", async () => {
    const { api, bearer } = buildTestApp();
    const res = await addTuition(api, await bearer("admin"), {
      studentNo: "20260002",
      term: "2026-FALL",
      amount: 500, // $1000 already paid
      currency: "USD",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("AMOUNT_BELOW_PAID");
  });

  test("rejects a currency that differs from the student's other terms (409)", async () => {
    const { api, bearer } = buildTestApp();
    const res = await addTuition(api, await bearer("admin"), {
      studentNo: "20260001",
      term: "2027-SPRING",
      amount: 100,
      currency: "EUR",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CURRENCY_MISMATCH");
  });

  test.each([
    [{ studentNo: "", term: "2026-FALL", amount: 1, currency: "USD" }, "INVALID_STUDENT_NO"],
    [{ studentNo: "20260001", term: "FALL", amount: 1, currency: "USD" }, "INVALID_TERM"],
    [{ studentNo: "20260001", term: "2026-FALL", amount: -1, currency: "USD" }, "INVALID_AMOUNT"],
    [{ studentNo: "20260001", term: "2026-FALL", amount: 1, currency: "GBP" }, "INVALID_CURRENCY"],
  ])("rejects invalid input %#", async (body, code) => {
    const { api, bearer } = buildTestApp();
    const res = await addTuition(api, await bearer("admin"), body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });

  test("is admin-only: 401 without a token, 403 for a student", async () => {
    const { api, bearer } = buildTestApp();
    const body = { studentNo: "20260001", term: "2026-FALL", amount: 1, currency: "USD" };
    expect((await api.post("/api/v1/admin/tuition").send(body)).status).toBe(401);
    expect((await addTuition(api, await bearer("20260001"), body)).status).toBe(403);
  });
});

describe("POST /api/v1/admin/tuition/batch (Add Tuition - Batch)", () => {
  const post = (api, headers, csv) => api.post("/api/v1/admin/tuition/batch").set(headers).set("Content-Type", "text/csv").send(csv);

  test("processes all valid rows and reports counts", async () => {
    const { api, bearer } = buildTestApp();
    const csv = "studentNo,term,amount,currency\n30000001,2026-FALL,3000,USD\n30000002,2026-FALL,2500.50,USD\r\n";
    const res = await post(api, await bearer("admin"), csv);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "COMPLETED", total: 2, succeeded: 2, failed: 0 });
    expect(res.body.results.map((r) => r.status)).toEqual(["CREATED", "CREATED"]);
  });

  test("reports partial success: a bad row does not block the others", async () => {
    const { api, bearer } = buildTestApp();
    const csv = [
      "studentNo,term,amount,currency",
      "30000003,2026-FALL,1000,USD",
      "30000004,2026-FALL,abc,USD", // bad amount
      "30000005,BADTERM,1000,USD", // bad term
      "20260001,2026-FALL,3200,USD", // update of an existing record
      "30000006,2026-FALL,1000", // missing column
    ].join("\n");
    const res = await post(api, await bearer("admin"), csv);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "PARTIALLY_COMPLETED", total: 5, succeeded: 2, failed: 3 });
    expect(res.body.results[1]).toMatchObject({ line: 3, status: "FAILED", errorCode: "INVALID_AMOUNT" });
    expect(res.body.results[2].errorCode).toBe("INVALID_TERM");
    expect(res.body.results[3].status).toBe("UPDATED");
    expect(res.body.results[4].errorCode).toBe("INVALID_ROW");
  });

  test("rejects a wrong header, an empty file and a header-only file with 400", async () => {
    const { api, bearer } = buildTestApp();
    const headers = await bearer("admin");
    expect((await post(api, headers, "id,term,amount,currency\n1,2026-FALL,1,USD")).body.error.code).toBe("INVALID_CSV_HEADER");
    expect((await post(api, headers, "")).status).toBe(400);
    expect((await post(api, headers, "studentNo,term,amount,currency\n")).body.error.code).toBe("EMPTY_BATCH");
  });

  test("rejects more rows than the configured maximum with 413", async () => {
    const { api, bearer, config } = buildTestApp();
    const rows = Array.from({ length: config.batchMaxRows + 1 }, (_, i) => `4${String(i).padStart(7, "0")},2026-FALL,100,USD`);
    const res = await post(api, await bearer("admin"), ["studentNo,term,amount,currency", ...rows].join("\n"));
    expect(res.status).toBe(413);
  });

  test("is admin-only", async () => {
    const { api, bearer } = buildTestApp();
    const csv = "studentNo,term,amount,currency\n30000001,2026-FALL,3000,USD";
    expect((await post(api, await bearer("20260001"), csv)).status).toBe(403);
    expect((await api.post("/api/v1/admin/tuition/batch").set("Content-Type", "text/csv").send(csv)).status).toBe(401);
  });
});

describe("GET /api/v1/admin/tuition/unpaid (Unpaid Tuition Status)", () => {
  test("lists only students with an outstanding balance, largest first, with paging metadata", async () => {
    const { api, bearer } = buildTestApp();
    const res = await api.get("/api/v1/admin/tuition/unpaid?term=2026-FALL").set(await bearer("admin"));
    expect(res.status).toBe(200);
    // 20260003 is fully paid -> excluded
    expect(res.body.items.map((i) => [i.studentNo, i.balance])).toEqual([
      ["20260001", 3000],
      ["20260002", 2000],
    ]);
    expect(res.body).toMatchObject({ term: "2026-FALL", page: 1, pageSize: 20, totalItems: 2, totalPages: 1 });
  });

  test("paginates results", async () => {
    const { api, bearer } = buildTestApp();
    const headers = await bearer("admin");
    const p1 = await api.get("/api/v1/admin/tuition/unpaid?term=2026-FALL&page=1&pageSize=1").set(headers);
    const p2 = await api.get("/api/v1/admin/tuition/unpaid?term=2026-FALL&page=2&pageSize=1").set(headers);
    const p3 = await api.get("/api/v1/admin/tuition/unpaid?term=2026-FALL&page=3&pageSize=1").set(headers);
    expect(p1.body.items.map((i) => i.studentNo)).toEqual(["20260001"]);
    expect(p2.body.items.map((i) => i.studentNo)).toEqual(["20260002"]);
    expect(p1.body).toMatchObject({ totalItems: 2, totalPages: 2 });
    expect(p3.body.items).toEqual([]);
  });

  test.each([
    ["", "INVALID_TERM"],
    ["?term=2026-FALL&page=0", "INVALID_PAGING"],
    ["?term=2026-FALL&pageSize=101", "INVALID_PAGING"],
    ["?term=2026-FALL&page=abc", "INVALID_PAGING"],
  ])("rejects bad query %j with 400", async (query, code) => {
    const { api, bearer } = buildTestApp();
    const res = await api.get(`/api/v1/admin/tuition/unpaid${query}`).set(await bearer("admin"));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });

  test("is admin-only", async () => {
    const { api, bearer } = buildTestApp();
    expect((await api.get("/api/v1/admin/tuition/unpaid?term=2026-FALL")).status).toBe(401);
    expect((await api.get("/api/v1/admin/tuition/unpaid?term=2026-FALL").set(await bearer("20260001"))).status).toBe(403);
  });
});
