const crypto = require("crypto");
const { AppError, unauthorized, forbidden } = require("./errors");

function authenticate(authService) {
  return (req, _res, next) => {
    const header = req.get("authorization") || "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) return next(unauthorized("Missing or malformed Authorization header (expected 'Bearer <token>')"));
    try {
      req.user = authService.verifyToken(match[1].trim());
      next();
    } catch (err) {
      next(err);
    }
  };
}

const requireRole =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user?.role) ? next() : next(forbidden(`This operation requires the role: ${roles.join(" or ")}`));

/**
 * A student may only act on their own record. The student number is taken from the verified JWT,
 * never from whatever the caller (or an AI agent prompt) claims. Admins pass through.
 */
const requireOwnStudent = (getStudentNo) => (req, _res, next) => {
  if (req.user.role === "admin") return next();
  const requested = getStudentNo(req);
  if (typeof requested !== "string" || requested.trim() !== req.user.studentNo) {
    return next(forbidden("You can only access your own tuition records"));
  }
  next();
};

/** Rejects calls that did not come through the API gateway (only active when GATEWAY_SECRET is configured). */
function requireGateway(secret) {
  const expected = Buffer.from(secret);
  return (req, _res, next) => {
    const given = Buffer.from(req.get("x-gateway-secret") || "");
    const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
    return ok ? next() : next(new AppError(403, "GATEWAY_REQUIRED", "This API must be called through the API gateway"));
  };
}

function notFoundHandler(_req, _res, next) {
  next(new AppError(404, "ROUTE_NOT_FOUND", "The requested route does not exist"));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(logger) {
  return (err, _req, res, _next) => {
    if (err instanceof AppError) {
      if (err.headers) res.set(err.headers);
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body is not valid JSON" } });
    }
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" } });
    }
    logger.error("Unhandled error", err);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  };
}

module.exports = { requireGateway, authenticate, requireRole, requireOwnStudent, notFoundHandler, errorHandler };
