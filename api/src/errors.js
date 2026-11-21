class AppError extends Error {
  constructor(status, code, message, details, headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

const badRequest = (code, message, details) => new AppError(400, code, message, details);
const unauthorized = (message = "Authentication required") => new AppError(401, "UNAUTHORIZED", message);
const forbidden = (message = "You are not allowed to perform this operation") =>
  new AppError(403, "FORBIDDEN", message);
const notFound = (code, message) => new AppError(404, code, message);
const conflict = (code, message) => new AppError(409, code, message);
const tooManyRequests = (message, headers) => new AppError(429, "RATE_LIMIT_EXCEEDED", message, undefined, headers);
const unprocessable = (code, message) => new AppError(422, code, message);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable, tooManyRequests };
