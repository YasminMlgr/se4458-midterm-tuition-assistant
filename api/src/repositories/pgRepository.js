const { conflict } = require("../errors");

/**
 * PostgreSQL implementation of the repository contract used by the services.
 * `db` is either a pg.Pool or a pg.PoolClient (inside a transaction).
 * Money columns are NUMERIC(12,2); they are read/written as integer cents.
 */
class PgRepository {
  constructor(db, pool = db) {
    this.db = db;
    this.pool = pool;
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(new PgRepository(client, this.pool));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getUserByUsername(username) {
    const { rows } = await this.db.query(
      "SELECT id, username, password_hash, role, student_no FROM users WHERE username = $1",
      [username]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, username: r.username, passwordHash: r.password_hash, role: r.role, studentNo: r.student_no };
  }

  async getStudent(studentNo) {
    const { rows } = await this.db.query("SELECT student_no, full_name FROM students WHERE student_no = $1", [
      studentNo,
    ]);
    return rows[0] ? { studentNo: rows[0].student_no, fullName: rows[0].full_name } : null;
  }

  async ensureStudent(studentNo) {
    await this.db.query("INSERT INTO students (student_no) VALUES ($1) ON CONFLICT (student_no) DO NOTHING", [
      studentNo,
    ]);
  }

  async getTuition(studentNo, term, { lock = false } = {}) {
    const { rows } = await this.db.query(
      `SELECT student_no, term, (amount * 100)::bigint AS amount_cents, currency
         FROM tuitions WHERE student_no = $1 AND term = $2 ${lock ? "FOR UPDATE" : ""}`,
      [studentNo, term]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return { studentNo: r.student_no, term: r.term, amountCents: Number(r.amount_cents), currency: r.currency.trim() };
  }

  async listTuitionsWithPaid(studentNo) {
    const { rows } = await this.db.query(
      `SELECT t.term, t.currency, (t.amount * 100)::bigint AS amount_cents,
              COALESCE((SELECT SUM(p.amount * 100)::bigint FROM payments p
                         WHERE p.student_no = t.student_no AND p.term = t.term AND p.status = 'SUCCESS'), 0) AS paid_cents
         FROM tuitions t WHERE t.student_no = $1 ORDER BY t.term`,
      [studentNo]
    );
    return rows.map((r) => ({
      term: r.term,
      currency: r.currency.trim(),
      amountCents: Number(r.amount_cents),
      paidCents: Number(r.paid_cents),
    }));
  }

  async getPaidCents(studentNo, term) {
    const { rows } = await this.db.query(
      `SELECT COALESCE(SUM(amount * 100)::bigint, 0) AS paid_cents
         FROM payments WHERE student_no = $1 AND term = $2 AND status = 'SUCCESS'`,
      [studentNo, term]
    );
    return Number(rows[0].paid_cents);
  }

  async upsertTuition({ studentNo, term, amountCents, currency }) {
    const { rows } = await this.db.query(
      `INSERT INTO tuitions (student_no, term, amount, currency)
            VALUES ($1, $2, $3::numeric / 100, $4)
       ON CONFLICT (student_no, term)
         DO UPDATE SET amount = EXCLUDED.amount, currency = EXCLUDED.currency, updated_at = now()
       RETURNING (xmax = 0) AS created`,
      [studentNo, term, amountCents, currency]
    );
    return { created: rows[0].created };
  }

  async findPaymentByTransactionId(transactionId) {
    const { rows } = await this.db.query("SELECT transaction_id FROM payments WHERE transaction_id = $1", [
      transactionId,
    ]);
    return rows[0] ? { transactionId: rows[0].transaction_id } : null;
  }

  async insertPayment({ transactionId, studentNo, term, amountCents }) {
    try {
      await this.db.query(
        `INSERT INTO payments (transaction_id, student_no, term, amount)
              VALUES ($1, $2, $3, $4::numeric / 100)`,
        [transactionId, studentNo, term, amountCents]
      );
    } catch (err) {
      if (err.code === "23505" && err.constraint === "payments_transaction_uq") {
        throw conflict("DUPLICATE_TRANSACTION", `transactionId '${transactionId}' has already been used`);
      }
      throw err;
    }
  }

  async findUnpaid({ term, limit, offset }) {
    const { rows } = await this.db.query(
      `WITH paid AS (
         SELECT student_no, term, SUM(amount * 100)::bigint AS paid_cents
           FROM payments WHERE status = 'SUCCESS' AND term = $1 GROUP BY student_no, term
       ), unpaid AS (
         SELECT t.student_no, s.full_name, t.currency,
                (t.amount * 100)::bigint AS total_cents,
                COALESCE(p.paid_cents, 0) AS paid_cents,
                (t.amount * 100)::bigint - COALESCE(p.paid_cents, 0) AS balance_cents
           FROM tuitions t
           JOIN students s ON s.student_no = t.student_no
           LEFT JOIN paid p ON p.student_no = t.student_no AND p.term = t.term
          WHERE t.term = $1
       )
       SELECT *, COUNT(*) OVER() AS total_items
         FROM unpaid WHERE balance_cents > 0
        ORDER BY balance_cents DESC, student_no ASC
        LIMIT $2 OFFSET $3`,
      [term, limit, offset]
    );
    let total = rows.length ? Number(rows[0].total_items) : 0;
    if (!rows.length && offset > 0) {
      const { rows: c } = await this.db.query(
        `SELECT COUNT(*) AS n FROM tuitions t
          WHERE t.term = $1 AND (t.amount * 100)::bigint >
                COALESCE((SELECT SUM(p.amount * 100)::bigint FROM payments p
                           WHERE p.student_no = t.student_no AND p.term = t.term), 0)`,
        [term]
      );
      total = Number(c[0].n);
    }
    return {
      total,
      items: rows.map((r) => ({
        studentNo: r.student_no,
        fullName: r.full_name,
        currency: r.currency.trim(),
        totalCents: Number(r.total_cents),
        paidCents: Number(r.paid_cents),
        balanceCents: Number(r.balance_cents),
      })),
    };
  }

  /** Atomically consumes one call from the student's daily quota. */
  async consumeDailyQuota(studentNo, callDate, limit) {
    const { rows } = await this.db.query(
      `INSERT INTO query_log (student_no, call_date, call_count) VALUES ($1, $2, 1)
       ON CONFLICT (student_no, call_date)
         DO UPDATE SET call_count = query_log.call_count + 1
         WHERE query_log.call_count < $3
       RETURNING call_count`,
      [studentNo, callDate, limit]
    );
    if (rows[0]) return { allowed: true, count: rows[0].call_count };
    return { allowed: false, count: limit };
  }
}

module.exports = { PgRepository };
