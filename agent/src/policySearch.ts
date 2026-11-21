import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface PolicySearch {
  search(query: string): Promise<{ ok: boolean; data: any }>;
}

/**
 * MCP client. The MCP server is reached directly (MCP_URL, Streamable HTTP) - policy text does not go through the
 * REST API gateway. For local development MCP_COMMAND/MCP_ARGS starts the server over stdio instead.
 */
export class McpPolicySearch implements PolicySearch {
  private client: Client | null = null;

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({ name: "tuition-agent", version: "1.0.0" });
    const url = process.env.MCP_URL;
    if (url) {
      const headers: Record<string, string> = {};
      if (process.env.MCP_AUTH_TOKEN) headers.Authorization = `Bearer ${process.env.MCP_AUTH_TOKEN}`;
      await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
    } else if (process.env.MCP_COMMAND) {
      await client.connect(
        new StdioClientTransport({
          command: process.env.MCP_COMMAND,
          args: (process.env.MCP_ARGS ?? "").split(" ").filter(Boolean),
        })
      );
    } else {
      throw new Error("Set MCP_URL (HTTP) or MCP_COMMAND/MCP_ARGS (stdio)");
    }
    this.client = client;
    return client;
  }

  async search(query: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const client = await this.connect();
        const result: any = await client.callTool({ name: "search_tuition_policies", arguments: { query } });
        const text = result.content?.[0]?.text ?? "{}";
        if (result.isError) return { ok: false, data: { error: text } };
        return { ok: true, data: JSON.parse(text) };
      } catch (err) {
        this.client = null; // reconnect once (e.g. server restarted / idle connection dropped)
        if (attempt === 1) return { ok: false, data: { error: `MCP server unavailable: ${(err as Error).message}` } };
      }
    }
    return { ok: false, data: { error: "MCP server unavailable" } };
  }
}
