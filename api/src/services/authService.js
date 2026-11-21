const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { AppError, badRequest, unauthorized } = require("../errors");

// Compared against when the user does not exist, so response time does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 8);

class AuthService {
  constructor(repo, config) {
    this.repo = repo;
    this.config = config;
  }

  async login(username, password) {
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      throw badRequest("INVALID_CREDENTIALS_FORMAT", "username and password are required");
    }
    const user = await this.repo.getUserByUsername(username.trim());
    const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid username or password");
    }
    const claims = { role: user.role };
    if (user.studentNo) claims.studentNo = user.studentNo;
    const token = jwt.sign(claims, this.config.jwtSecret, {
      algorithm: "HS256",
      subject: user.username,
      issuer: this.config.jwtIssuer,
      audience: this.config.jwtAudience,
      expiresIn: this.config.jwtExpiresIn,
    });
    return { accessToken: token, tokenType: "Bearer", expiresIn: this.config.jwtExpiresIn, role: user.role };
  }

  verifyToken(token) {
    try {
      const payload = jwt.verify(token, this.config.jwtSecret, {
        algorithms: ["HS256"],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      });
      return { username: payload.sub, role: payload.role, studentNo: payload.studentNo || null };
    } catch {
      throw unauthorized("Invalid or expired token");
    }
  }
}

module.exports = { AuthService };
