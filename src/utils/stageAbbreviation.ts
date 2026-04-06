// Stage name abbreviation — always preserve first letter, then drop vowels for compact chain glyphs.

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/**
 * Abbreviate a stage name to 3 characters. Always preserves the first letter (even if a vowel),
 * then fills remaining slots with consonants from the rest of the name. Prefers consonants not
 * already in the abbreviation; falls back to duplicates only when no alternatives remain.
 * Falls back to the first 3 characters of the original name if the result is too short.
 *
 * Examples: plan→pln, work→wrk, review→rvw, check→chk, compound→cmp, breakdown→brk,
 *           ideate→idt, outline→otl, enhance→enh
 */
export function abbreviateStage(name: string): string {
  const lower = name.toLowerCase();
  if (lower.length === 0) return lower;
  const first = lower[0];
  const rest = lower
    .slice(1)
    .split("")
    .filter((c) => c >= "a" && c <= "z" && !VOWELS.has(c));

  // Two-pass dedup: prefer consonants not already in the abbreviation,
  // fall back to duplicates if no alternatives remain.
  const used = new Set([first]);
  const preferred: string[] = [];
  const fallback: string[] = [];
  for (const c of rest) {
    if (!used.has(c)) {
      preferred.push(c);
      used.add(c);
    } else {
      fallback.push(c);
    }
  }
  const extra = [...preferred, ...fallback].slice(0, 2);
  const abbrev = first + extra.join("");
  return abbrev.length >= 2 ? abbrev : lower.slice(0, 3);
}
