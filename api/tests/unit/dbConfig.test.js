const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadConfig } = require("../../src/config");
const { buildPgOptions, DEFAULT_CA_FILE } = require("../../src/dbConfig");

const cfg = (env) => loadConfig({ NODE_ENV: "test", JWT_SECRET: "x", ...env });

describe("buildPgOptions (PostgreSQL TLS)", () => {
  test("no TLS by default: plain connection for local development and CI", () => {
    const o = buildPgOptions(cfg({ DATABASE_URL: "postgres://u:p@localhost:5432/db" }));
    expect(o).toEqual({ connectionString: "postgres://u:p@localhost:5432/db" });
  });

  test("DATABASE_SSL=true verifies the server certificate against the bundled CA file", () => {
    const o = buildPgOptions(cfg({ DATABASE_URL: "postgres://u:p@h.postgres.database.azure.com:5432/db", DATABASE_SSL: "true" }));
    expect(o.ssl.rejectUnauthorized).toBe(true);
    expect(o.ssl.ca).toBe(fs.readFileSync(DEFAULT_CA_FILE, "utf8"));
    expect((o.ssl.ca.match(/BEGIN CERTIFICATE/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test("there is no way to turn verification off through the environment", () => {
    const o = buildPgOptions(
      cfg({ DATABASE_URL: "postgres://u:p@h/db", DATABASE_SSL: "true", DATABASE_SSL_INSECURE: "true", NODE_TLS_REJECT_UNAUTHORIZED: "0" })
    );
    expect(o.ssl.rejectUnauthorized).toBe(true);
  });

  test("sslmode & co. in the URL cannot weaken the verified TLS options", () => {
    const o = buildPgOptions(cfg({ DATABASE_URL: "postgres://u:p%40ss@h:5432/db?sslmode=disable&application_name=api", DATABASE_SSL: "true" }));
    expect(o.connectionString).toBe("postgres://u:p%40ss@h:5432/db?application_name=api");
    expect(o.ssl.rejectUnauthorized).toBe(true);
  });

  test("DATABASE_SSL_CA_FILE overrides the bundle", () => {
    const file = path.join(os.tmpdir(), `ca-${process.pid}.pem`);
    fs.writeFileSync(file, "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n");
    try {
      const o = buildPgOptions(cfg({ DATABASE_URL: "postgres://u:p@h/db", DATABASE_SSL: "true", DATABASE_SSL_CA_FILE: file }));
      expect(o.ssl.ca).toContain("AAAA");
    } finally {
      fs.unlinkSync(file);
    }
  });

  test("a missing or empty CA file fails fast instead of silently skipping verification", () => {
    const env = { DATABASE_URL: "postgres://u:p@h/db", DATABASE_SSL: "true" };
    expect(() => buildPgOptions(cfg({ ...env, DATABASE_SSL_CA_FILE: "/nonexistent/ca.pem" }))).toThrow(/CA bundle could not be read/);
    const empty = path.join(os.tmpdir(), `empty-${process.pid}.pem`);
    fs.writeFileSync(empty, "not a certificate");
    try {
      expect(() => buildPgOptions(cfg({ ...env, DATABASE_SSL_CA_FILE: empty }))).toThrow(/no PEM certificate/);
    } finally {
      fs.unlinkSync(empty);
    }
  });
});
