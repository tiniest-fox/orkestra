/**
 * Tier 1 (`testing-tiers`): pure, beside the code — where a plan's rules go.
 *
 * The failure worth pinning is a rule in the wrong place: one under every step that
 * re-declares a met condition, or none above the entry after a spawn whose pieces wait.
 * Either tells a person approving the plan that it pauses where it does not.
 */

import { describe, expect, it } from "vitest"
import type { ChildDto, ComposerOutputDto } from "../../../api/types"
import { makeAgent } from "../../../fixtures"
import { columnWaits, planWaits, tileWaits, waitingCount } from "./waits"

type Entry = Extract<ComposerOutputDto, { type: "proposal" }>["steps"][number]

const AGENTS = [
  makeAgent({ name: "build" }),
  makeAgent({ name: "review" }),
  makeAgent({ name: "verify", conditions: ["deployed"] }),
  makeAgent({ name: "announce", conditions: ["deployed"] }),
  makeAgent({ name: "smoke", conditions: ["merged", "staging-ready"] }),
  makeAgent({ name: "check-preview", conditions: ["preview-up"] }),
]

const agent = (name: string): Entry => ({
  type: "agent",
  agent: name,
  instruction: `run ${name}`,
  conversational: false,
})

const child = (name: string): ChildDto => ({ agent: name, instruction: `run ${name}` })

const spawn = (...columns: readonly (readonly ChildDto[])[]): Entry => ({
  type: "spawn",
  instruction: "at once",
  children: columns,
})

describe("planWaits", () => {
  it("draws a condition once, above the first step that waits on it", () => {
    const plan = [agent("build"), agent("review"), agent("verify"), agent("announce")]

    // `announce` re-declares `deployed`, which the plan is already past: no second rule.
    expect(planWaits(AGENTS, plan)).toStrictEqual([[], [], ["deployed"], []])
  })

  it("draws a different condition as a rule of its own, and one step's two names on one", () => {
    const plan = [agent("build"), agent("smoke"), agent("verify"), agent("build")]

    expect(planWaits(AGENTS, plan)).toStrictEqual([
      [],
      ["merged", "staging-ready"],
      ["deployed"],
      [],
    ])
  })

  it("puts a piece's condition on the entry after the spawn, never on the spawn", () => {
    const plan = [
      agent("build"),
      spawn([child("review"), child("check-preview")], [child("check-preview")]),
      agent("review"),
      agent("check-preview"),
    ]

    // Step 3 waits for the pieces, and each piece waited on `preview-up`; step 4
    // re-declares it and draws nothing.
    expect(planWaits(AGENTS, plan)).toStrictEqual([[], [], ["preview-up"], []])
  })

  it("names an agent the library does not hold as waiting on nothing", () => {
    expect(planWaits([], [agent("verify")])).toStrictEqual([[]])
  })

  it("gives the composer's own re-run no rule", () => {
    const plan: readonly Entry[] = [agent("verify"), { type: "compose", instruction: "again" }]

    expect(planWaits(AGENTS, plan)).toStrictEqual([["deployed"], []])
  })
})

describe("columnWaits", () => {
  it("starts each column from nothing, so a piece's first wait draws in its own column", () => {
    expect(columnWaits(AGENTS, [child("review"), child("check-preview")])).toStrictEqual([
      [],
      ["preview-up"],
    ])
    expect(columnWaits(AGENTS, [child("check-preview"), child("check-preview")])).toStrictEqual([
      ["preview-up"],
      [],
    ])
  })
})

/** An agent step carrying its own `waitFor`. */
const waiting = (name: string, waitFor: "merged" | "deployed"): Entry => ({
  type: "agent",
  agent: name,
  instruction: `run ${name}`,
  conversational: false,
  waitFor,
})

describe("a step's own `waitFor`", () => {
  it("draws its name on the step every time, ahead of its agent's first-time names", () => {
    const plan = [
      agent("build"),
      waiting("review", "merged"),
      agent("smoke"),
      waiting("build", "merged"),
    ]

    // `smoke`'s agent adds only the name nothing above it waited on; the last step's own
    // `merged` is drawn again, because it is that step's to remove.
    expect(planWaits(AGENTS, plan)).toStrictEqual([[], ["merged"], ["staging-ready"], ["merged"]])
    expect(planWaits(AGENTS, [waiting("verify", "merged")])).toStrictEqual([["merged", "deployed"]])
  })

  it("counts the step, once, whether or not its agent also waits", () => {
    expect(waitingCount(AGENTS, [agent("build"), waiting("review", "merged")])).toBe(1)
    expect(waitingCount(AGENTS, [waiting("verify", "deployed")])).toBe(1)
  })
})

describe("waitingCount", () => {
  it("counts every step whose agent declares a condition, re-declared or not, pieces included", () => {
    const plan = [
      agent("build"),
      spawn([child("review"), child("check-preview")], [child("check-preview")]),
      agent("verify"),
      agent("announce"),
    ]

    // Two pieces wait, then `verify` and `announce`: four, though the plan pauses twice.
    expect(waitingCount(AGENTS, plan)).toBe(4)
  })

  it("counts a step with a clock of its own, once, whether or not its agent also waits", () => {
    const plan = [
      agent("build"),
      { ...agent("review"), waitUntil: 1_800_000_000_000 },
      { ...agent("verify"), waitUntil: 1_800_000_000_000 },
    ]

    expect(waitingCount(AGENTS, plan)).toBe(2)
  })
})

describe("tileWaits", () => {
  it("leads with the step's own name, live, until it is cleared", () => {
    expect(tileWaits(["staging-ready"], "merged", [], false)).toStrictEqual({
      names: ["merged", "staging-ready"],
      struck: [],
    })
  })

  it("strikes a cleared name the agent does not declare, and keeps one it does live", () => {
    expect(tileWaits([], "merged", [], true)).toStrictEqual({ names: [], struck: ["merged"] })
    // An earlier step drew `merged`, so `fresh` lacks it, and the agent still waits on it.
    expect(tileWaits([], "merged", ["merged"], true)).toStrictEqual({
      names: ["merged"],
      struck: [],
    })
  })
})
