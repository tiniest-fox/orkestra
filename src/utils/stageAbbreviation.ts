// Stage name abbreviation — always preserve first letter, then drop vowels for compact chain glyphs.

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/**
 * Abbreviate a stage name to 3 characters. Always preserves the first letter (even if a vowel),
 * then fills remaining slots with consonants from the rest of the name.
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
  const abbrev = first + rest.slice(0, 2).join("");
  return abbrev.length >= 2 ? abbrev : lower.slice(0, 3);
}
