// Applies db/schema.sql to the database in DATABASE_URL (idempotent).
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { loadConfig } = require("../src/config");

(async () => {
  const config = loadConfig();
  const client = new Client({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  await client.query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
  await client.end();
  console.log("Schema applied.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
