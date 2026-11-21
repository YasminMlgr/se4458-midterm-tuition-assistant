import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildIndexFromFile } from "./indexLoader.js";
import { createPolicyMcpServer } from "./mcpServer.js";

// Local / development transport (stdout is reserved for the protocol, logs go to stderr).
const server = createPolicyMcpServer(buildIndexFromFile());
await server.connect(new StdioServerTransport());
