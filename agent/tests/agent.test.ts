import { test } from "node:test";
import assert from "node:assert/strict";
import { call, setup, text } from "./helpers.js";
import { PENDING_TTL_MS } from "../src/agent.js";
import { isCancellation, isExplicitConfirmation } from "../src/confirmation.js";

// ---------------------------------------------------------------- the three routing scenarios
test("scenario 1 - policy question uses MCP only (no REST call)", async () => {
  const t = setup([call("search_tuition_policies", { query: "fall deadline" }), text("The Fall 2026 deadline is September 30, 2026 (Section 2.1).")]);
  const r = await t.agent.handle(t.session, "When is the Fall tuition deadline?");
  assert.equal(t.policies.queries.length, 1);
  assert.equal(t.api.calls.length, 0);
  assert.deepEqual(r.trace.map((x) => [x.tool, x.via]), [["search_tuition_policies", "MCP"]]);
  assert.match(r.reply, /September 30, 2026/);
  // the tool result (policy passage) was fed back to the LLM before it answered
  const lastCall = t.model.calls.at(-1)!;
  assert.ok(lastCall.messages.some((m) => m.role === "tool" && m.content.includes("UNI-TUITION-2026-01")));
});

test("scenario 2 - balance question uses the REST API only, with the student's own token and number", async () => {
  const t = setup([call("get_my_tuition", {}), text("Your balance is 3,000 USD.")]);
  const r = await t.agent.handle(t.session, "What is my balance?");
  assert.equal(t.policies.queries.length, 0);
  assert.deepEqual(t.api.calls.map((c) => c.op), ["getTuition"]);
  assert.equal(t.api.calls[0].args.studentNo, "20260001");
  assert.equal(t.api.calls[0].args.token, "jwt-of-20260001");
  assert.deepEqual(r.trace.map((x) => x.via), ["REST (API gateway)"]);
});

test("scenario 3 - a combined question uses both MCP and REST", async () => {
  const t = setup([
    {
      content: null,
      toolCalls: [
        { id: "a", name: "get_my_tuition", arguments: JSON.stringify({ term: "2026-fall" }) },
        { id: "b", name: "search_tuition_policies", arguments: JSON.stringify({ query: "installment eligibility" }) },
      ],
    },
    text("Your balance is $3,000, which is above the $300 minimum, so you may request up to three installments (Sections 3.1-3.2); approval is up to the university."),
  ]);
  const r = await t.agent.handle(t.session, "Can I pay my balance in three installments?");
  assert.equal(t.policies.queries.length, 1);
  assert.equal(t.api.calls[0].args.term, "2026-FALL", "term is normalised");
  assert.deepEqual(r.trace.map((x) => x.via).sort(), ["MCP", "REST (API gateway)"]);
});

// ---------------------------------------------------------------- payment confirmation (Section 7.3)
test("payment: first message only prepares the payment and shows student, term, amount and balance - nothing is charged", async () => {
  const t = setup([call("request_payment", { term: "2026-FALL", amount: 500 }), text("Sure, I will pay it now!")]);
  const r = await t.agent.handle(t.session, "I want to pay 500 for 2026-FALL");
  assert.ok(!t.api.calls.some((c) => c.op === "payTuition"), "no Pay Tuition call yet");
  for (const needle of ["20260001", "2026-FALL", "500.00 USD", "3,000.00 USD", "yes"]) assert.ok(r.reply.includes(needle), `confirmation text shows ${needle}`);
  assert.ok(!r.reply.includes("pay it now"), "the LLM's own text cannot replace the confirmation summary");
  assert.equal(t.session.pending?.amount, 500);
});

test("payment: 'Can I pay 500?' is a question, not consent - the LLM's attempt to submit is blocked", async () => {
  const t = setup([call("request_payment", { term: "2026-FALL", amount: 500 }), text("x"), call("submit_confirmed_payment"), text("Done!")]);
  await t.agent.handle(t.session, "pay 500 for 2026-FALL");
  const r = await t.agent.handle(t.session, "Can I pay 500 instead?");
  assert.ok(!t.api.calls.some((c) => c.op === "payTuition"));
  const blocked = r.trace.find((x) => x.tool === "submit_confirmed_payment")!;
  assert.equal(blocked.ok, false);
  assert.match(blocked.summary, /BLOCKED/);
});

