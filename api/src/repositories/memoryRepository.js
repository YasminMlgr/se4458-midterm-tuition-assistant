const { conflict } = require("../errors");

/**
 * In-memory implementation of the same repository contract as PgRepository.
 * It lets the unit tests run without a database, cloud account or LLM.
 */
class MemoryRepository {
  constructor() {
    this.users = [];
    this.students = new Map();
    this.tuitions = new Map(); // key: `${studentNo}|${term}`
    this.payments = [];
    this.quota = new Map(); // key: `${studentNo}|${date}`
  }

  // ---- test helpers -------------------------------------------------------
  seedUser(user) {
    this.users.push({ id: this.users.length + 1, ...user });
  }
  seedStudent(studentNo, fullName = null) {
    this.students.set(studentNo, { studentNo, fullName });
  }
  seedTuition(studentNo, term, amountCents, currency = "USD") {
    this.tuitions.set(`${studentNo}|${term}`, { studentNo, term, amountCents, currency });
  }
  seedPayment(transactionId, studentNo, term, amountCents) {
    this.payments.push({ transactionId, studentNo, term, amountCents });
  }

  // ---- repository contract ------------------------------------------------
  async transaction(fn) {
    return fn(this);
  }

  async getUserByUsername(username) {
    return this.users.find((u) => u.username === username) || null;
  }

  async getStudent(studentNo) {
    return this.students.get(studentNo) || null;
  }

  async ensureStudent(studentNo) {
    if (!this.students.has(studentNo)) this.students.set(studentNo, { studentNo, fullName: null });
  }

  async getTuition(studentNo, term) {
    const t = this.tuitions.get(`${studentNo}|${term}`);
    return t ? { ...t } : null;
  }

  async getPaidCents(studentNo, term) {
    return this.payments
      .filter((p) => p.studentNo === studentNo && p.term === term)
      .reduce((sum, p) => sum + p.amountCents, 0);
  }

  async listTuitionsWithPaid(studentNo) {
    const rows = [];
    for (const t of this.tuitions.values()) {
      if (t.studentNo !== studentNo) continue;
      rows.push({
        term: t.term,
        currency: t.currency,
        amountCents: t.amountCents,
        paidCents: await this.getPaidCents(studentNo, t.term),
      });
    }
    return rows.sort((a, b) => a.term.localeCompare(b.term));
  }

  async upsertTuition({ studentNo, term, amountCents, currency }) {
    const key = `${studentNo}|${term}`;
    const created = !this.tuitions.has(key);
    this.tuitions.set(key, { studentNo, term, amountCents, currency });
    return { created };
  }

  async findPaymentByTransactionId(transactionId) {
    return this.payments.find((p) => p.transactionId === transactionId) || null;
  }

  async insertPayment({ transactionId, studentNo, term, amountCents }) {
    if (this.payments.some((p) => p.transactionId === transactionId)) {
      throw conflict("DUPLICATE_TRANSACTION", `transactionId '${transactionId}' has already been used`);
    }
    this.payments.push({ transactionId, studentNo, term, amountCents });
  }

  async findUnpaid({ term, limit, offset }) {
    const all = [];
    for (const t of this.tuitions.values()) {
      if (t.term !== term) continue;
      const paidCents = await this.getPaidCents(t.studentNo, term);
      const balanceCents = t.amountCents - paidCents;
      if (balanceCents <= 0) continue;
      all.push({
        studentNo: t.studentNo,
        fullName: this.students.get(t.studentNo)?.fullName ?? null,
        currency: t.currency,
        totalCents: t.amountCents,
        paidCents,
        balanceCents,
      });
    }
    all.sort((a, b) => b.balanceCents - a.balanceCents || a.studentNo.localeCompare(b.studentNo));
    return { total: all.length, items: all.slice(offset, offset + limit) };
  }

  async consumeDailyQuota(studentNo, callDate, limit) {
    const key = `${studentNo}|${callDate}`;
    const count = this.quota.get(key) || 0;
    if (count >= limit) return { allowed: false, count };
    this.quota.set(key, count + 1);
    return { allowed: true, count: count + 1 };
  }
}

module.exports = { MemoryRepository };
