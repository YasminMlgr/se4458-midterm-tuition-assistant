import { randomUUID } from "node:crypto";
import type { TuitionApi } from "./gatewayClient.js";
import type { PolicySearch } from "./policySearch.js";
import { detectLanguage, isCancellation, isExplicitConfirmation } from "./confirmation.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import type {
  AgentResult,
  AgentSession,
  AssistantToolCall,
  ChatMessage,
  ChatModel,
  PendingPayment,
  ToolSpec,
  TraceEntry,
} from "./types.js";

export const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY = 24;
const TERM_RE = /^\d{4}-(FALL|SPRING|SUMMER)$/;

export const TOOLS: ToolSpec[] = [
  {
    name: "search_tuition_policies",
    description:
      "Search the university tuition POLICY document via MCP (deadlines, installments, late fees, scholarships, refunds/withdrawals, payment rules). Returns sections with section ID, heading and text. Contains no student-specific data.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Policy question or keywords, e.g. 'fall payment deadline'" } },
      required: ["query"],
    },
  },
  {
    name: "get_my_tuition",
    description:
      "Get the logged-in student's LIVE tuition total, amount paid and balance from the Tuition API. Optionally for one term (e.g. 2026-FALL); without a term it returns the overall balance plus a per-term breakdown.",
    parameters: {
      type: "object",
      properties: { term: { type: "string", description: "Academic term such as 2026-FALL or 2027-SPRING (optional)" } },
    },
  },
  {
    name: "request_payment",
    description:
      "Prepare a tuition payment for the logged-in student. Does NOT charge anything: the system shows a confirmation summary and waits for the student's explicit approval in their next message.",
    parameters: {
      type: "object",
      properties: {
        term: { type: "string", description: "Term to pay, e.g. 2026-FALL" },
        amount: { type: "number", description: "Positive amount with at most 2 decimals" },
      },
      required: ["term", "amount"],
    },
  },
  {
    name: "submit_confirmed_payment",
    description:
      "Submit the prepared payment. Call ONLY when the student's latest message explicitly confirms it. Takes no arguments; the amount and term are fixed by request_payment.",
    parameters: { type: "object", properties: {} },
  },
];

export interface AgentDeps {
  model: ChatModel;
  api: TuitionApi;
  policies: PolicySearch;
  now?: () => number;
}

