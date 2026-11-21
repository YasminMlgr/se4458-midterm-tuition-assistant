/**
 * Splits the policy markdown into addressable sections.
 *
 * A chunk is created for every numbered heading that has its own body text
 * (e.g. "## 1. Scope and terminology" or "### 2.1 Fall term"). Headings that only group
 * sub-sections (e.g. "## 2. Payment deadlines") contribute their title as context ("parentHeading")
 * to their children but do not become chunks themselves.
 */
export interface PolicyChunk {
  /** Section ID as written in the document, e.g. "3.2" */
  section: string;
  heading: string;
  /** Heading of the enclosing top-level section, e.g. "Installment policy" for 3.2 */
  parentHeading: string;
  text: string;
}

export interface ParsedDocument {
  documentId: string;
  title: string;
  fileName: string;
  chunks: PolicyChunk[];
}

const HEADING_RE = /^(#{2,3})\s+(\d+(?:\.\d+)*)\.?\s+(.+?)\s*$/;

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parsePolicyDocument(markdown: string, fileName: string): ParsedDocument {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const idMatch = /\*\*Document ID:\*\*\s*([A-Za-z0-9_-]+)/.exec(markdown);
  const titleMatch = /^#\s+(.+)$/m.exec(markdown);

  const chunks: PolicyChunk[] = [];
  let current: { section: string; heading: string; parent: string; body: string[] } | null = null;
  let parentHeading = "";
  let inCodeBlock = false;

  const flush = () => {
    if (!current) return;
    const text = stripMarkdown(current.body.join("\n"));
    if (text) {
      chunks.push({ section: current.section, heading: current.heading, parentHeading: current.parent, text });
    }
    current = null;
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) inCodeBlock = !inCodeBlock;
    const m = !inCodeBlock ? HEADING_RE.exec(line) : null;
    if (m) {
      flush();
      const [, hashes, section, heading] = m;
      if (hashes.length === 2) parentHeading = heading;
      current = { section, heading, parent: hashes.length === 2 ? "" : parentHeading, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  flush();

  return {
    documentId: idMatch ? idMatch[1] : fileName,
    title: titleMatch ? titleMatch[1].trim() : fileName,
    fileName,
    chunks,
  };
}
