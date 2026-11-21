const { Pool } = require("pg");
const { loadConfig } = require("./config");
const { createApp } = require("./app");
const { PgRepository } = require("./repositories/pgRepository");
const { buildPgOptions } = require("./dbConfig");

const config = loadConfig();
const pool = new Pool({ ...buildPgOptions(config), max: 10 });
pool.on("error", (err) => console.error("Unexpected database error", err));

const app = createApp({ repo: new PgRepository(pool), config });
const server = app.listen(config.port, () => {
  console.log(`Tuition API listening on port ${config.port} (${config.nodeEnv})`);
  console.log(`Swagger UI: /api-docs   OpenAPI: /openapi.json`);
});

const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
