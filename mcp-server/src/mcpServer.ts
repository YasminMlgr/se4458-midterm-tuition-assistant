import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SearchIndex } from "./searchIndex.js";

export const TOOL_NAME = "search_tuition_policies";

/**
 * Builds an MCP server around an already-built index. Creating a server is cheap;
 * the (expensive) indexing happens once, outside, when the process starts.
 */
export function createPolicyMcpServer(index: SearchIndex): McpServer {
  const server = new McpServer({ name: "tuition-policies", version: "1.0.0" });

  server.registerTool(
    TOOL_NAME,
    {
      title: "Search tuition policies",
      description:
        "Searches the university tuition policy document (payment deadlines, installments, late fees, scholarships, " +
        "refunds/withdrawals, payment instructions). Returns the most relevant sections with section ID, heading, " +
        "document ID and text. Use it for POLICY questions only. It contains NO student-specific data: live balances and " +
        "payments must come from the Tuition REST API.",
      inputSchema: {
        query: z.string().trim().min(2).max(500).describe("Natural-language policy question or keywords"),
        max_results: z.number().int().min(1).max(5).optional().describe("Number of sections to return (default 3)"),
      },
    },
    async ({ query, max_results }) => {
      const hits = index.search(query, max_results ?? 3);
      const payload = {
        document: index.fileName,
        documentId: index.documentId,
        query,
        matches: hits.map((h) => ({ section: h.section, heading: h.heading, text: h.text, score: h.score })),
      };
      if (hits.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ...payload, message: "No relevant policy section was found for this query." }),
            },
          ],
        };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    }
  );

  return server;
}
