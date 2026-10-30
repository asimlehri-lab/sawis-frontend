import { HELP_TOPICS } from "./helpContent";
import type { HelpQuestion, HelpTopic } from "./helpContent";

// Ranks every question in Help against what the person typed, so a sentence
// like "how do I enter waste %" lands on the one best answer instead of a
// topic to dig through. Plain word matching: rarer words count for more,
// words in the question count for more than words in the answer.

export interface HelpHit {
  key: string;
  topic: HelpTopic;
  item: HelpQuestion;
  score: number;
}

const STOP = new Set(
  (
    "how do i a an the to my me can what is are it of in for on and does did when where why which with from at by or be " +
    "this that there any should would about get you your we our please need want find show tell"
  ).split(" "),
);

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/%/g, " percent ")
    .replace(/\bpct\b/g, " percent ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stem(w: string): string {
  let s = w;
  if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  for (const suffix of ["ing", "ed"]) {
    if (s.length > suffix.length + 2 && s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length);
      if (s.length > 2 && s[s.length - 1] === s[s.length - 2]) s = s.slice(0, -1);
      break;
    }
  }
  return s;
}

function tokens(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

// Exact word, or one word starting with the other (both 4+ letters), so
// "wasted" finds "waste" and "supplier" finds "suppliers".
function has(set: Set<string>, t: string): boolean {
  if (set.has(t)) return true;
  if (t.length < 4) return false;
  for (const w of set) if (w.length >= 4 && (w.startsWith(t) || t.startsWith(w))) return true;
  return false;
}

interface Row {
  key: string;
  topic: HelpTopic;
  item: HelpQuestion;
  q: Set<string>;
  a: Set<string>;
  t: Set<string>;
}

let rows: Row[] | null = null;
let idf: Map<string, number> | null = null;

function build() {
  rows = [];
  const df = new Map<string, number>();
  for (const topic of HELP_TOPICS) {
    const t = new Set(tokens(topic.title + " " + topic.keywords.join(" ")));
    for (const item of topic.questions) {
      const row: Row = {
        key: topic.id + "::" + item.q,
        topic,
        item,
        q: new Set(tokens(item.q)),
        a: new Set(tokens(item.a + " " + (item.fact ?? ""))),
        t,
      };
      rows.push(row);
      for (const w of new Set([...row.q, ...row.a, ...row.t])) df.set(w, (df.get(w) ?? 0) + 1);
    }
  }
  idf = new Map();
  for (const [w, n] of df) idf.set(w, Math.log(1 + rows.length / n));
}

export function searchHelp(query: string, limit = 5): HelpHit[] {
  const qt = [...new Set(tokens(query))];
  if (qt.length === 0) return [];
  if (!rows || !idf) build();
  const need = Math.max(1, Math.ceil(qt.length / 2));
  const hits: HelpHit[] = [];
  for (const row of rows!) {
    let score = 0;
    let matched = 0;
    for (const w of qt) {
      const weight = idf!.get(w) ?? Math.log(1 + rows!.length);
      let s = 0;
      if (has(row.q, w)) s += 3;
      if (has(row.t, w)) s += 1.5;
      if (has(row.a, w)) s += 1;
      if (s > 0) matched += 1;
      score += s * weight;
    }
    if (matched >= need) hits.push({ key: row.key, topic: row.topic, item: row.item, score });
  }
  hits.sort((x, y) => y.score - x.score);
  const top = hits[0]?.score ?? 0;
  return hits.filter((h) => h.score >= top * 0.4).slice(0, limit);
}
