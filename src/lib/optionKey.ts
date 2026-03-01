//! Sentinel-prefixed keys for multi-choice option selections.
//!
//! Option selections are stored as `"\0opt:<index>"` instead of the option
//! label text. This prevents collisions when the user types write-in text
//! that happens to match an option label (e.g. typing "Blue" as part of
//! "Blue, but light blue" would otherwise auto-select the Blue option).

const PREFIX = "\0opt:";

/** Returns the internal key for option at `index`. Never typeable by a user. */
export function optionKey(index: number): string {
  return PREFIX + index;
}

/** Returns true if `value` is an option key (not user-typed text). */
export function isOptionKey(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Extracts the option index from a key, or returns null if not a key. */
export function parseOptionIndex(value: string): number | null {
  if (!value.startsWith(PREFIX)) return null;
  const n = Number(value.slice(PREFIX.length));
  return Number.isFinite(n) ? n : null;
}
