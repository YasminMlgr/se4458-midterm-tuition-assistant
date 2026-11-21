import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePolicyDocument } from "../src/chunker.js";
import { DEFAULT_DOC_PATH } from "../src/indexLoader.js";

const doc = parsePolicyDocument(readFileSync(DEFAULT_DOC_PATH, "utf8"), "University_Tuition_Policies.md");

test("extracts the document ID and title", () => {
  assert.equal(doc.documentId, "UNI-TUITION-2026-01");
  assert.equal(doc.title, "University Tuition Policies");
});

test("creates one chunk per numbered section that has its own text", () => {
  const ids = doc.chunks.map((c) => c.section);
  for (const expected of ["1", "2.1", "2.2", "2.3", "3.1", "3.2", "3.3", "3.4", "4.1", "4.2", "4.3", "5.1", "5.2", "6.1", "6.2", "6.3", "7.1", "7.2", "7.3", "7.4", "8.1", "8.2", "8.3", "8.4", "9"]) {
    assert.ok(ids.includes(expected), `missing section ${expected}`);
  }
  // grouping headings without body text are not chunks of their own
  for (const grouping of ["2", "3", "4", "5", "6", "7", "8"]) assert.ok(!ids.includes(grouping));
});

test("keeps heading, parent heading and clean text for a section", () => {
  const c = doc.chunks.find((x) => x.section === "3.2")!;
  assert.equal(c.heading, "Number and size of installments");
  assert.equal(c.parentHeading, "Installment policy");
  assert.match(c.text, /up to three installments/);
  assert.ok(!c.text.includes("**"), "markdown bold markers are stripped");
});

test("does not treat headings inside code fences as sections", () => {
  const md = "# T\n**Document ID:** X-1\n## 1. A\nbody\n```\n## 2. Fake\n```\n";
  const parsed = parsePolicyDocument(md, "t.md");
  assert.deepEqual(parsed.chunks.map((c) => c.section), ["1"]);
});
