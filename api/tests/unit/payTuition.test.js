const { buildTestApp } = require("./helpers");

const pay = (api, headers, body) => api.post("/api/v1/tuition/payments").set(headers).send(body);

describe("POST /api/v1/tuition/payments (Pay Tuition)", () => {
  test("records a partial payment and keeps the remaining balance", async () => {
    const { api, bearer } = buildTestApp();
    const res = await pay(api, await bearer("20260001"), {
      studentNo: "20260001",
      term: "2026-FALL",
      amount: 500,
      transactionId: "TX-1",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: "SUCCESS",
      transactionId: "TX-1",
      paidAmount: 500,
      totalPaid: 500,
      remainingBalance: 2500,
    });
    const after = await api.get("/api/v1/tuition/20260001?term=2026-FALL").set(await bearer("20260001"));
    expect(after.body.balance).toBe(2500);
  });

  test("accepts a full payment that brings the balance to zero", async () => {
    const { api, bearer } = buildTestApp();
    const res = await pay(api, await bearer("20260002"), {
      studentNo: "20260002",
      term: "2026-FALL",
      amount: "2000.00",
      transactionId: "TX-FULL",
    });
    expect(res.status).toBe(201);
    expect(res.body.remainingBalance).toBe(0);
  });

  test("rejects a duplicate transaction ID with 409 and does not change the balance", async () => {
    const { api, bearer } = buildTestApp();
    const headers = await bearer("20260001");
    const body = { studentNo: "20260001", term: "2026-FALL", amount: 100, transactionId: "TX-DUP" };
    expect((await pay(api, headers, body)).status).toBe(201);
    const second = await pay(api, headers, body);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("DUPLICATE_TRANSACTION");
    const after = await api.get("/api/v1/tuition/20260001?term=2026-FALL").set(headers);
    expect(after.body.balance).toBe(2900);
  });

  test("rejects an amount above the outstanding balance with 422", async () => {
    const { api, bearer } = buildTestApp();
    const res = await pay(api, await bearer("20260002"), {
      studentNo: "20260002",
      term: "2026-FALL",
      amount: 2000.01,
      transactionId: "TX-OVER",
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("AMOUNT_EXCEEDS_BALANCE");
  });

  test("rejects a payment for a term that is already fully paid", async () => {
    const { api, bearer } = buildTestApp();
    const headers = await bearer("20260002");
    const full = await pay(api, headers, { studentNo: "20260002", term: "2026-FALL", amount: 2000, transactionId: "TX-A" });
    expect(full.status).toBe(201);
    const again = await pay(api, headers, { studentNo: "20260002", term: "2026-FALL", amount: 1, transactionId: "TX-B" });
    expect(again.status).toBe(422);
    expect(again.body.error.message).toMatch(/no outstanding balance/);
  });

  test.each([
    ["zero", 0],
    ["negative", -5],
    ["too many decimals", 10.123],
    ["text", "abc"],
    ["missing", undefined],
  ])("rejects an invalid amount (%s) with 400", async (_label, amount) => {
    const { api, bearer } = buildTestApp();
    const res = await pay(api, await bearer("20260001"), {
      studentNo: "20260001",
      term: "2026-FALL",
      amount,
      transactionId: "TX-BAD",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  test("rejects a missing transaction ID and a bad term with 400", async () => {
    const { api, bearer } = buildTestApp();
    const headers = await bearer("20260001");
    expect((await pay(api, headers, { studentNo: "20260001", term: "2026-FALL", amount: 10 })).body.error.code).toBe(
      "INVALID_TRANSACTION_ID"
    );
    expect(
      (await pay(api, headers, { studentNo: "20260001", term: "x", amount: 10, transactionId: "T" })).body.error.code
    ).toBe("INVALID_TERM");
  });

  test("returns 404 when the student has no tuition for that term", async () => {
    const { api, bearer } = buildTestApp();
    const res = await pay(api, await bearer("20260001"), {
      studentNo: "20260001",
      term: "2027-SPRING",
      amount: 10,
      transactionId: "TX-NF",
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TUITION_NOT_FOUND");
  });

  test("a student cannot pay on behalf of another student (identity comes from the token)", async () => {
    const { api, bearer } = buildTestApp();
    const res = await pay(api, await bearer("20260001"), {
      studentNo: "20260002",
      term: "2026-FALL",
      amount: 10,
      transactionId: "TX-X",
    });
    expect(res.status).toBe(403);
  });

  test("requires authentication, and admins cannot submit payments", async () => {
    const { api, bearer } = buildTestApp();
    const body = { studentNo: "20260001", term: "2026-FALL", amount: 10, transactionId: "TX-N" };
    expect((await api.post("/api/v1/tuition/payments").send(body)).status).toBe(401);
    expect((await pay(api, await bearer("admin"), body)).status).toBe(403);
  });
});
