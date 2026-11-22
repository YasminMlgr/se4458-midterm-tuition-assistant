import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { decodeJwtClaims, type TuitionApi } from "./gatewayClient.js";
import type { TuitionAgent } from "./agent.js";
import type { AgentSession } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SESSION_TTL_MS = 60 * 60 * 1000;

interface StoredSession extends AgentSession {
  lastSeen: number;
  busy: boolean;
}

/** HTTP front of the agent: login (through the gateway), chat, logout, and the static chat UI. */
export function createAgentApp(deps: { agent: TuitionAgent; api: TuitionApi; now?: () => number }) {
  const now = deps.now ?? Date.now;
  const sessions = new Map<string, StoredSession>();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "20kb" }));

  const sweep = setInterval(() => {
    for (const [id, s] of sessions) if (now() - s.lastSeen > SESSION_TTL_MS) sessions.delete(id);
  }, 5 * 60 * 1000);
  sweep.unref();

  app.get("/health", (_req, res) => res.json({ status: "ok", thoughtSignatureEcho: true }));

  app.post("/api/login", async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return res.status(400).json({ error: "username and password are required" });
    }
    const result = await deps.api.login(username.trim(), password);
    if (result.status === 401) return res.status(401).json({ error: "Invalid student number or password" });
    if (result.status !== 200 || !result.body?.accessToken) {
      return res.status(502).json({ error: "The tuition service is not reachable right now. Please try again." });
    }
    const claims = decodeJwtClaims(result.body.accessToken);
    if (claims.role !== "student" || !claims.studentNo) {
      return res.status(403).json({ error: "The AI Tuition Assistant is available for student accounts only." });
    }
    const sessionId = randomUUID();
    sessions.set(sessionId, { studentNo: claims.studentNo, token: result.body.accessToken, history: [], pending: null, lang: "en", lastSeen: now(), busy: false });
    res.json({ sessionId, studentNo: claims.studentNo });
  });

  app.post("/api/chat", async (req, res) => {
    const { sessionId, message } = req.body ?? {};
    const session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (!session) return res.status(401).json({ error: "Session expired. Please log in again." });
    if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "message is required" });
    if (message.length > 1000) return res.status(400).json({ error: "message is too long (max 1000 characters)" });
    if (session.busy) return res.status(429).json({ error: "Please wait for the previous answer." });
    session.busy = true;
    session.lastSeen = now();
    try {
      const result = await deps.agent.handle(session, message.trim());
      res.json({ reply: result.reply, trace: result.trace, pendingPayment: result.pending ? { term: result.pending.term, amount: result.pending.amount } : null });
    } catch (err) {
      console.error("[agent] unexpected error", err);
      res.status(500).json({ error: "Unexpected error" });
    } finally {
      session.busy = false;
    }
  });

  app.post("/api/logout", (req, res) => {
    if (typeof req.body?.sessionId === "string") sessions.delete(req.body.sessionId);
    res.json({ ok: true });
  });

  app.use(express.static(path.resolve(here, "../public")));
  return app;
}
