// Ranks which of our own names (dishes, items) a name read from a till file,
// a scanned receipt or an invoice most likely means. Pure name similarity,
// plus drink sizes: "Star Lemon Tea0.7", "Star Lemon Tea 0,7" and
// "Star Lemon Tea (0.7L)" are the same drink, while "(0.5L)" is a different
// one. It only ranks and suggests; the person always confirms.
import { nameSimilarity } from "./squareSuggest";

// A size as the tills and our recipe names write it: "0.7L", "700 ml",
// "50cl", or a bare decimal such as "0,5" or "0.7" that follows the name
// directly ("Tea0.7"). Returns litres, or null when no size is printed.
function sizeOf(raw: string): { litres: number | null; rest: string } {
  const s = raw.toLowerCase().replace(/(\d)\s*,\s*(\d)/g, "$1.$2");
  const withUnit = /(\d+(?:\.\d+)?)\s*(ml|cl|l)(?![a-z])/.exec(s);
  if (withUnit) {
    const v = parseFloat(withUnit[1]);
    const litres = withUnit[2] === "ml" ? v / 1000 : withUnit[2] === "cl" ? v / 100 : v;
    return { litres, rest: s.replace(withUnit[0], " ") };
  }
  const bare = /(?<![\d.])(\d\.\d{1,2})(?![\d])/.exec(s);
  if (bare) return { litres: parseFloat(bare[1]), rest: s.replace(bare[0], " ") };
  return { litres: null, rest: s };
}

// Wording the till or our own menu adds that says nothing about the drink.
function cleanText(rest: string): string {
  return rest.replace(/\balt\.?\s*pos\s*button\b/g, " ").replace(/[()]/g, " ");
}

// 0 to 1. The name is compared without its size, then the sizes decide:
// a different size is a different drink and falls well below a confident
// match, a missing size on one side is a small step down.
export function dishScore(raw: string, ours: string): number {
  const a = sizeOf(raw);
  const b = sizeOf(ours);
  const base = nameSimilarity(cleanText(a.rest), cleanText(b.rest));
  if (a.litres !== null && b.litres !== null) {
    return Math.abs(a.litres - b.litres) > 0.01 ? base * 0.55 : base;
  }
  if (a.litres !== null || b.litres !== null) return base * 0.92;
  return base;
}

export interface NameGuess {
  id: string;
  name: string;
  score: number;
}

export function rankNames(raw: string, ours: { id: string; name: string }[], limit = 3, minScore = 0.5): NameGuess[] {
  return ours
    .map((o) => ({ id: o.id, name: o.name, score: dishScore(raw, o.name) }))
    .filter((g) => g.score >= minScore)
    .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name))
    .slice(0, limit);
}

// The one guess worth pre-selecting: clearly the same name, and clearly
// ahead of the next candidate. Anything less is only offered as a chip.
export const CONFIDENT = 0.8;
export function confidentGuess(raw: string, ours: { id: string; name: string }[]): NameGuess | null {
  const top = rankNames(raw, ours, 2, CONFIDENT);
  if (!top.length) return null;
  if (top.length > 1 && top[0].score - top[1].score < 0.04) return null;
  return top[0];
}
