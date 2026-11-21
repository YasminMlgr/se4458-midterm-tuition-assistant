import { TuitionAgent } from "../src/agent.js";
import type { ApiResponse, TuitionApi } from "../src/gatewayClient.js";
import type { PolicySearch } from "../src/policySearch.js";
import type { AgentSession, ChatMessage, ChatModel, ModelReply, ToolSpec } from "../src/types.js";

type Step = ModelReply | ((messages: ChatMessage[]) => ModelReply);

/** Scripted stand-in for the LLM: returns the prepared replies in order. */
export class ScriptedModel implements ChatModel {
  calls: { messages: ChatMessage[]; tools: ToolSpec[] }[] = [];
  constructor(private steps: Step[]) {}
  async complete(messages: ChatMessage[], tools: ToolSpec[]): Promise<ModelReply> {
    this.calls.push({ messages: [...messages], tools });
    const step = this.steps.shift();
    if (!step) throw new Error("ScriptedModel: no more scripted replies");
    return typeof step === "function" ? step(messages) : step;
  }
}

export const call = (name: string, args: Record<string, unknown> = {}, id = `c_${name}`): ModelReply => ({
  content: null,
  toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
});
export const text = (content: string): ModelReply => ({ content, toolCalls: [] });

export class FakeApi implements TuitionApi {
  calls: { op: string; args: any }[] = [];
  balance = 3000;
  paid = 0;
  currency = "USD";
  payStatusOverride: ApiResponse | null = null;
  async login(): Promise<ApiResponse> {
    return { status: 200, body: { accessToken: "x.y.z" } };
  }
  async getTuition(token: string, studentNo: string, term?: string): Promise<ApiResponse> {
    this.calls.push({ op: "getTuition", args: { token, studentNo, term } });
    if (term && term !== "2026-FALL") return { status: 404, body: { error: { code: "TUITION_NOT_FOUND", message: "none" } } };
    return {
      status: 200,
      body: { studentNo, term: term ?? null, scope: term ? "TERM" : "OVERALL", currency: this.currency, tuitionTotal: 3000, paidTotal: this.paid, balance: this.balance, terms: [] },
    };
  }
  async payTuition(token: string, payload: any): Promise<ApiResponse> {
    this.calls.push({ op: "payTuition", args: { token, ...payload } });
    if (this.payStatusOverride) return this.payStatusOverride;
    this.balance -= payload.amount;
    this.paid += payload.amount;
    return {
      status: 201,
      body: { status: "SUCCESS", transactionId: payload.transactionId, studentNo: payload.studentNo, term: payload.term, currency: this.currency, paidAmount: payload.amount, totalPaid: this.paid, remainingBalance: this.balance },
    };
  }
}

export class FakePolicies implements PolicySearch {
  queries: string[] = [];
  async search(query: string) {
    this.queries.push(query);
    return {
      ok: true,
      data: {
        document: "University_Tuition_Policies.md",
        documentId: "UNI-TUITION-2026-01",
        matches: [{ section: "2.1", heading: "Fall term", text: "The payment deadline for the Fall 2026 term is September 30, 2026." }],
      },
    };
  }
}

export function setup(steps: Step[]) {
  const model = new ScriptedModel(steps);
  const api = new FakeApi();
  const policies = new FakePolicies();
  let clock = 1_000_000;
  const agent = new TuitionAgent({ model, api, policies, now: () => clock });
  const session: AgentSession = { studentNo: "20260001", token: "jwt-of-20260001", history: [], pending: null, lang: "en" };
  return { model, api, policies, agent, session, advance: (ms: number) => (clock += ms) };
}
