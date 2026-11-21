const {
  badRequest,
  conflict,
  notFound,
  unprocessable,
  tooManyRequests,
  AppError,
} = require("../errors");
const {
  validateStudentNo,
  validateTerm,
  validateCurrency,
  validateTransactionId,
  toCents,
  fromCents,
  parsePositiveInt,
} = require("../validation");
const { parseCsv } = require("../csv");

const CSV_HEADER = ["studentno", "term", "amount", "currency"];

class TuitionService {
  constructor(repo, config, clock = () => new Date()) {
    this.repo = repo;
    this.config = config;
    this.clock = clock;
  }

  // ---------------------------------------------------------------- queries

  /**
   * Query Tuition. With `term` the figures are for that term only; without it the
   * response is the overall position across all terms (plus a per-term breakdown).
   */
  async queryTuition(studentNoInput, termInput) {
    const studentNo = validateStudentNo(studentNoInput);
    const term = termInput === undefined || termInput === "" ? null : validateTerm(termInput);

    if (!(await this.repo.getStudent(studentNo))) {
      throw notFound("STUDENT_NOT_FOUND", `Student ${studentNo} was not found`);
    }
    const rows = await this.repo.listTuitionsWithPaid(studentNo);
    const selected = term ? rows.filter((r) => r.term === term) : rows;
    if (selected.length === 0) {
      throw notFound(
        "TUITION_NOT_FOUND",
        term ? `No tuition record for student ${studentNo} in term ${term}` : `No tuition records for student ${studentNo}`
      );
    }
    const total = selected.reduce((s, r) => s + r.amountCents, 0);
    const paid = selected.reduce((s, r) => s + r.paidCents, 0);
    return {
      studentNo,
      term, // null => overall balance across all terms
      scope: term ? "TERM" : "OVERALL",
      currency: selected[0].currency,
      tuitionTotal: fromCents(total),
      paidTotal: fromCents(paid),
      balance: fromCents(total - paid),
      terms: selected.map((r) => ({
        term: r.term,
        tuitionTotal: fromCents(r.amountCents),
        paid: fromCents(r.paidCents),
        balance: fromCents(r.amountCents - r.paidCents),
      })),
    };
  }

  /** Mobile Query Tuition: same result, but limited to N calls per student per local day. */
  async queryTuitionMobile(studentNoInput, termInput) {
    const studentNo = validateStudentNo(studentNoInput);
    const now = this.clock();
    const { allowed, count } = await this.repo.consumeDailyQuota(
      studentNo,
      this.localDate(now),
      this.config.mobileDailyLimit
    );
    const limit = this.config.mobileDailyLimit;
    if (!allowed) {
      const retryAfter = this.secondsUntilLocalMidnight(now);
      throw tooManyRequests(
        `Daily limit of ${limit} tuition queries for student ${studentNo} has been reached. Try again tomorrow.`,
        {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
        }
      );
    }
    const result = await this.queryTuition(studentNo, termInput);
    return { result, rateLimit: { limit, remaining: limit - count } };
  }

  // --------------------------------------------------------------- payments

  async payTuition({ studentNo: sn, term: t, amount, transactionId: tx }) {
    const studentNo = validateStudentNo(sn);
    const term = validateTerm(t);
    const amountCents = toCents(amount);
    const transactionId = validateTransactionId(tx);

    return this.repo.transaction(async (db) => {
      if (await db.findPaymentByTransactionId(transactionId)) {
        throw conflict("DUPLICATE_TRANSACTION", `transactionId '${transactionId}' has already been used`);
      }
      // Row lock on the tuition record serialises concurrent payments for the same student/term.
      const tuition = await db.getTuition(studentNo, term, { lock: true });
      if (!tuition) {
        throw notFound("TUITION_NOT_FOUND", `No tuition record for student ${studentNo} in term ${term}`);
      }
      const paidBefore = await db.getPaidCents(studentNo, term);
      const balanceBefore = tuition.amountCents - paidBefore;
      if (amountCents > balanceBefore) {
        throw unprocessable(
          "AMOUNT_EXCEEDS_BALANCE",
          balanceBefore === 0
            ? `Term ${term} has no outstanding balance`
            : `Amount ${fromCents(amountCents).toFixed(2)} exceeds the outstanding balance ${fromCents(balanceBefore).toFixed(2)}`
        );
      }
      await db.insertPayment({ transactionId, studentNo, term, amountCents });
      const totalPaid = paidBefore + amountCents;
      return {
        status: "SUCCESS",
        transactionId,
        studentNo,
        term,
        currency: tuition.currency,
        paidAmount: fromCents(amountCents),
        totalPaid: fromCents(totalPaid),
        remainingBalance: fromCents(tuition.amountCents - totalPaid),
      };
    });
  }

  // ------------------------------------------------------------------ admin

