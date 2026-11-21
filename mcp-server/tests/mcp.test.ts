import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPolicyMcpServer, TOOL_NAME } from "../src/mcpServer.js";
import { createHttpApp } from "../src/httpApp.js";
import { index } from "./helpers.js";

const parse = (result: any) => JSON.parse(result.content[0].text);

test("MCP protocol: the tool is listed with its input schema", async () => {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createPolicyMcpServer(index);
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);

  const { tools } = await client.listTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, TOOL_NAME);
  assert.equal(TOOL_NAME, "search_tuition_policies");
  assert.ok((tools[0].inputSchema.required as string[]).includes("query"));
  await client.close();
});

test("MCP protocol: calling the tool returns document, documentId and matches with section/heading/text", async () => {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await createPolicyMcpServer(index).connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);

  const out = parse(await client.callTool({ name: TOOL_NAME, arguments: { query: "installment rules" } }));
  assert.equal(out.document, "University_Tuition_Policies.md");
  assert.equal(out.documentId, "UNI-TUITION-2026-01");
  assert.ok(out.matches.length >= 1);
  assert.match(out.matches[0].section, /^3\./);
  assert.ok(out.matches[0].heading && out.matches[0].text);

  const none = parse(await client.callTool({ name: TOOL_NAME, arguments: { query: "quantum chromodynamics" } }));
  assert.deepEqual(none.matches, []);
  assert.match(none.message, /No relevant/);

  const bad: any = await client.callTool({ name: TOOL_NAME, arguments: { query: "x" } });
  assert.equal(bad.isError, true, "too-short query is rejected by the input schema");
  await client.close();
});

test("Streamable HTTP transport works end-to-end and /health reports the index", async () => {
  const app = createHttpApp(index);
  const httpServer = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = httpServer.address() as AddressInfo;
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.sections, index.chunkCount);

    const client = new Client({ name: "http-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const out = parse(await client.callTool({ name: TOOL_NAME, arguments: { query: "refund withdrawal" } }));
    assert.match(out.matches[0].section, /^6\./);
    await client.close();
  } finally {
    httpServer.close();
  }
});

test("Streamable HTTP: optional bearer token is enforced", async () => {
  const app = createHttpApp(index, { authToken: "s3cret" });
  const httpServer = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = httpServer.address() as AddressInfo;
  try {
    const noAuth = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(noAuth.status, 401);

    const client = new Client({ name: "http-test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: "Bearer s3cret" } },
      })
    );
    const out = parse(await client.callTool({ name: TOOL_NAME, arguments: { query: "late fee" } }));
    assert.equal(out.matches[0].section, "4.1");
    await client.close();
  } finally {
    httpServer.close();
  }
});
