import { TuitionAgent } from "./agent.js";
import { createAgentApp } from "./agentApp.js";
import { OpenAiCompatibleModel } from "./llm.js";
import { GatewayClient } from "./gatewayClient.js";
import { McpPolicySearch } from "./policySearch.js";

const api = new GatewayClient();
const agent = new TuitionAgent({ model: new OpenAiCompatibleModel(), api, policies: new McpPolicySearch() });
const port = Number(process.env.PORT) || 3200;
createAgentApp({ agent, api }).listen(port, () => {
  console.log(`AI Tuition Assistant listening on :${port}  (gateway: ${process.env.GATEWAY_URL ?? "http://localhost:8000"}, model: ${process.env.LLM_MODEL ?? "gemini-flash-latest"})`);
});
