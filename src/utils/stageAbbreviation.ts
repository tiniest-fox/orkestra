//! Stage name abbreviation — vowel-drop algorithm for compact chain glyphs.

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/**
 * Abbreviate a stage name by dropping vowels and taking the first 3 consonants.
 * Falls back to the first 3 characters of the original name if the result is too short.
 *
 * Examples: plan→pln, work→wrk, review→rvw, check→chk, compound→cmp, breakdown→brk
 */
export function abbreviateStage(name: string): string {
  const lower = name.toLowerCase();
  const consonants = lower.split('').filter(c => c >= 'a' && c <= 'z' && !VOWELS.has(c));
  const abbrev = consonants.slice(0, 3).join('');
  return abbrev.length >= 2 ? abbrev : lower.slice(0, 3);
}
