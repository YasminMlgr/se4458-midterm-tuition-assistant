export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: AssistantToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface AssistantToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /** Gemini (OpenAI-compat) thought_signature etc.; must be echoed back verbatim on the next request. */
  extra_content?: unknown;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON schema of the arguments */
  parameters: Record<string, unknown>;
}

export interface ModelReply {
  content: string | null;
  toolCalls: { id: string; name: string; arguments: string; extra_content?: unknown }[];
}

/** The only thing the agent needs from an LLM. Real: OpenAI-compatible API (Gemini/OpenAI). Tests: a scripted fake. */
export interface ChatModel {
  complete(messages: ChatMessage[], tools: ToolSpec[]): Promise<ModelReply>;
}

export interface TraceEntry {
  step: number;
  tool: string;
  via: "MCP" | "REST (API gateway)" | "agent guard";
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  ms: number;
}

export interface PendingPayment {
  studentNo: string;
  term: string;
  amount: number;
  balance: number;
  currency: string;
  transactionId: string;
  createdAt: number;
}

export interface AgentSession {
  studentNo: string;
  token: string;
  history: ChatMessage[];
  pending: PendingPayment | null;
  lang: "en" | "tr";
}

export interface AgentResult {
  reply: string;
  trace: TraceEntry[];
  pending: PendingPayment | null;
}