test("payment: explicit 'yes' in a later message submits exactly the prepared payment and reports the API result", async () => {
  const t = setup([call("request_payment", { term: "2026-FALL", amount: 500 }), text("x"), call("submit_confirmed_payment", { amount: 99999, studentNo: "20260002" }), text("Paid!")]);
  await t.agent.handle(t.session, "pay 500 for 2026-FALL");
  const r = await t.agent.handle(t.session, "yes");
  const pays = t.api.calls.filter((c) => c.op === "payTuition");
  assert.equal(pays.length, 1);
  assert.equal(pays[0].args.amount, 500, "amount comes from the prepared payment, not from LLM arguments");
  assert.equal(pays[0].args.studentNo, "20260001", "student comes from the login, not from LLM arguments");
  assert.match(pays[0].args.transactionId, /^AGT-20260001-[0-9a-f]{8}$/);
  assert.match(r.reply, /Payment recorded/);
  assert.match(r.reply, /Remaining balance: 2,500\.00 USD/);
  assert.equal(t.session.pending, null);
});

test("payment: the LLM cannot propose and confirm within the same turn", async () => {
  const t = setup([call("request_payment", { term: "2026-FALL", amount: 100 }), call("submit_confirmed_payment"), text("done")]);
  const r = await t.agent.handle(t.session, "yes please pay 100 for 2026-FALL");
  assert.ok(!t.api.calls.some((c) => c.op === "payTuition"));
  assert.match(r.trace.at(-1)!.summary, /BLOCKED/);
});

test("payment: submit without any prepared payment is blocked", async () => {
  const t = setup([call("submit_confirmed_payment"), text("ok")]);
  const r = await t.agent.handle(t.session, "yes");
  assert.ok(!t.api.calls.some((c) => c.op === "payTuition"));
  assert.match(r.trace[0].summary, /no prepared payment/);
});

test("payment: cancelling discards the prepared payment without calling the LLM", async () => {
  const t = setup([call("request_payment", { term: "2026-FALL", amount: 500 }), text("x")]);
  await t.agent.handle(t.session, "pay 500 for 2026-FALL");
  const calls = t.model.calls.length;
  const r = await t.agent.handle(t.session, "cancel");
  assert.equal(t.model.calls.length, calls);
  assert.equal(t.session.pending, null);
  assert.match(r.reply, /cancelled/);
});

test("payment: a prepared payment expires", async () => {
  const t = setup([call("request_payment", { term: "2026-FALL", amount: 500 }), text("x"), call("submit_confirmed_payment"), text("x")]);
  await t.agent.handle(t.session, "pay 500 for 2026-FALL");
  t.advance(PENDING_TTL_MS + 1);
  const r = await t.agent.handle(t.session, "yes");
  assert.ok(!t.api.calls.some((c) => c.op === "payTuition"));
  assert.match(r.trace.find((x) => x.tool === "submit_confirmed_payment")!.summary, /no prepared payment/);
});

test("payment: an amount above the live balance is not even prepared", async () => {
  const t = setup([call("request_payment", { term: "2026-FALL", amount: 5000 }), text("That is more than your balance of 3,000 USD.")]);
  const r = await t.agent.handle(t.session, "pay 5000 for 2026-FALL");
  assert.equal(t.session.pending, null);
  assert.match(r.reply, /3,000/);
  assert.equal(r.trace[0].ok, false);
});

test("payment: invalid amounts / terms are rejected by the agent before any API call", async () => {
  const t = setup([call("request_payment", { term: "2026-FALL", amount: -5 }), call("request_payment", { term: "fall", amount: 5 }), call("request_payment", { term: "2026-FALL", amount: 1.234 }), text("Invalid.")]);
  const r = await t.agent.handle(t.session, "pay -5");
  assert.equal(t.api.calls.length, 0);
  assert.equal(t.session.pending, null);
  assert.ok(r.trace.every((x) => !x.ok));
});