  /**
   * Add Tuition. Duplicate rule: the pair (studentNo, term) is unique; a second call for the same
   * pair UPDATES the amount/currency (status "UPDATED"). An update is rejected when the new amount is
   * lower than what has already been paid, or when the currency would become inconsistent.
   */
  async addTuition(input) {
    const studentNo = validateStudentNo(input?.studentNo);
    const term = validateTerm(input?.term);
    const amountCents = toCents(input?.amount);
    const currency = validateCurrency(input?.currency);

    return this.repo.transaction(async (db) => {
      await db.ensureStudent(studentNo);
      const existing = await db.listTuitionsWithPaid(studentNo);
      if (existing.some((r) => r.term !== term && r.currency !== currency)) {
        throw conflict(
          "CURRENCY_MISMATCH",
          `Student ${studentNo} already has tuition in ${existing.find((r) => r.term !== term).currency}; all terms must use one currency`
        );
      }
      const same = existing.find((r) => r.term === term);
      if (same) {
        if (same.paidCents > 0 && same.currency !== currency) {
          throw conflict("CURRENCY_MISMATCH", "The currency cannot change after payments were recorded");
        }
        if (amountCents < same.paidCents) {
          throw conflict(
            "AMOUNT_BELOW_PAID",
            `New amount ${fromCents(amountCents).toFixed(2)} is lower than the amount already paid ${fromCents(same.paidCents).toFixed(2)}`
          );
        }
      }
      const { created } = await db.upsertTuition({ studentNo, term, amountCents, currency });
      return {
        status: created ? "CREATED" : "UPDATED",
        studentNo,
        term,
        amount: fromCents(amountCents),
        currency,
      };
    });
  }

  /**
   * Add Tuition - Batch. Body is CSV with header `studentNo,term,amount,currency`.
   * Rows are processed independently (a bad row never blocks the others); later rows for the
   * same student/term overwrite earlier ones.
   */
  async addTuitionBatch(csvText) {
    if (typeof csvText !== "string" || csvText.trim() === "") {
      throw badRequest("EMPTY_BATCH", "Request body must be CSV text (Content-Type: text/csv)");
    }
    const rows = parseCsv(csvText);
    const header = (rows.shift() || []).map((h) => h.trim().toLowerCase());
    if (header.length !== CSV_HEADER.length || !CSV_HEADER.every((h, i) => header[i] === h)) {
      throw badRequest("INVALID_CSV_HEADER", "CSV header must be exactly: studentNo,term,amount,currency");
    }
    if (rows.length === 0) throw badRequest("EMPTY_BATCH", "CSV contains no data rows");
    if (rows.length > this.config.batchMaxRows) {
      throw new AppError(413, "BATCH_TOO_LARGE", `A batch may contain at most ${this.config.batchMaxRows} rows`);
    }

    const results = [];
    let succeeded = 0;
    for (let i = 0; i < rows.length; i++) {
      const line = i + 2; // 1-based, header is line 1
      const [studentNo = "", term = "", amount = "", currency = ""] = rows[i].map((c) => c.trim());
      try {
        if (rows[i].length !== CSV_HEADER.length) {
          throw badRequest("INVALID_ROW", "Row must have exactly 4 columns");
        }
        const r = await this.addTuition({ studentNo, term, amount, currency });
        succeeded++;
        results.push({ line, studentNo: r.studentNo, term: r.term, status: r.status });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        results.push({ line, studentNo, term, status: "FAILED", errorCode: err.code, error: err.message });
      }
    }
    return {
      status: succeeded === rows.length ? "COMPLETED" : succeeded === 0 ? "FAILED" : "PARTIALLY_COMPLETED",
      total: rows.length,
      succeeded,
      failed: rows.length - succeeded,
      results,
    };
  }

  async unpaidTuitionStatus({ term: t, page: p, pageSize: ps }) {
    if (t === undefined || t === "") throw badRequest("INVALID_TERM", "term is required");
    const term = validateTerm(t);
    const page = parsePositiveInt(p, "page", { defaultValue: 1, max: 1_000_000 });
    const pageSize = parsePositiveInt(ps, "pageSize", { defaultValue: 20, max: 100 });
    const { total, items } = await this.repo.findUnpaid({ term, limit: pageSize, offset: (page - 1) * pageSize });
    return {
      term,
      page,
      pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / pageSize),
      items: items.map((i) => ({
        studentNo: i.studentNo,
        fullName: i.fullName,
        currency: i.currency,
        tuitionTotal: fromCents(i.totalCents),
        paid: fromCents(i.paidCents),
        balance: fromCents(i.balanceCents),
      })),
    };
  }

  // ---------------------------------------------------------------- helpers

  localDate(date) {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: this.config.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  secondsUntilLocalMidnight(date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: this.config.timezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const get = (type) => Number(parts.find((x) => x.type === type).value);
    return 86400 - (get("hour") * 3600 + get("minute") * 60 + get("second"));
  }
}

module.exports = { TuitionService };
