# MCP retrieval tests (local run)

Run on 22 Nov 2026 against the MCP server started locally (`cd mcp-server && PORT=3101 npx tsx src/http.ts`), called with the agent's own MCP client
(`agent/src/policySearch.ts`, Streamable HTTP, tool `search_tuition_policies`). The indexed document is `University_Tuition_Policies.md` (25 sections, indexed at start-up).
This is a **local** run; the same queries still have to be repeated against the deployed `tuition-mcp` for the final evidence.

| # | Query | Top section references returned |
|---|---|---|
| 1 | When is the Fall tuition deadline? | 8.1, 2.1 (deadline September 30, 2026), 2.2 |
| 2 | Can I pay my balance in installments? | 8.2, 3.2 (up to three installments), 3.4 (partial payment ≠ approval) |
| 3 | What is the refund after early withdrawal? | 6.1 (80% within 14 days, subject to review), 6.2, 6.3 |

Each result contains `document`, `documentId`, `query`, and `matches[]` with `section`, `heading`, `text`, `score`.
