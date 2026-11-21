const bcrypt = require("bcryptjs");
const request = require("supertest");
const { loadConfig } = require("../../src/config");
const { createApp } = require("../../src/app");
const { MemoryRepository } = require("../../src/repositories/memoryRepository");

const silentLogger = { log() {}, error() {} };

function buildTestApp(envOverrides = {}) {
  const repo = new MemoryRepository();
  const clock = { now: new Date("2026-11-20T10:00:00Z") };
  const config = loadConfig({ NODE_ENV: "test", JWT_SECRET: "test-secret", ...envOverrides });
  const hash = bcrypt.hashSync("Pass123!", 4);

  repo.seedStudent("20260001", "Ayse Demir");
  repo.seedStudent("20260002", "Mehmet Kaya");
  repo.seedStudent("20260003", "Zeynep Arslan");
  repo.seedUser({ username: "20260001", passwordHash: hash, role: "student", studentNo: "20260001" });
  repo.seedUser({ username: "20260002", passwordHash: hash, role: "student", studentNo: "20260002" });
  repo.seedUser({ username: "admin", passwordHash: hash, role: "admin", studentNo: null });

  repo.seedTuition("20260001", "2026-FALL", 300000); // $3000, nothing paid
  repo.seedTuition("20260002", "2026-FALL", 300000);
  repo.seedTuition("20260002", "2027-SPRING", 300000);
  repo.seedPayment("SEED-1", "20260002", "2026-FALL", 100000); // $1000 paid
  repo.seedTuition("20260003", "2026-FALL", 250000);
  repo.seedPayment("SEED-2", "20260003", "2026-FALL", 250000); // fully paid

  const app = createApp({ repo, config, clock: () => clock.now, logger: silentLogger });
  const api = request(app);

  async function tokenFor(username) {
    const res = await api.post("/api/v1/auth/login").send({ username, password: "Pass123!" });
    return res.body.accessToken;
  }
  const bearer = async (username) => ({ Authorization: `Bearer ${await tokenFor(username)}` });

  return { api, repo, clock, config, bearer };
}

module.exports = { buildTestApp };
