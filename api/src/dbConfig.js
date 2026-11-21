const fs = require("fs");
const path = require("path");

// Public root certificates used by Azure Database for PostgreSQL (see the header of the file).
const DEFAULT_CA_FILE = path.join(__dirname, "..", "certs", "azure-pg-ca-bundle.pem");

// Connection-string parameters that would silently override the TLS options below.
const SSL_URL_PARAMS = ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "sslcrl"];

/**
 * Options for `new pg.Pool()` / `new pg.Client()`.
 *
 * DATABASE_SSL=true turns TLS on WITH full certificate and host-name verification
 * (rejectUnauthorized: true). There is deliberately no switch that disables verification:
 * if the server's certificate chain changes, point DATABASE_SSL_CA_FILE at an updated CA bundle.
 * DATABASE_SSL unset/false means a plain connection (local development, CI service container).
 */
function buildPgOptions(config) {
  if (!config.databaseSsl) return { connectionString: config.databaseUrl };

  const caFile = config.databaseSslCaFile || DEFAULT_CA_FILE;
  let ca;
  try {
    ca = fs.readFileSync(caFile, "utf8");
  } catch (err) {
    throw new Error(`DATABASE_SSL=true but the CA bundle could not be read (${caFile}): ${err.code || err.message}`);
  }
  if (!ca.includes("BEGIN CERTIFICATE")) {
    throw new Error(`DATABASE_SSL=true but ${caFile} contains no PEM certificate`);
  }
  return { connectionString: withoutSslParams(config.databaseUrl), ssl: { rejectUnauthorized: true, ca } };
}

function withoutSslParams(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString; // not a URL (e.g. key=value form): nothing to strip
  }
  for (const name of SSL_URL_PARAMS) url.searchParams.delete(name);
  return url.toString();
}

module.exports = { buildPgOptions, DEFAULT_CA_FILE };
