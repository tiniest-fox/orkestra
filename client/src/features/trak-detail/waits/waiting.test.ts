// Tier-1: the words the held card is built from, off the wire's `waiting` and the plan.

import { describe, expect, it } from "vitest"
import type { WaitingDto } from "../../../api/types"
import { makeAgentStep, makeComposeEntry, makePlan } from "../../../fixtures"
import {
  dueWords,
  heldInstruction,
  secondsUntil,
  spellLeft,
  waitFacts,
  waitPhrase,
  waitSlot,
  whenWords,
} from "./waiting"

/** The composer's entry first, then three of the agent's — so an index is not a step number. */
const plan = makePlan({
  steps: [
    makeComposeEntry(),
    makeAgentStep({ agent: "builder", instruction: "build the drawer" }),
    makeAgentStep({ agent: "asana", instruction: "move the task to Done" }),
    makeAgentStep({ agent: "notify", instruction: "tell the channel it shipped" }),
  ],
})

const held: WaitingDto = { step: 2, name: "pr-merged", stopped: false }

/** A local instant, built with the local constructor so the words hold in any zone. */
const local = (y: number, m: number, d: number, h: number, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime()

/** Sun 14 Sep 2026, 21:40 — the moment the design round was drawn at. */
const NOW = local(2026, 9, 14, 21, 40)
const TOMORROW_6 = local(2026, 9, 15, 6)

const onClock: WaitingDto = { step: 2, name: "wait_until", stopped: false, until: TOMORROW_6 }

describe("waitPhrase", () => {
  it("is built off met and asked, never off a check's words", () => {
    expect(waitPhrase(held)).toBe("is not met yet")
    expect(waitPhrase({ ...held, stopped: true })).toBe("gave up — will not be asked again")
    for (const phrase of [waitPhrase(held), waitPhrase({ ...held, stopped: true })])
      expect(phrase).not.toMatch(/pass|fail/)
  })

  /** Nothing is asked of a clock and nothing can give up on one: none of those words. */
  it("says when the step runs for a clock, and that the moment has passed once it has", () => {
    expect(waitPhrase(onClock)).toBe("is when the step runs")
    expect(waitPhrase(onClock, true)).toBe("has passed — the step runs on the next sweep")
    for (const phrase of [waitPhrase(onClock), waitPhrase(onClock, true)])
      expect(phrase).not.toMatch(/met|ask/)
  })
})

describe("waitSlot", () => {
  it("holds the script's name for a condition and the instant for a clock", () => {
    expect(waitSlot(held, NOW)).toBe("pr-merged")
    expect(waitSlot(onClock, NOW)).toBe("06:00 tomorrow")
  })
})

describe("whenWords", () => {
  it("says the hour alone today, tomorrow by name, and a weekday beyond that", () => {
    expect(whenWords(local(2026, 9, 14, 23, 10), NOW)).toBe("23:10")
    expect(whenWords(TOMORROW_6, NOW)).toBe("06:00 tomorrow")
    expect(whenWords(local(2026, 9, 16, 6), NOW)).toBe("Wed 06:00")
  })

  it("names a moment behind us the same way, so a daemon back after a day still reads", () => {
    expect(whenWords(local(2026, 9, 14, 21, 37), NOW)).toBe("21:37")
    expect(whenWords(local(2026, 9, 12, 6), NOW)).toBe("Sat 06:00")
  })
})

describe("dueWords", () => {
  it("counts down to the instant, and says due now once it is here", () => {
    expect(dueWords(30_000)).toBe("in 8h 20m")
    expect(dueWords(0)).toBe("due now")
  })
})

describe("waitFacts", () => {
  it("numbers the held step among the agent's entries, not by its index", () => {
    // Index 2 of the plan is the second step of three: the composer's entry is not one.
    expect(waitFacts(held, plan)).toEqual(["holds step 2 of 3", "asana", "1 behind it"])
  })

  it("says nothing is behind the last step", () => {
    expect(waitFacts({ ...held, step: 3 }, plan)).toEqual(["holds step 3 of 3", "notify"])
  })

  it("says what a stop costs, in place of what the wait holds", () => {
    expect(waitFacts({ ...held, stopped: true }, plan)).toEqual([
      "step 2 of 3 will not run",
      "asana",
      "1 behind it",
      "archiving drops them",
    ])
    expect(waitFacts({ ...held, step: 3, stopped: true }, plan)).toEqual([
      "step 3 of 3 will not run",
      "notify",
      "archiving drops it",
    ])
  })

  it("survives a plan the detail has not got", () => {
    // Between a restart and the first read, or a log the plan was re-cut out from under:
    // the card still draws, and says only what it can.
    expect(waitFacts(held, undefined)).toEqual(["holds the held step"])
    expect(heldInstruction(held, undefined)).toBeUndefined()
  })

  it("hands the held entry's own words to the card", () => {
    expect(heldInstruction(held, plan)).toBe("move the task to Done")
  })
})

describe("the countdown", () => {
  it("counts whole seconds to the next ask, and none past it", () => {
    expect(secondsUntil(10_000, 6_500)).toBe(4)
    expect(secondsUntil(10_000, 10_000)).toBe(0)
    // The sweep appends nothing for an ask still not met, so the number sits at the ask
    // until the poll brings the next one — never below it.
    expect(secondsUntil(10_000, 12_000)).toBe(0)
  })

  it("has nothing to count where the wire scheduled nothing", () => {
    expect(secondsUntil(undefined, 6_500)).toBeUndefined()
  })

  it("spells the coarsest form that is still exact", () => {
    expect(spellLeft(221)).toBe("3m 41s")
    expect(spellLeft(41)).toBe("41s")
    expect(spellLeft(3_720)).toBe("1h 02m")
    expect(spellLeft(65)).toBe("1m 05s")
    // *now* rather than a number frozen at zero, which is a state the engine never sits in.
    expect(spellLeft(0)).toBe("now")
  })
})
