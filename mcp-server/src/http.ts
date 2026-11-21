import { buildIndexFromFile } from "./indexLoader.js";
import { createHttpApp } from "./httpApp.js";

const index = buildIndexFromFile(); // indexed once, before the first request
const port = Number(process.env.PORT) || 3100;
createHttpApp(index, { authToken: process.env.MCP_AUTH_TOKEN || undefined }).listen(port, () => {
  console.error(`[mcp] Streamable HTTP MCP server listening on :${port}  (POST /mcp, GET /health)`);
});
