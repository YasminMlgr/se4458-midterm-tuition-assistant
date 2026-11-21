/**
 * Integration tests against a REAL PostgreSQL server (the same code path used in production).
 * Run:  DATABASE_URL=postgres://user@host:5432/tuition_test npm run test:integration
 * The target database is wiped and re-created by this test - never point it at real data.
 */
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const request = require("supertest");
const { Pool } = require("pg");
const { loadConfig } = require("../../src/config");
const { createApp } = require("../../src/app");
const { PgRepository } = require("../../src/repositories/pgRepository");

const DATABASE_URL = process.env.DATABASE_URL;
const describeIf = DATABASE_URL ? describe : describe.skip;

describeIf("Tuition API on PostgreSQL", () => {
  let pool, api;
  const tokens = {};

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 20 });
    await pool.query("DROP TABLE IF EXISTS query_log, payments, tuitions, users, students CASCADE");
    await pool.query(fs.readFileSync(path.join(__dirname, "../../db/schema.sql"), "utf8"));

    const hash = bcrypt.hashSync("Pass123!", 4);
    for (const no of ["20260001", "20260002"]) {
      await pool.query("INSERT INTO students (student_no, full_name) VALUES ($1, $1)", [no]);
      await pool.query("INSERT INTO users (username, password_hash, role, student_no) VALUES ($1, $2, 'student', $1)", [no, hash]);
    }
    await pool.query("INSERT INTO users (username, password_hash, role) VALUES ('admin', $1, 'admin')", [hash]);
    await pool.query("INSERT INTO tuitions (student_no, term, amount, currency) VALUES ('20260001','2026-FALL',3000,'USD'),('20260002','2026-FALL',3000,'USD')");
    await pool.query("INSERT INTO payments (transaction_id, student_no, term, amount) VALUES ('SEED-1','20260002','2026-FALL',1000)");

    const config = loadConfig({ NODE_ENV: "test", JWT_SECRET: "test-secret" });
    api = request(createApp({ repo: new PgRepository(pool), config, logger: { log() {}, error() {} } }));
    for (const u of ["20260001", "20260002", "admin"]) {
      tokens[u] = (await api.post("/api/v1/auth/login").send({ username: u, password: "Pass123!" })).body.accessToken;
    }
  });
  afterAll(async () => pool && pool.end());

  const as = (u) => ({ Authorization: `Bearer ${tokens[u]}` });

  test("query returns term and overall figures from SQL aggregates", async () => {
    const term = await api.get("/api/v1/tuition/20260002?term=2026-FALL").set(as("20260002"));
    expect(term.body).toMatchObject({ tuitionTotal: 3000, paidTotal: 1000, balance: 2000, currency: "USD" });
    const overall = await api.get("/api/v1/tuition/20260002").set(as("20260002"));
    expect(overall.body.scope).toBe("OVERALL");
  });

  test("payment: partial, duplicate (409), over-balance (422) and persisted balance", async () => {
    const body = { studentNo: "20260001", term: "2026-FALL", amount: 500.25, transactionId: "PG-1" };
    const ok = await api.post("/api/v1/tuition/payments").set(as("20260001")).send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.remainingBalance).toBe(2499.75);
    expect((await api.post("/api/v1/tuition/payments").set(as("20260001")).send(body)).status).toBe(409);
    const over = await api.post("/api/v1/tuition/payments").set(as("20260001")).send({ ...body, transactionId: "PG-2", amount: 2499.76 });
    expect(over.status).toBe(422);
    const rows = await pool.query("SELECT amount FROM payments WHERE transaction_id = 'PG-1'");
    expect(rows.rows[0].amount).toBe("500.25");
  });

  test("concurrent payments cannot overpay the balance (row lock)", async () => {
    // 20260002 has $2000 outstanding. Fire 6 x $500 at once: exactly 4 may succeed.
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        api.post("/api/v1/tuition/payments").set(as("20260002")).send({
          studentNo: "20260002",
          term: "2026-FALL",
          amount: 500,
          transactionId: `PAR-${i}`,
        })
      )
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(4);
    expect(statuses.filter((s) => s === 422)).toHaveLength(2);
    const q = await api.get("/api/v1/tuition/20260002?term=2026-FALL").set(as("20260002"));
    expect(q.body.balance).toBe(0);
  });

  test("the same transaction ID submitted concurrently is recorded once", async () => {
    const body = { studentNo: "20260001", term: "2026-FALL", amount: 10, transactionId: "SAME-TX" };
    const results = await Promise.all(Array.from({ length: 5 }, () => api.post("/api/v1/tuition/payments").set(as("20260001")).send(body)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
  });

  test("mobile quota: 10 parallel calls for one student -> exactly 3 succeed", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => api.get("/api/v1/tuition/mobile/20260001")));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 429)).toHaveLength(7);
  });

  test("add tuition create/update, batch and unpaid paging", async () => {
    const created = await api.post("/api/v1/admin/tuition").set(as("admin")).send({ studentNo: "30000001", term: "2026-FALL", amount: 100, currency: "USD" });
    expect(created.status).toBe(201);
    const updated = await api.post("/api/v1/admin/tuition").set(as("admin")).send({ studentNo: "30000001", term: "2026-FALL", amount: 150, currency: "USD" });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe("UPDATED");

    const csv = "studentNo,term,amount,currency\n30000002,2026-FALL,900,USD\n30000003,2026-FALL,x,USD\n30000004,2026-FALL,800,USD";
    const batch = await api.post("/api/v1/admin/tuition/batch").set(as("admin")).set("Content-Type", "text/csv").send(csv);
    expect(batch.body).toMatchObject({ total: 3, succeeded: 2, failed: 1 });

    const p1 = await api.get("/api/v1/admin/tuition/unpaid?term=2026-FALL&page=1&pageSize=2").set(as("admin"));
    expect(p1.status).toBe(200);
    expect(p1.body.totalItems).toBeGreaterThanOrEqual(4);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.items[0].balance).toBeGreaterThanOrEqual(p1.body.items[1].balance);
    const far = await api.get("/api/v1/admin/tuition/unpaid?term=2026-FALL&page=50&pageSize=2").set(as("admin"));
    expect(far.body.items).toEqual([]);
    expect(far.body.totalItems).toBe(p1.body.totalItems);
  });
});