interface TurnContext {
  session: AgentSession;
  trace: TraceEntry[];
  confirmedThisTurn: boolean;
  proposedThisTurn: boolean;
  paymentOutcome: null | { status: number; body: any; pending: PendingPayment };
  paymentAttempted: boolean;
}

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export class TuitionAgent {
  private now: () => number;
  constructor(private deps: AgentDeps) {
    this.now = deps.now ?? Date.now;
  }

  async handle(session: AgentSession, userMessage: string): Promise<AgentResult> {
    const trace: TraceEntry[] = [];
    session.lang = detectLanguage(userMessage, session.lang);

    if (session.pending && this.now() - session.pending.createdAt > PENDING_TTL_MS) {
      session.pending = null;
    }
    const confirmedThisTurn = !!session.pending && isExplicitConfirmation(userMessage);

    // The student declined a prepared payment: clear it deterministically, no LLM needed.
    if (session.pending && !confirmedThisTurn && isCancellation(userMessage)) {
      session.pending = null;
      trace.push({ step: 1, tool: "cancel_pending_payment", via: "agent guard", args: {}, ok: true, summary: "Student cancelled; pending payment discarded", ms: 0 });
      const reply = session.lang === "tr" ? "Tamam, ödeme iptal edildi. Hiçbir ücret tahsil edilmedi." : "Okay, the payment was cancelled. Nothing was charged.";
      return this.finish(session, userMessage, reply, trace);
    }

    const ctx: TurnContext = { session, trace, confirmedThisTurn, proposedThisTurn: false, paymentOutcome: null, paymentAttempted: false };
    const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...session.history.slice(-MAX_HISTORY), { role: "user", content: userMessage }];

    let llmText = "";
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const reply = await this.deps.model.complete(messages, TOOLS);
        if (reply.toolCalls.length === 0) {
          llmText = (reply.content ?? "").trim();
          break;
        }
        const toolCalls: AssistantToolCall[] = reply.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.arguments },
        }));
        messages.push({ role: "assistant", content: reply.content, tool_calls: toolCalls });
        for (const call of reply.toolCalls) {
          const result = await this.runTool(ctx, call.name, call.arguments);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 8000) });
        }
        if (round === MAX_TOOL_ROUNDS - 1) llmText = "";
      }
    } catch (err) {
      trace.push({ step: trace.length + 1, tool: "llm", via: "agent guard", args: {}, ok: false, summary: `LLM error: ${(err as Error).message}`.slice(0, 200), ms: 0 });
      // If a payment was already submitted this turn we must still report the real outcome below.
      if (!ctx.paymentOutcome) {
        const msg = session.lang === "tr" ? "AI servisine şu an ulaşılamıyor. Lütfen biraz sonra tekrar deneyin. Hiçbir ödeme yapılmadı." : "The AI service is temporarily unavailable. Please try again shortly. No payment was made.";
        return this.finish(session, userMessage, msg, trace);
      }
    }

    // Safety-critical messages are generated by code, not by the LLM.
    let reply: string;
    if (ctx.paymentOutcome) reply = this.paymentMessage(session.lang, ctx.paymentOutcome);
    else if (ctx.proposedThisTurn && session.pending) reply = this.confirmationMessage(session.lang, session.pending);
    else reply = llmText || (session.lang === "tr" ? "Üzgünüm, bu isteği tamamlayamadım. Lütfen tekrar dener misiniz?" : "Sorry, I could not complete that. Could you try again?");

    return this.finish(session, userMessage, reply, trace);
  }

  // ------------------------------------------------------------------ tools

  private async runTool(ctx: TurnContext, name: string, rawArgs: string): Promise<unknown> {
    const started = Date.now();
    let args: Record<string, any> = {};
    try {
      args = rawArgs ? JSON.parse(rawArgs) : {};
      if (typeof args !== "object" || args === null || Array.isArray(args)) throw new Error("not an object");
    } catch {
      return this.record(ctx, name, "agent guard", {}, false, "Invalid tool arguments (not JSON)", started, { error: "Invalid JSON arguments" });
    }
    switch (name) {
      case "search_tuition_policies":
        return this.toolSearch(ctx, args, started);
      case "get_my_tuition":
        return this.toolGetTuition(ctx, args, started);
      case "request_payment":
        return this.toolRequestPayment(ctx, args, started);
      case "submit_confirmed_payment":
        return this.toolSubmitPayment(ctx, started);
      default:
        return this.record(ctx, name, "agent guard", {}, false, "Unknown tool", started, { error: `Unknown tool '${name}'` });
    }
  }

  private record(ctx: TurnContext, tool: string, via: TraceEntry["via"], args: Record<string, unknown>, ok: boolean, summary: string, started: number, result: unknown) {
    ctx.trace.push({ step: ctx.trace.length + 1, tool, via, args, ok, summary, ms: Date.now() - started });
    return result;
  }

  private async toolSearch(ctx: TurnContext, args: Record<string, any>, started: number) {
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 500) : "";
    if (query.length < 2) return this.record(ctx, "search_tuition_policies", "agent guard", { query }, false, "query is required", started, { error: "query must be a non-empty string" });
    const res = await this.deps.policies.search(query);
    const sections: string[] = res.ok ? (res.data.matches ?? []).map((m: any) => m.section) : [];
    return this.record(
      ctx, "search_tuition_policies", "MCP", { query }, res.ok,
      res.ok ? (sections.length ? `${sections.length} match(es): sections ${sections.join(", ")}` : "no matching section") : String(res.data.error ?? "MCP error"),
      started, res.data
    );
  }

  private parseTerm(value: unknown): string | null | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const t = String(value).trim().toUpperCase();
    return TERM_RE.test(t) ? t : null; // null = invalid
  }

  private async toolGetTuition(ctx: TurnContext, args: Record<string, any>, started: number) {
    const term = this.parseTerm(args.term);
    if (term === null) return this.record(ctx, "get_my_tuition", "agent guard", { term: args.term }, false, "invalid term", started, { error: "term must look like 2026-FALL or 2027-SPRING" });
    // Any 'studentNo' the model may have supplied is ignored: identity is always the logged-in student.
    const res = await this.deps.api.getTuition(ctx.session.token, ctx.session.studentNo, term);
    const ok = res.status === 200;
    return this.record(
      ctx, "get_my_tuition", "REST (API gateway)", { studentNo: ctx.session.studentNo, ...(term ? { term } : {}) }, ok,
      ok ? `GET /api/v1/tuition/${ctx.session.studentNo}${term ? `?term=${term}` : ""} -> 200, balance ${res.body.balance} ${res.body.currency}` : `HTTP ${res.status} ${res.body?.error?.code ?? ""}`.trim(),
      started, ok ? res.body : { error: res.body?.error ?? { code: "REQUEST_FAILED" }, httpStatus: res.status }
    );
  }

  private async toolRequestPayment(ctx: TurnContext, args: Record<string, any>, started: number) {
    const term = this.parseTerm(args.term);
    const amount = typeof args.amount === "string" ? Number(args.amount) : args.amount;
    const cents = typeof amount === "number" && Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
    if (!term || !(cents > 0) || Math.abs(amount * 100 - cents) > 1e-6) {
      return this.record(ctx, "request_payment", "agent guard", { term: args.term, amount: args.amount }, false, "invalid term or amount", started, {
        error: "term must look like 2026-FALL and amount must be a positive number with at most 2 decimals",
      });
    }
    const live = await this.deps.api.getTuition(ctx.session.token, ctx.session.studentNo, term);
    if (live.status !== 200) {
      return this.record(ctx, "request_payment", "REST (API gateway)", { term, amount }, false, `balance check failed: HTTP ${live.status} ${live.body?.error?.code ?? ""}`.trim(), started, {
        error: live.body?.error ?? { code: "REQUEST_FAILED" },
      });
    }
    const balance: number = live.body.balance;
    if (balance <= 0 || Math.round(balance * 100) < cents) {
      return this.record(ctx, "request_payment", "REST (API gateway)", { term, amount }, false, `amount exceeds balance (${money(balance)})`, started, {
        error: { code: "AMOUNT_EXCEEDS_BALANCE", message: balance <= 0 ? "No outstanding balance for this term" : `Amount exceeds the current balance of ${money(balance)}` },
        currentBalance: balance,
        currency: live.body.currency,
      });
    }
    ctx.session.pending = {
      studentNo: ctx.session.studentNo, term, amount: cents / 100, balance, currency: live.body.currency,
      transactionId: `AGT-${ctx.session.studentNo}-${randomUUID().slice(0, 8)}`, createdAt: this.now(),
    };
    ctx.proposedThisTurn = true;
    return this.record(ctx, "request_payment", "REST (API gateway)", { term, amount: cents / 100 }, true, `payment prepared, awaiting student confirmation (balance ${money(balance)})`, started, {
      status: "PENDING_CONFIRMATION",
      note: "The system will now show the confirmation summary. Do not call submit_confirmed_payment until the student confirms in a NEW message.",
    });
  }

  private async toolSubmitPayment(ctx: TurnContext, started: number) {
    const block = (reason: string) =>
      this.record(ctx, "submit_confirmed_payment", "agent guard", {}, false, `BLOCKED: ${reason}`, started, { error: { code: "PAYMENT_BLOCKED", message: reason } });
    const pending = ctx.session.pending;
    if (!pending) return block("no prepared payment exists");
    if (ctx.proposedThisTurn) return block("the student has not confirmed yet (confirmation must come in a new message)");
    if (!ctx.confirmedThisTurn) return block("the student's latest message is not an explicit confirmation");
    if (ctx.paymentAttempted) return block("a payment was already submitted in this turn");
    ctx.paymentAttempted = true;

    const res = await this.deps.api.payTuition(ctx.session.token, {
      studentNo: pending.studentNo, term: pending.term, amount: pending.amount, transactionId: pending.transactionId,
    });
    ctx.paymentOutcome = { status: res.status, body: res.body, pending };
    // Keep the prepared payment (same transactionId) only if the outcome is unknown, so a retry cannot double-charge.
    const unknown = res.status === 0 || res.status >= 500;
    if (!unknown) ctx.session.pending = null;
    return this.record(
      ctx, "submit_confirmed_payment", "REST (API gateway)", { term: pending.term, amount: pending.amount, transactionId: pending.transactionId }, res.status === 201,
      res.status === 201 ? `POST /api/v1/tuition/payments -> 201, remaining balance ${res.body.remainingBalance}` : `HTTP ${res.status} ${res.body?.error?.code ?? ""}`.trim(),
      started, res.status === 201 ? res.body : { error: res.body?.error ?? { code: "REQUEST_FAILED" }, httpStatus: res.status }
    );
  }

  // ---------------------------------------------------- deterministic texts

  confirmationMessage(lang: "en" | "tr", p: PendingPayment): string {
    return lang === "tr"
      ? `Lütfen bu ödemeyi onaylayın:\n• Öğrenci: ${p.studentNo}\n• Dönem: ${p.term}\n• Tutar: ${money(p.amount)} ${p.currency}\n• Mevcut bakiye: ${money(p.balance)} ${p.currency}\n\nOnaylamak için "evet", vazgeçmek için "iptal" yazın. Henüz hiçbir ücret tahsil edilmedi.`
      : `Please confirm this payment:\n• Student: ${p.studentNo}\n• Term: ${p.term}\n• Amount: ${money(p.amount)} ${p.currency}\n• Current balance: ${money(p.balance)} ${p.currency}\n\nReply "yes" to confirm or "cancel" to stop. Nothing has been charged yet.`;
  }

  paymentMessage(lang: "en" | "tr", o: { status: number; body: any; pending: PendingPayment }): string {
    const tr = lang === "tr";
    const p = o.pending;
    if (o.status === 201) {
      const b = o.body;
      return tr
        ? `Ödeme kaydedildi ✅\n• İşlem no: ${b.transactionId}\n• Ödenen tutar: ${money(b.paidAmount)} ${b.currency}\n• Bu dönem toplam ödenen: ${money(b.totalPaid)} ${b.currency}\n• Kalan bakiye: ${money(b.remainingBalance)} ${b.currency}`
        : `Payment recorded ✅\n• Transaction ID: ${b.transactionId}\n• Paid now: ${money(b.paidAmount)} ${b.currency}\n• Total paid this term: ${money(b.totalPaid)} ${b.currency}\n• Remaining balance: ${money(b.remainingBalance)} ${b.currency}`;
    }
    const code = o.body?.error?.code;
    if (o.status === 0 || o.status >= 500) {
      return tr
        ? "Ödemenin sonucunu doğrulayamadım; sistem başarı bildirmedi. Tekrar denemeden önce lütfen bakiyenizi kontrol edin. Tekrar denerseniz aynı işlem numarası kullanılır, çift ödeme olmaz."
        : "I could not confirm the result of the payment; the system did not report success. Please check your balance before retrying. A retry reuses the same transaction ID, so you will not be charged twice.";
    }
    if (code === "DUPLICATE_TRANSACTION") {
      return tr ? "Bu ödeme zaten kaydedilmiş görünüyor (aynı işlem numarası). Güncel durumu görmek için bakiyenizi sorabilirsiniz." : "This payment appears to be recorded already (same transaction ID). Ask for your balance to see the current status.";
    }
    if (code === "AMOUNT_EXCEEDS_BALANCE") {
      return tr ? `Ödeme yapılmadı: tutar güncel bakiyeyi aşıyor. ${o.body.error.message}` : `The payment was not made: the amount exceeds the current balance. ${o.body.error.message}`;
    }
    if (o.status === 401 || o.status === 403) {
      return tr ? "Ödeme yapılmadı: oturumunuzun yetkisi yok veya süresi doldu. Lütfen yeniden giriş yapın." : "The payment was not made: your session is not authorized or has expired. Please log in again.";
    }
    return tr ? `Ödeme yapılmadı (${code ?? `HTTP ${o.status}`}). Hiçbir ücret tahsil edilmedi.` : `The payment was not made (${code ?? `HTTP ${o.status}`}). Nothing was charged.`;
  }

  private finish(session: AgentSession, userMessage: string, reply: string, trace: TraceEntry[]): AgentResult {
    session.history.push({ role: "user", content: userMessage }, { role: "assistant", content: reply });
    if (session.history.length > MAX_HISTORY) session.history.splice(0, session.history.length - MAX_HISTORY);
    return { reply, trace, pending: session.pending };
  }
}
