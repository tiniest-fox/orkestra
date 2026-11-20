// domain: what a trak's name is made of. Pure — the draw itself is the adapter's.
//
// Beside `trak.ts` because it is a fact about `TrakId`: three words, hyphenated,
// so a person can say a trak out loud, type it into `ork resume` from memory and
// read `trak/witty-jade-otter` out of `git branch`. Every word is `^[a-z]+$`, so
// a name is a legal git ref, a legal directory name and URL-safe unescaped —
// which the whole id relies on, since it is used verbatim as all three.
//
// The words come from `unique-names-generator`'s three dictionaries and not from
// its generator function: the mint has to redraw until the name is free, so the
// draw has to be in our own hands.

import { adjectives, animals, colors } from "unique-names-generator"

/**
 * The longest word any dictionary may contribute, which is what bounds the name.
 *
 * Uncapped the worst case is `straightforward-aquamarine-tyrannosaurus` — longer
 * than the UUID this replaces, and the length is the whole point. At 9 the
 * longest possible name is 29 characters and 15.8 million names remain.
 */
const MAX_WORD = 9

/** The longest name these dictionaries can produce: three words and two hyphens. */
export const MAX_PHRASE = MAX_WORD * 3 + 2

/**
 * Adjectives nobody wants drawn for them — an insult, an alarm, or a hardship or
 * an identity used as a random label. The published list has enough of them that
 * a draw hits one regularly, and the name goes on a branch, in a URL somebody
 * pastes and in any screenshot of the tool.
 *
 * Whole words, matched exactly, so a variant is its own entry — `ugly` does not
 * cover `ugliest`. The tier-1 test asserts every entry here is really in the
 * published dictionary, which is what catches a typo silently excluding nothing.
 *
 * **Trivially emptied.** It is one array and no other decision rests on it.
 */
const EXCLUDED: ReadonlySet<string> = new Set([
  "appalling",
  "awful",
  "bad",
  "blind",
  "bloody",
  "condemned",
  "crazy",
  "creepy",
  "criminal",
  "cruel",
  "dangerous",
  "dead",
  "deaf",
  "defeated",
  "depressed",
  "desperate",
  "disabled",
  "disgusted",
  "disturbed",
  "disturbing",
  "dreadful",
  "drunk",
  "dying",
  "evil",
  "filthy",
  "foolish",
  "gay",
  "gross",
  "grotesque",
  "guilty",
  "handicapped",
  "homeless",
  "horrible",
  "hostile",
  "hurt",
  "ill",
  "illegal",
  "injured",
  "miserable",
  "naked",
  "nasty",
  "obnoxious",
  "pregnant",
  "racial",
  "repulsive",
  "rotten",
  "rude",
  "sick",
  "stupid",
  "terrible",
  "toxic",
  "tragic",
  "ugliest",
  "ugly",
  "unemployed",
  "unsightly",
  "useless",
  "vicious",
  "violent",
  "wicked",
  "wrong",
  "xenophobic",
  "yucky",
])

/**
 * The published list, minus the long words and the unpleasant ones.
 *
 * Non-empty as a *type* rather than as a check, because that is the only thing
 * that makes `wordAt` total: an index can be out of range, but a first word
 * always exists. Empty is unreachable — these are literal arrays in a pinned
 * dependency — and throwing at import is the loud way to find out otherwise,
 * where a fabricated fallback word would ship `witty--otter` as a branch name.
 */
const usable = (words: readonly string[]): readonly [string, ...string[]] => {
  const [first, ...rest] = words.filter((w) => w.length <= MAX_WORD && !EXCLUDED.has(w))
  if (first === undefined) throw new Error("a trak-name dictionary filtered down to nothing")
  return [first, ...rest]
}

export const ADJECTIVES = usable(adjectives)
export const COLOURS = usable(colors)
export const ANIMALS = usable(animals)

/**
 * `fraction` is a number in `[0, 1)` — `Math.random`'s range — and the word is
 * read off `rest` so that every out-of-range index lands on `first` rather than
 * on `undefined`. A generator that can hand back a hole would put an empty word
 * in a branch name, which git accepts as a different name than the one recorded.
 */
const wordAt = (words: readonly [string, ...string[]], fraction: number): string => {
  const [first, ...rest] = words
  return rest[Math.floor(fraction * words.length) - 1] ?? first
}

/**
 * One name: `adjective-colour-animal`.
 *
 * `next` is the randomness, taken as an argument so this file stays pure — the
 * `Ids` adapter is the boundary that owns `Math.random`, the same way it owns
 * `randomUUID`. It is called three times, left to right.
 */
export const phraseFrom = (next: () => number): string =>
  `${wordAt(ADJECTIVES, next())}-${wordAt(COLOURS, next())}-${wordAt(ANIMALS, next())}`
