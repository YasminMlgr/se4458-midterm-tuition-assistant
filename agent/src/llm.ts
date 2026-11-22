import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatModel, ModelReply, ToolSpec } from "./types.js";

/**
 * LLM client for any OpenAI-compatible chat-completions endpoint with function calling.
 * Default: Google Gemini's OpenAI-compatible endpoint (free tier). Switch provider with env vars only:
 *   LLM_BASE_URL, LLM_MODEL, LLM_API_KEY
 */
export class OpenAiCompatibleModel implements ChatModel {
  private client: OpenAI;
  constructor(
    private model = process.env.LLM_MODEL ?? "gemini-flash-latest",
    baseURL = process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey = process.env.LLM_API_KEY ?? process.env.GEMINI_API_KEY ?? ""
  ) {
    if (!apiKey) throw new Error("LLM_API_KEY (or GEMINI_API_KEY) is not set");
    this.client = new OpenAI({ apiKey, baseURL, timeout: 45_000, maxRetries: 2 });
  }

  async complete(messages: ChatMessage[], tools: ToolSpec[]): Promise<ModelReply> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.2,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      tools: tools.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: "auto",
    });
    const msg = res.choices[0]?.message;
    return {
      content: msg?.content ?? null,
      toolCalls: (msg?.tool_calls ?? [])
        .filter((c) => c.type === "function")
        .map((c) => ({
          id: c.id || `call_${randomUUID().slice(0, 8)}`,
          name: (c as any).function.name,
          arguments: (c as any).function.arguments || "{}",
          ...((c as any).extra_content ? { extra_content: (c as any).extra_content } : {}),
        })),
    };
  }
}
