import { test } from "node:test";
import assert from "node:assert/strict";
import { index } from "./helpers.js";
import { stem, tokenize } from "../src/searchIndex.js";

const sections = (q: string, n = 3) => index.search(q, n).map((h) => h.section);

// --- three distinct retrieval scenarios required by the assignment -------------------------------
test("retrieval #1 - payment deadline -> Section 2.1 (Fall term deadline)", () => {
  const hits = index.search("When is the Fall tuition payment deadline?", 3);
  assert.ok(hits.map((h) => h.section).includes("2.1"), `got ${JSON.stringify(sections("When is the Fall tuition payment deadline?"))}`);
  assert.match(hits.find((h) => h.section === "2.1")!.text, /September 30, 2026/);
});

test("retrieval #2 - installment rules -> Section 3.x", () => {
  const hits = index.search("installment rules", 3);
  assert.ok(hits.length > 0);
  assert.match(hits[0].section, /^3\./);
  assert.ok(hits.some((h) => h.section === "3.2"), "the number/size rule (3.2) is among the results");
});

test("retrieval #3 - refund after withdrawal -> Section 6.x with the 80% / 14 days rule", () => {
  const hits = index.search("Can I get a refund if I withdraw from the term?", 3);
  assert.match(hits[0].section, /^6\./);
  const early = hits.find((h) => h.section === "6.1")!;
  assert.match(early.text, /14 calendar days/);
  assert.match(early.text, /80%/);
});

// --- further behaviour ---------------------------------------------------------------------------
test("late fee question finds Section 4.1", () => {
  assert.equal(sections("what is the late fee penalty")[0], "4.1");
});

test("payment confirmation question finds Section 7.3", () => {
  assert.ok(sections("do I need to confirm before the assistant pays my tuition").includes("7.3"));
});

test("scholarship question finds Section 5", () => {
  assert.match(sections("merit scholarship discount")[0], /^5\./);
});

test("results carry section, heading, text and a positive score, ordered by score", () => {
  const hits = index.search("installment", 5);
  for (const h of hits) {
    assert.ok(h.section && h.heading && h.text);
    assert.ok(h.score > 0);
  }
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].score >= hits[i].score);
});

test("respects max_results", () => {
  assert.ok(index.search("payment", 2).length <= 2);
});

test("unrelated or empty queries return no matches instead of noise", () => {
  assert.deepEqual(index.search("quantum chromodynamics gluon"), []);
  assert.deepEqual(index.search("the of and"), []);
  assert.deepEqual(index.search(""), []);
});

test("the index is built once: querying does not rebuild it", () => {
  const builtAt = index.builtAt.getTime();
  const count = index.chunkCount;
  for (let i = 0; i < 50; i++) index.search("refund");
  assert.equal(index.builtAt.getTime(), builtAt);
  assert.equal(index.chunkCount, count);
});

test("stemming maps inflected forms together", () => {
  assert.equal(stem("installments"), stem("installment"));
  assert.equal(stem("deadlines"), stem("deadline"));
  assert.equal(stem("approved"), stem("approve"));
  assert.equal(stem("withdrawal"), stem("withdraw"));
  assert.deepEqual(tokenize("The Refunds"), ["refund"]);
});
