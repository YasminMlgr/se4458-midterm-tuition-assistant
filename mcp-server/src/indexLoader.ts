import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePolicyDocument } from "./chunker.js";
import { SearchIndex } from "./searchIndex.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DOC_PATH = path.resolve(here, "../docs/University_Tuition_Policies.md");

/** Reads and indexes the policy document. Call once at process start-up. */
export function buildIndexFromFile(docPath = process.env.POLICY_DOC_PATH ?? DEFAULT_DOC_PATH): SearchIndex {
  const markdown = readFileSync(docPath, "utf8");
  const parsed = parsePolicyDocument(markdown, path.basename(docPath));
  if (parsed.chunks.length === 0) throw new Error(`No sections found in ${docPath}`);
  const index = new SearchIndex(parsed);
  console.error(`[mcp] indexed ${index.chunkCount} sections from ${parsed.fileName} (${parsed.documentId})`);
  return index;
}
