// Tier-1: the invariants `Record<Tone, string>` cannot express.
//
// The type already guarantees every `Tone` has an entry. What it cannot see is
// `TONES` drifting from the map, a class name that Tailwind will never emit, or a
// typo'd token — and a typo here fails silently, rendering an element with no colour
// rather than throwing.

import { describe, expect, it } from "vitest"
// Vite's `?raw` gives the stylesheet as text, which is the only way a tier-1 test can
// see it: nothing here builds CSS, and asserting on a compiled utility would be a
// tier-3 job against a real browser.
import styles from "../styles.css?raw"
import { TONES, toneClass, toneTrack, type Tone } from "./tone"

// At module scope, not inside the `it`, so it is compiled once. A sixth member of the
// union breaks this switch — the compiler-side half of the guard the assertions below
// cover at runtime.
const describeTone = (tone: Tone): string => {
  switch (tone) {
    case "neutral":
      return "nothing owed"
    case "working":
      return "in flight"
    case "waiting":
      return "a human owes an action"
    case "good":
      return "succeeded"
    case "bad":
      return "failed"
  }
}

describe("toneClass", () => {
  it("has an entry for every tone in TONES, and no extras", () => {
    // `TONES` is a plain array, so a member missing from it is NOT a type error even
    // though a member missing from `toneClass` is. This is the drift that guards it.
    expect([...TONES].sort()).toEqual(Object.keys(toneClass).sort())
  })

  it("maps each tone to a foreground and a tinted fill named after that tone", () => {
    // Catches the copy-paste failure the compiler is blind to: `good: "text-tone-god
    // bg-tone-bad-bg"` typechecks perfectly and renders wrong (or not at all).
    for (const tone of TONES) {
      expect(toneClass[tone]).toBe(`text-tone-${tone} bg-tone-${tone}-bg`)
    }
  })

  it("uses whole literal class names", () => {
    // Tailwind v4 finds classes by scanning source text, so an interpolated class
    // never enters the stylesheet at all. Nothing in the map may look constructed,
    // and none of it may be blank.
    for (const value of Object.values(toneClass)) {
      expect(value).not.toContain("${")
      expect(value.trim()).not.toBe("")
    }
  })

  it("is exhaustive over the union, with every tone reachable from TONES", () => {
    // `client-style` says a sixth tone means an event kind was not thought about. The
    // switch above is what enforces that; this asserts TONES actually reaches all of
    // it, so no member is described but unreachable.
    expect(TONES.map(describeTone)).toEqual([
      "nothing owed",
      "in flight",
      "a human owes an action",
      "succeeded",
      "failed",
    ])
  })
})

// ============================================================================
// The map against the stylesheet — the half neither the type nor the shape sees
// ============================================================================

/**
 * A class naming a token `styles.css` does not define emits no CSS and no error: the
 * element renders uncoloured. `App.tsx`'s swatch view made that visible while the map
 * had one consumer; `stepTone` is the second, and a visible-on-the-page guard stops
 * being one the moment the page it is visible on is not the page anyone opens.
 *
 * Tailwind v4's rule is that `text-<name>` and `bg-<name>` read `--color-<name>`, so
 * the token a class needs is derivable from the class itself. Deriving it is the point
 * — a hard-coded list of tokens here would agree with itself and not with the map.
 */
const tokensOf = (classes: string): readonly string[] =>
  classes.split(" ").map((name) => `--color-${name.replace(/^(?:text|bg)-/, "")}`)

/**
 * The dark block is a `prefers-color-scheme` media query and the light one is the
 * `@theme` above it, so splitting the file at the query gives both. A token defined in
 * only one of them is the failure worth catching: it renders correctly for whoever
 * wrote it and wrong for everyone on the other setting.
 */
const DARK = "@media (prefers-color-scheme: dark)"
const light = styles.slice(0, styles.indexOf(DARK))
const dark = styles.slice(styles.indexOf(DARK))

describe("toneClass against styles.css", () => {
  it("splits the stylesheet into a light half and a dark half", () => {
    // If the dark block is ever renamed or removed, the two assertions below would
    // both run against the whole file and pass on nothing.
    expect(styles).toContain(DARK)
    expect(light).toContain("@theme")
    expect(dark.length).toBeGreaterThan(0)
  })

  it("defines every token the map names, in both halves", () => {
    for (const tone of TONES) {
      for (const token of tokensOf(toneClass[tone])) {
        // With the colon: `--color-tone-neutral` is a prefix of
        // `--color-tone-neutral-bg`, so a bare substring check would pass on the
        // wrong one.
        expect(light).toContain(`${token}:`)
        expect(dark).toContain(`${token}:`)
      }
    }
  })

  it("defines every track token too, in both halves", () => {
    // The track is the hairline the running segment travels on, and it is the token most
    // likely to be added to one half and forgotten in the other: it is only ever visible
    // while a turn is in flight, so a missing dark value renders correctly for anyone not
    // looking at a working row — which is how the gap it replaced went three rounds
    // unnoticed.
    for (const tone of TONES) {
      expect(toneTrack[tone]).toBe(`bg-tone-${tone}-track`)
      expect(light).toContain(`--color-tone-${tone}-track:`)
      expect(dark).toContain(`--color-tone-${tone}-track:`)
    }
  })

  it("keeps the track map in step with TONES, and literal", () => {
    expect([...TONES].sort()).toEqual(Object.keys(toneTrack).sort())
    for (const value of Object.values(toneTrack)) expect(value).not.toContain("${")
  })

  it("derives two tokens per tone — a foreground and a fill", () => {
    // Pins the derivation itself. A `toneClass` entry that collapsed to one utility
    // would still pass the loop above while rendering an untinted row.
    expect(tokensOf(toneClass.good)).toEqual(["--color-tone-good", "--color-tone-good-bg"])
  })
})
