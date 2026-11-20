/**
 * The opening sentence of an agent's `description:` — what a tile on New Trak shows.
 *
 * **Not the whole string, and the reason is where these descriptions put their weight.**
 * They are written for the composer's index, where the last clause is usually the one
 * that tells two neighbouring agents apart — `investigate` from `diagnose`, say. A tile
 * that clamped the whole description would cut exactly that clause and leave two tiles
 * reading almost identically. Taking the first sentence instead cuts at a boundary the
 * author wrote, so what is shown is a whole thought rather than a truncated one.
 *
 * **A period only ends a sentence when whitespace or the end follows it.** `ui-prototype`
 * says its study lands under `` `.atelier/` ``, and a naive split on `"."` would hand the
 * tile the word *Settles* and stop. This is the whole of the parsing, deliberately: a
 * fuller sentence splitter would be inventing rules for prose nobody has written yet.
 */

const END = /[.!?](?=\s|$)/

export const firstSentence = (text: string): string => {
  const trimmed = text.trim()
  const end = trimmed.search(END)
  return end === -1 ? trimmed : trimmed.slice(0, end + 1)
}
