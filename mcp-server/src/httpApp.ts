import express from "express";
import type { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPolicyMcpServer } from "./mcpServer.js";
import type { SearchIndex } from "./searchIndex.js";

/**
 * Streamable-HTTP MCP endpoint (stateless: one transport per request) so the server can run in the cloud.
 * This path is deliberately NOT behind the REST API gateway: MCP only serves policy text.
 * An optional shared secret (MCP_AUTH_TOKEN) keeps random callers away from the public URL.
 */
export function createHttpApp(index: SearchIndex, opts: { authToken?: string } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", document: index.fileName, documentId: index.documentId, sections: index.chunkCount, indexedAt: index.builtAt });
  });

  const guard = (req: Request, res: Response, next: NextFunction) => {
    if (opts.authToken && req.get("authorization") !== `Bearer ${opts.authToken}`) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
      return;
    }
    next();
  };

  app.post("/mcp", guard, async (req, res) => {
    const server = createPolicyMcpServer(index);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp] request failed", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });
  };
  app.get("/mcp", guard, notAllowed);
  app.delete("/mcp", guard, notAllowed);
  return app;
}