// ---------------------------------------------------------------- never claim success without the API saying so
test("payment: if the API rejects the payment the reply does not claim success", async () => {
  const t = setup([call("request_payment", { term: "2026-FALL", amount: 500 }), text("x"), call("submit_confirmed_payment"), text("Your payment of 500 was successful!")]);
  t.api.payStatusOverride = { status: 422, body: { error: { code: "AMOUNT_EXCEEDS_BALANCE", message: "Amount exceeds the outstanding balance 100.00" } } };
  await t.agent.handle(t.session, "pay 500 for 2026-FALL");
  const r = await t.agent.handle(t.session, "yes");
  assert.ok(!/successful|recorded/i.test(r.reply));
  assert.match(r.reply, /not made/);
});

test("payment: on a network failure the same transaction ID is kept so a retry cannot double-charge", async () => {
  const t = setup([call("request_payment", { term: "2026-FALL", amount: 500 }), text("x"), call("submit_confirmed_payment"), text("x"), call("submit_confirmed_payment"), text("x")]);
  t.api.payStatusOverride = { status: 0, body: { error: { code: "GATEWAY_UNREACHABLE", message: "timeout" } } };
  await t.agent.handle(t.session, "pay 500 for 2026-FALL");
  const r1 = await t.agent.handle(t.session, "yes");
  assert.match(r1.reply, /could not confirm/);
  assert.ok(t.session.pending, "pending payment kept");
  await t.agent.handle(t.session, "yes");
  const ids = t.api.calls.filter((c) => c.op === "payTuition").map((c) => c.args.transactionId);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

// ---------------------------------------------------------------- identity and robustness
test("identity: a studentNo supplied by the LLM (e.g. prompt injection) is ignored", async () => {
  const t = setup([call("get_my_tuition", { studentNo: "20260002", term: "2026-FALL" }), text("ok")]);
  await t.agent.handle(t.session, "Show the balance of student 20260002");
  assert.equal(t.api.calls[0].args.studentNo, "20260001");
});

test("robustness: unknown tools and malformed arguments are handled without crashing", async () => {
  const t = setup([
    { content: null, toolCalls: [{ id: "1", name: "drop_database", arguments: "{}" }, { id: "2", name: "get_my_tuition", arguments: "{not json" }] },
    text("I cannot do that."),
  ]);
  const r = await t.agent.handle(t.session, "do something weird");
  assert.equal(t.api.calls.length, 0);
  assert.ok(r.trace.every((x) => !x.ok));
  assert.match(r.reply, /cannot/);
});

test("robustness: an LLM outage returns a friendly message and charges nothing", async () => {
  const t = setup([]); // ScriptedModel throws when empty
  const r = await t.agent.handle(t.session, "hello");
  assert.match(r.reply, /temporarily unavailable/);
  assert.equal(t.api.calls.length, 0);
});

test("language: Turkish messages get Turkish confirmation and result texts", async () => {
  const t = setup([call("request_payment", { term: "2026-FALL", amount: 500 }), text("x"), call("submit_confirmed_payment"), text("x")]);
  const r1 = await t.agent.handle(t.session, "2026-FALL için 500 ödemek istiyorum");
  assert.match(r1.reply, /Lütfen bu ödemeyi onaylayın/);
  const r2 = await t.agent.handle(t.session, "evet");
  assert.match(r2.reply, /Ödeme kaydedildi/);
});

// ---------------------------------------------------------------- confirmation detector
test("confirmation detector: explicit consent only", () => {
  for (const ok of ["yes", "Yes, please proceed", "confirm", "evet", "Evet onaylıyorum", "go ahead", "ok"]) assert.equal(isExplicitConfirmation(ok), true, ok);
  for (const no of ["Can I pay 500?", "yes but make it 300", "no", "don't pay", "hayır", "iptal", "what is my balance", "yes, and what is my balance for spring? also tell me the deadline", "evet 500 öde", ""]) assert.equal(isExplicitConfirmation(no), false, no);
  for (const c of ["cancel", "no", "hayır", "iptal", "never mind"]) assert.equal(isCancellation(c), true, c);
});
