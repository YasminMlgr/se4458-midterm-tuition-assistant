// Loads TEST DATA (fictitious students, tuition and demo accounts). Safe to run repeatedly.
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { loadConfig } = require("../src/config");

const STUDENTS = [
  ["20260001", "Ayse Demir"],
  ["20260002", "Mehmet Kaya"],
  ["20260003", "Zeynep Arslan"],
  ["20260004", "Can Yildiz"],
  ["20260005", "Elif Sahin"],
];

// [studentNo, term, amount, currency]
const TUITIONS = [
  ["20260001", "2026-FALL", 3000, "USD"], // untouched: balance 3000 (installment demo)
  ["20260002", "2026-FALL", 3000, "USD"], // partially paid below
  ["20260002", "2027-SPRING", 3000, "USD"],
  ["20260003", "2026-FALL", 2500, "USD"], // fully paid below
  ["20260004", "2026-FALL", 250, "USD"], // below the $300 installment threshold
  ["20260005", "2026-FALL", 4000, "USD"],
];

// [transactionId, studentNo, term, amount]
const PAYMENTS = [
  ["SEED-0001", "20260002", "2026-FALL", 1000],
  ["SEED-0002", "20260003", "2026-FALL", 2500],
];

// Demo defaults (documented in the README). On a public deployment override them with
// SEED_STUDENT_PASSWORD / SEED_ADMIN_PASSWORD so the admin account is not guessable.
const STUDENT_PASSWORD = process.env.SEED_STUDENT_PASSWORD || "Student123!";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "Admin123!";

(async () => {
  const config = loadConfig();
  const client = new Client({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const [no, name] of STUDENTS) {
      await client.query(
        "INSERT INTO students (student_no, full_name) VALUES ($1, $2) ON CONFLICT (student_no) DO UPDATE SET full_name = EXCLUDED.full_name",
        [no, name]
      );
      await client.query(
        `INSERT INTO users (username, password_hash, role, student_no) VALUES ($1, $2, 'student', $1)
         ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [no, bcrypt.hashSync(STUDENT_PASSWORD, 10)]
      );
    }
    await client.query(
      `INSERT INTO users (username, password_hash, role) VALUES ('admin', $1, 'admin')
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [bcrypt.hashSync(ADMIN_PASSWORD, 10)]
    );
    for (const [no, term, amount, cur] of TUITIONS) {
      await client.query(
        `INSERT INTO tuitions (student_no, term, amount, currency) VALUES ($1, $2, $3, $4)
         ON CONFLICT (student_no, term) DO NOTHING`,
        [no, term, amount, cur]
      );
    }
    for (const [tx, no, term, amount] of PAYMENTS) {
      await client.query(
        `INSERT INTO payments (transaction_id, student_no, term, amount) VALUES ($1, $2, $3, $4)
         ON CONFLICT (transaction_id) DO NOTHING`,
        [tx, no, term, amount]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
  console.log("Seed data loaded.");
  console.log(`Students: username = student number (e.g. 20260001), password = ${STUDENT_PASSWORD}`);
  console.log(`Admin:    username = admin, password = ${ADMIN_PASSWORD}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
