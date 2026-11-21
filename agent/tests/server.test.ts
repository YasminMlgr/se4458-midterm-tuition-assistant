import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createAgentApp } from "../src/agentApp.js";
import { call, setup, text } from "./helpers.js";

function jwt(claims: object) {
  return `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
}

async function start(loginBody: any, loginStatus = 200, steps: any[] = []) {
  const t = setup(steps);
  t.api.login = async () => ({ status: loginStatus, body: loginBody });
  const app = createAgentApp({ agent: t.agent, api: t.api });
  const server = await new Promise<import("node:http").Server>((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { server, post, base, t };
}

test("login: wrong credentials -> 401; admin accounts are refused; student gets a session", async () => {
  let s = await start({ error: { code: "INVALID_CREDENTIALS" } }, 401);
  assert.equal((await s.post("/api/login", { username: "a", password: "b" })).status, 401);
  s.server.close();

  s = await start({ accessToken: jwt({ role: "admin", sub: "admin" }) });
  assert.equal((await s.post("/api/login", { username: "admin", password: "x" })).status, 403);
  s.server.close();

  s = await start({ accessToken: jwt({ role: "student", studentNo: "20260001", sub: "20260001" }) });
  const res = await s.post("/api/login", { username: "20260001", password: "x" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).studentNo, "20260001");
  s.server.close();
});

test("chat: requires a valid session, validates the message, and returns reply + trace", async () => {
  const s = await start({ accessToken: jwt({ role: "student", studentNo: "20260001" }) }, 200, [call("get_my_tuition"), text("Your balance is 3,000 USD.")]);
  try {
    assert.equal((await s.post("/api/chat", { sessionId: "nope", message: "hi" })).status, 401);
    const { sessionId } = await (await s.post("/api/login", { username: "20260001", password: "x" })).json();
    assert.equal((await s.post("/api/chat", { sessionId, message: "   " })).status, 400);
    assert.equal((await s.post("/api/chat", { sessionId, message: "x".repeat(1001) })).status, 400);
    const ok = await (await s.post("/api/chat", { sessionId, message: "What is my balance?" })).json();
    assert.match(ok.reply, /3,000/);
    assert.equal(ok.trace[0].tool, "get_my_tuition");
    await s.post("/api/logout", { sessionId });
    assert.equal((await s.post("/api/chat", { sessionId, message: "hi" })).status, 401);
  } finally {
    s.server.close();
  }
});

test("the chat UI is served and health responds", async () => {
  const s = await start({});
  try {
    assert.match(await (await fetch(s.base + "/")).text(), /AI Tuition Assistant/);
    assert.equal((await fetch(s.base + "/health")).status, 200);
  } finally {
    s.server.close();
  }
});
