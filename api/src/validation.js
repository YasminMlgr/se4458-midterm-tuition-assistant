const { badRequest } = require("./errors");

const STUDENT_NO_RE = /^[A-Za-z0-9_-]{3,20}$/;
const TERM_RE = /^(\d{4})-(FALL|SPRING|SUMMER)$/;
const TRANSACTION_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const CURRENCIES = ["USD", "TRY", "EUR"];
const MAX_AMOUNT_CENTS = 100_000_000_00; // 100 million

function validateStudentNo(value) {
  if (typeof value !== "string" || !STUDENT_NO_RE.test(value.trim())) {
    throw badRequest(
      "INVALID_STUDENT_NO",
      "studentNo must be 3-20 characters (letters, digits, '-' or '_')"
    );
  }
  return value.trim();
}

function validateTerm(value) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!TERM_RE.test(normalized)) {
    throw badRequest("INVALID_TERM", "term must look like 2026-FALL, 2027-SPRING or 2027-SUMMER");
  }
  return normalized;
}

function validateCurrency(value) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!CURRENCIES.includes(normalized)) {
    throw badRequest("INVALID_CURRENCY", `currency must be one of ${CURRENCIES.join(", ")}`);
  }
  return normalized;
}

function validateTransactionId(value) {
  if (typeof value !== "string" || !TRANSACTION_ID_RE.test(value.trim())) {
    throw badRequest(
      "INVALID_TRANSACTION_ID",
      "transactionId must be 1-64 characters (letters, digits, '.', '_', ':' or '-')"
    );
  }
  return value.trim();
}

/**
 * Converts a monetary input (number or numeric string) to integer cents.
 * Only positive values with at most two decimals are accepted; no floating point maths is used.
 */
function toCents(value, field = "amount") {
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw badRequest("INVALID_AMOUNT", `${field} must be a number`);
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    throw badRequest("INVALID_AMOUNT", `${field} is required and must be a positive number`);
  }
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    throw badRequest("INVALID_AMOUNT", `${field} must be a positive number with at most 2 decimals`);
  }
  const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  if (cents <= 0) throw badRequest("INVALID_AMOUNT", `${field} must be greater than zero`);
  if (cents > MAX_AMOUNT_CENTS) throw badRequest("INVALID_AMOUNT", `${field} is too large`);
  return cents;
}

const fromCents = (cents) => Number((Number(cents) / 100).toFixed(2));

function parsePositiveInt(value, field, { defaultValue, max }) {
  if (value === undefined || value === "") return defaultValue;
  if (!/^\d+$/.test(String(value))) {
    throw badRequest("INVALID_PAGING", `${field} must be a positive integer`);
  }
  const n = Number(value);
  if (n < 1 || (max && n > max)) {
    throw badRequest("INVALID_PAGING", `${field} must be between 1 and ${max ?? "infinity"}`);
  }
  return n;
}

module.exports = {
  CURRENCIES,
  validateStudentNo,
  validateTerm,
  validateCurrency,
  validateTransactionId,
  toCents,
  fromCents,
  parsePositiveInt,
};
