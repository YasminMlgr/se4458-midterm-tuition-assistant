const DEV_SECRET = "dev-only-secret-change-me";

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const jwtSecret = env.JWT_SECRET || (nodeEnv === "production" ? "" : DEV_SECRET);
  if (!jwtSecret) {
    throw new Error("JWT_SECRET must be set in production");
  }
  return {
    nodeEnv,
    port: Number(env.PORT) || 3000,
    databaseUrl: env.DATABASE_URL || "postgres://postgres@localhost:5432/tuition",
    // TLS to PostgreSQL is always verified when enabled (see dbConfig.js); the CA bundle can be overridden.
    databaseSsl: env.DATABASE_SSL === "true",
    databaseSslCaFile: env.DATABASE_SSL_CA_FILE || "",
    jwtSecret,
    jwtIssuer: env.JWT_ISSUER || "tuition-api",
    jwtAudience: env.JWT_AUDIENCE || "tuition-clients",
    jwtExpiresIn: env.JWT_EXPIRES_IN || "1h",
    // The "3 calls per student per day" rule is evaluated in the university's local time zone.
    timezone: env.APP_TIMEZONE || "Europe/Istanbul",
    mobileDailyLimit: Number(env.MOBILE_DAILY_LIMIT) || 3,
    batchMaxRows: Number(env.BATCH_MAX_ROWS) || 1000,
    // When set, every /api/v1 request must carry this value in X-Gateway-Secret (added by the API gateway),
    // so the backend cannot be called around the gateway.
    gatewaySecret: env.GATEWAY_SECRET || "",
  };
}

module.exports = { loadConfig };
