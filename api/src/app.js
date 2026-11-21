const express = require("express");
const helmet = require("helmet");
const swaggerUi = require("swagger-ui-express");
const { AuthService } = require("./services/authService");
const { TuitionService } = require("./services/tuitionService");
const { requireGateway, authenticate, requireRole, requireOwnStudent, notFoundHandler, errorHandler } = require("./middleware");
const { buildOpenApi } = require("./openapi");

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Builds the Express app. Dependencies are injected so tests can use an in-memory repository.
 * All business endpoints live under the versioned prefix /api/v1.
 */
function createApp({ repo, config, clock, logger = console }) {
  const auth = new AuthService(repo, config);
  const tuition = new TuitionService(repo, config, clock);
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "100kb" }));
  app.use(express.text({ type: "text/csv", limit: "2mb" }));
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  if (config.nodeEnv !== "test") {
    app.use((req, res, next) => {
      const started = Date.now();
      res.on("finish", () => logger.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`));
      next();
    });
  }

  const v1 = express.Router();
  if (config.gatewaySecret) v1.use(requireGateway(config.gatewaySecret));
  const needLogin = authenticate(auth);
  const adminOnly = [needLogin, requireRole("admin")];

  v1.get("/health", (_req, res) => res.json({ status: "ok", version: "v1" }));

  // ---- Authentication ------------------------------------------------------
  v1.post(
    "/auth/login",
    asyncHandler(async (req, res) => {
      const { username, password } = req.body || {};
      res.json(await auth.login(username, password));
    })
  );

  // ---- University Mobile App: Query Tuition (no auth, 3 calls / student / day) ----
  v1.get(
    "/tuition/mobile/:studentNo",
    asyncHandler(async (req, res) => {
      const { result, rateLimit } = await tuition.queryTuitionMobile(req.params.studentNo, req.query.term);
      res.set({ "X-RateLimit-Limit": String(rateLimit.limit), "X-RateLimit-Remaining": String(rateLimit.remaining) });
      res.json(result);
    })
  );

  // ---- Banking App (and AI agent): Query Tuition + Pay Tuition (JWT required) ----
  v1.get(
    "/tuition/:studentNo",
    needLogin,
    requireOwnStudent((req) => req.params.studentNo),
    asyncHandler(async (req, res) => {
      res.json(await tuition.queryTuition(req.params.studentNo, req.query.term));
    })
  );

  v1.post(
    "/tuition/payments",
    needLogin,
    requireRole("student"),
    requireOwnStudent((req) => req.body?.studentNo),
    asyncHandler(async (req, res) => {
      res.status(201).json(await tuition.payTuition(req.body || {}));
    })
  );

  // ---- University Web Site - Admin ----------------------------------------------
  v1.post(
    "/admin/tuition",
    ...adminOnly,
    asyncHandler(async (req, res) => {
      const result = await tuition.addTuition(req.body || {});
      res.status(result.status === "CREATED" ? 201 : 200).json(result);
    })
  );

  v1.post(
    "/admin/tuition/batch",
    ...adminOnly,
    asyncHandler(async (req, res) => {
      res.json(await tuition.addTuitionBatch(req.body));
    })
  );

  v1.get(
    "/admin/tuition/unpaid",
    ...adminOnly,
    asyncHandler(async (req, res) => {
      res.json(await tuition.unpaidTuitionStatus(req.query));
    })
  );

  app.use("/api/v1", v1);

  // ---- Documentation -------------------------------------------------------------
  const openApi = buildOpenApi();
  app.get("/openapi.json", (_req, res) => res.json(openApi));
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApi));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}

module.exports = { createApp };
