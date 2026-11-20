// Tier-1: what the words a trak is named from have to be true of.
//
// Most of these fail when the *dependency* changes its lists rather than when
// this file does, which is the point: the name is used verbatim as a git branch,
// a directory and a URL segment, so a word that stops being `^[a-z]+$` is a trak
// that cannot be created at all.

import { describe, expect, it } from "vitest"
import { adjectives, animals, colors } from "unique-names-generator"
import { ADJECTIVES, ANIMALS, COLOURS, MAX_PHRASE, phraseFrom } from "./phrase.js"

/** Every word the mint can draw, whichever dictionary it came from. */
const everyWord: readonly string[] = [...ADJECTIVES, ...COLOURS, ...ANIMALS]

/** The top of `Math.random`'s range, which lands on the last word of a list. */
const TOP = 1 - Number.EPSILON

/** A scripted draw: the fractions in order, then zero once they run out. */
const scripted = (fractions: readonly number[]): (() => number) => {
  let at = 0
  return () => {
    const fraction = fractions[at] ?? 0
    at += 1
    return fraction
  }
}

describe("the dictionaries", () => {
  it("hold only words git will accept in a ref", () => {
    // A leading `-`, an embedded `..` or a `@{` is rejected by `git worktree add`,
    // and a capital would make `trak/Witty-jade-otter` a second name for the same
    // trak on a case-insensitive filesystem. Lowercase letters and nothing else
    // is also what makes the name URL-safe with no escaping.
    expect(everyWord.filter((w) => !/^[a-z]+$/.test(w))).toEqual([])
  })

  it("cannot produce a name longer than the cap", () => {
    expect(MAX_PHRASE).toBe(29)
    expect(Math.max(...everyWord.map((w) => w.length))).toBe(9)
  })

  it("leave enough names that a redraw is never the common case", () => {
    // The mint redraws until the name is free, so the size of the space is what
    // keeps that a formality rather than a loop somebody watches.
    expect(ADJECTIVES.length * COLOURS.length * ANIMALS.length).toBeGreaterThan(1_000_000)
  })

  it("drop every excluded word, and every excluded word was really there", () => {
    // The second half is what catches a typo in the exclusion list: `stoopid`
    // excludes nothing, and the filter has no way to say so.
    const published: readonly string[] = [...adjectives, ...colors, ...animals]
    const unwelcome = ["stupid", "evil", "dead", "ugly", "useless", "toxic", "disturbing"]
    // The second group: a hardship or an identity used as a random label.
    const unfair = ["homeless", "disabled", "unemployed", "gay", "racial", "xenophobic"]
    for (const unwanted of [...unwelcome, ...unfair]) {
      expect(published).toContain(unwanted)
      expect(everyWord).not.toContain(unwanted)
    }
    // And that the filter is a filter rather than a wipe: an ordinary word stays.
    expect(everyWord).toContain("witty")
  })
})

describe("phraseFrom", () => {
  it("is adjective-colour-animal, drawn in that order", () => {
    // The middle draw lands in the colours, which is what says the order is not
    // an accident of three identical calls.
    expect(phraseFrom(scripted([0, TOP, 0]))).toBe(
      `${ADJECTIVES[0]}-${COLOURS.at(-1)}-${ANIMALS[0]}`,
    )
  })

  it("never produces an empty word, whatever it is handed", () => {
    // A hole in the middle would be `witty--otter`: a legal branch name, and not
    // the one anything recorded. Out of range in either direction has to land on
    // a real word rather than on nothing.
    for (const fraction of [0, TOP, 1, 2, -1]) {
      expect(phraseFrom(() => fraction)).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/)
    }
  })

  it("never exceeds the cap over a real draw", () => {
    const names = Array.from({ length: 500 }, () => phraseFrom(Math.random))
    expect(Math.max(...names.map((n) => n.length))).toBeLessThanOrEqual(MAX_PHRASE)
    expect(names.filter((n) => !/^[a-z]+-[a-z]+-[a-z]+$/.test(n))).toEqual([])
  })
})
