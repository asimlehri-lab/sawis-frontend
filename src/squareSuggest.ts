// Suggests which SAWIS dishes a Square item name probably means, so the
// person can pick with one click instead of searching. Pure name similarity:
// it never matches anything by itself.

const STOP_WORDS = new Set(["the", "a", "an", "of", "with", "and", "w", "large", "small", "regular", "medium"]);

export function normaliseName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(norm: string): string[] {
  const all = norm.split(" ").filter(Boolean);
  const kept = all.filter((t) => !STOP_WORDS.has(t));
  return kept.length ? kept : all;
}

function levenshteinRatio(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

// 0 to 1: how alike two names are.
export function nameSimilarity(a: string, b: string): number {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(na);
  const tb = tokens(nb);
  const sa = new Set(ta);
  const shared = tb.filter((t) => sa.has(t)).length;
  const cosine = shared / Math.sqrt(ta.length * tb.length);
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  const contained = long.includes(short) ? 0.6 + 0.3 * (short.length / long.length) : 0;
  return Math.max(cosine, contained, levenshteinRatio(na, nb));
}

export interface DishSuggestion {
  id: string;
  name: string;
  score: number;
}

export function suggestDishes(
  squareName: string,
  dishes: { id: string; name: string }[],
  limit = 3,
  minScore = 0.5
): DishSuggestion[] {
  return dishes
    .map((d) => ({ id: d.id, name: d.name, score: nameSimilarity(squareName, d.name) }))
    .filter((s) => s.score >= minScore)
    .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name))
    .slice(0, limit);
}
