import type { ParsedDocument, PolicyChunk } from "./chunker.js";

/**
 * In-memory inverted index with BM25 ranking.
 *
 * - Built ONCE when the server starts; queries only read it (no re-indexing per question).
 * - Heading and parent-heading terms are boosted so "refund" finds the refund sections first.
 * - Light stemming + a few domain synonyms improve recall without any external service.
 */
const STOPWORDS = new Set(
  "a an and are as at be by can could do does for from has have how i if in is it its me my of on or our should so that the their them then there these they this to was we what when where which who why will with would you your".split(
    " "
  )
);

// Words that appear in almost every policy question ("what are the rules/policy for ...") carry little meaning,
// so in a query they count far less than topical words such as "installment" or "refund".
const GENERIC_QUERY_WORDS = new Set(["rule", "rules", "policy", "policies", "information", "info", "details", "tell", "explain", "regarding", "about"]);
const GENERIC_WEIGHT = 0.2;

// Query-time expansion only (expanded terms get a lower weight than the user's own words).
const SYNONYMS: Record<string, string[]> = {
  deadline: ["due"],
  due: ["deadline"],
  refund: ["withdraw"],
  withdraw: ["refund"],
  withdrawal: ["refund"],
  cancel: ["withdraw"],
  penalty: ["late", "fee"],
  overdue: ["late"],
  late: ["overdue"],
  cost: ["tuition"],
  discount: ["scholarship"],
  confirm: ["confirmation"],
  duplicate: ["idempotency"],
  retry: ["duplicate", "idempotency"],
};

export function stem(word: string): string {
  let w = word;
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) w = w.slice(0, -3) + "y";
  else if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 7 && w.endsWith("ment")) w = w.slice(0, -4);
  else if (w.length > 6 && w.endsWith("al")) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:[.'][a-z0-9]+)*/g) ?? [])
    .map((t) => t.replace(/'s$/, "").replace(/'/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

export interface SearchHit {
  section: string;
  heading: string;
  text: string;
  score: number;
}

interface IndexedChunk {
  chunk: PolicyChunk;
  tf: Map<string, number>;
  length: number;
}

const HEADING_BOOST = 3;
const PARENT_BOOST = 1.5;
const K1 = 1.2;
const B = 0.75;

export class SearchIndex {
  readonly documentId: string;
  readonly fileName: string;
  readonly chunkCount: number;
  readonly builtAt: Date;
  private docs: IndexedChunk[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  constructor(doc: ParsedDocument) {
    this.documentId = doc.documentId;
    this.fileName = doc.fileName;
    for (const chunk of doc.chunks) {
      const tf = new Map<string, number>();
      let length = 0;
      const add = (text: string, weight: number) => {
        for (const t of tokenize(text)) {
          tf.set(t, (tf.get(t) ?? 0) + weight);
          length += weight;
        }
      };
      add(chunk.text, 1);
      add(chunk.heading, HEADING_BOOST);
      add(chunk.parentHeading, PARENT_BOOST);
      this.docs.push({ chunk, tf, length });
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avgLen = this.docs.reduce((s, d) => s + d.length, 0) / Math.max(1, this.docs.length);
    this.chunkCount = this.docs.length;
    this.builtAt = new Date();
  }

  private queryTerms(query: string): Map<string, number> {
    const terms = new Map<string, number>();
    const original = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !STOPWORDS.has(t));
    for (const raw of original) {
      terms.set(stem(raw), GENERIC_QUERY_WORDS.has(raw) ? GENERIC_WEIGHT : 1);
    }
    for (const raw of original) {
      for (const syn of SYNONYMS[raw] ?? []) {
        const s = stem(syn);
        if (!terms.has(s)) terms.set(s, 0.4);
      }
    }
    return terms;
  }

  search(query: string, maxResults = 3): SearchHit[] {
    const terms = this.queryTerms(query);
    if (terms.size === 0) return [];
    const n = this.docs.length;
    const scored: SearchHit[] = [];
    for (const d of this.docs) {
      let score = 0;
      for (const [term, weight] of terms) {
        const f = d.tf.get(term);
        if (!f) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += weight * idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / this.avgLen)));
      }
      if (score > 0) {
        scored.push({ section: d.chunk.section, heading: d.chunk.heading, text: d.chunk.text, score });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.section.localeCompare(b.section, undefined, { numeric: true }));
    if (scored.length === 0) return [];
    // Drop weak tail matches: keep results scoring at least 35% of the best one.
    const floor = scored[0].score * 0.35;
    return scored
      .filter((h) => h.score >= floor)
      .slice(0, maxResults)
      .map((h) => ({ ...h, score: Math.round(h.score * 1000) / 1000 }));
  }
}
