// Every reason a gate stops, one row each — and the row is the point.
//
// The rule this file tests used to be nine predicates threaded through `decide.ts`, and
// what it cost was that nobody could answer *what does `smart` skip* without replaying
// a trak. Here a reason is a row: add one to `STOPS` and this table is where it is
// written down, against a trak that would otherwise have gone past.
//
// Flows are `test/e2e/run-mode.test.ts`. This is the rule.

import { describe, expect, it } from "vitest"
import {
  approvedInAdvance,
  AUTO_MERGE_SENDS,
  autoMerging,
  endsUnattended,
  planWarrant,
  runsUnattended,
  sendsSpent,
  unanswered,
  warrantFor,
} from "./attention.js"
import type { Ambiguity } from "./outputs/ambiguity.js"
import type { Plan, ReconsultWhy, Step } from "./outputs/proposal.js"
import { emptyTrak, GoalId, type RunMode, type Slot, type Trak, TrakId } from "./trak.js"
import { SessionId } from "../../agent/types/session.js"

const id = TrakId.make("attention")

/** A step of the plan, named for its position so a key reads like the engine's. */
const step = (agent: string, fields: Record<string, unknown> = {}): Step => ({
  agent,
  instruction: `do the ${agent}`,
  ...fields,
})

/** A compose entry, with the reason something asked for it where there was one. */
const compose = (why?: ReconsultWhy): Step =>
  why === undefined
    ? { type: "compose" }
    : {
        type: "compose",
        why,
      }

/** A complaint against `at`, as the ask the engine writes into the plan. */
const raised = (from: number, at: string, text: string): ReconsultWhy => ({
  _tag: "Raised",
  step: from,
  requirements: [],
  corrections: [{ at, text }],
})

const plan = (...steps: readonly [Step, ...Step[]]): Plan => ({ title: "the work", steps })

/** One position's record, over the untouched slot every other position has. */
const spent = (over: Partial<Slot>): Slot => ({
  session: undefined,
  iterations: 1,
  filings: 1,
  skipped: false,
  skipNote: undefined,
  children: [],
  ambiguity: "none",
  checkFailures: undefined,
  filed: undefined,
  permission: undefined,
  waiting: undefined,
  skippedWait: undefined,
  handOffs: [],
  handedOff: undefined,
  goal: undefined,
  goalOpened: undefined,
  ...over,
})

const trak = (mode: RunMode, p: Plan, slots: Readonly<Record<number, Slot>>): Trak => ({
  ...emptyTrak(id),
  mode,
  plan: p,
  slots: new Map(Object.entries(slots).map(([at, slot]) => [Number(at), slot])),
})

/**
 * The shape every row below starts from: a plan gone through once, with the step at 1
 * having filed on its first turn and reported nothing.
 */
const ORDINARY = plan(compose(), step("build"), step("review"))
const uneventful = (mode: RunMode = "smart"): Trak =>
  trak(mode, ORDINARY, { 0: spent({}), 1: spent({}) })

describe("the modes, which this module answers for all four", () => {
  it("stands at every gate on manual, whatever anybody reported", () => {
    expect(runsUnattended(uneventful("manual"), 1)).toBe(false)
  })

  it("stands at none on auto, including entries nothing has run", () => {
    const t = uneventful("auto")
    expect(runsUnattended(t, 1)).toBe(true)
    expect(runsUnattended(t, 2)).toBe(true)
  })

  it("takes an uneventful gate on smart", () => {
    expect(runsUnattended(uneventful(), 1)).toBe(true)
  })
})

describe("a child's ending, which is a press and not a gate", () => {
  const piece = (mode: RunMode): Trak => ({
    ...uneventful(mode),
    parent: { id: TrakId.make("parent"), step: 1, child: 0, depth: 1 },
  })

  it("is taken on auto whatever the branch holds", () => {
    expect(endsUnattended(piece("auto"), true)).toBe(true)
    expect(endsUnattended(piece("auto"), false)).toBe(true)
  })

  it("is taken on smart only where nothing was committed", () => {
    expect(endsUnattended(piece("smart"), false)).toBe(true)
    expect(endsUnattended(piece("smart"), true)).toBe(false)
  })

  it("is never taken on manual, nor for a trak at the top on any mode", () => {
    // The top's destination is the checkout a person is standing in.
    expect(endsUnattended(piece("manual"), false)).toBe(false)
    expect(endsUnattended(uneventful("auto"), false)).toBe(false)
    expect(endsUnattended(uneventful("smart"), false)).toBe(false)
  })
})

describe("a goal's trak's ending", () => {
  const goals = (mode: RunMode): Trak => ({ ...uneventful(mode), goal: GoalId.make("g") })

  it("is taken on every mode where nothing was committed", () => {
    expect(endsUnattended(goals("manual"), false)).toBe(true)
    expect(endsUnattended(goals("smart"), false)).toBe(true)
    expect(endsUnattended(goals("auto"), false)).toBe(true)
  })

  it("is never taken where something was committed — its pull request decides", () => {
    expect(endsUnattended(goals("auto"), true)).toBe(false)
    expect(endsUnattended(goals("manual"), true)).toBe(false)
  })

  it("is held by a pending hold", () => {
    expect(endsUnattended({ ...goals("auto"), holding: true }, false)).toBe(false)
  })
})

describe("a conflict the engine sent the trak back for", () => {
  const resolving = (mode: RunMode): Trak => ({ ...uneventful(mode), resolving: true })

  it("takes every gate on every mode, and says why", () => {
    for (const mode of ["manual", "smart", "auto", "decider"] as const) {
      expect(approvedInAdvance(resolving(mode))).toBe(true)
      expect(warrantFor(resolving(mode), 1)?._tag).toBe("Resolving")
    }
  })

  it("is still held by a pending hold", () => {
    expect(approvedInAdvance({ ...resolving("smart"), holding: true })).toBe(false)
  })
})

describe("how often the engine sends an auto-merging trak back", () => {
  const merging = (sentBack: number): Trak => ({
    ...uneventful("manual"),
    autoMerge: { sentBack, stopped: undefined },
  })

  it("spends its sends at the limit, and stops merging once it has stopped", () => {
    expect(sendsSpent(merging(AUTO_MERGE_SENDS - 1))).toBe(false)
    expect(sendsSpent(merging(AUTO_MERGE_SENDS))).toBe(true)
    expect(autoMerging(merging(AUTO_MERGE_SENDS))).toBe(true)
    const stopped = {
      ...merging(AUTO_MERGE_SENDS),
      autoMerge: { sentBack: 3, stopped: { _tag: "Conflict" as const } },
    }
    expect(autoMerging(stopped)).toBe(false)
    expect(autoMerging(uneventful("auto"))).toBe(false)
  })
})

describe("an entry planned as a conversation, which a person asked for", () => {
  const conversation = (mode: RunMode): Trak =>
    trak(mode, plan(compose(), step("generic", { conversational: true })), {
      0: spent({}),
      1: spent({}),
    })

  it("stops at the artifact it files on every mode", () => {
    for (const mode of ["manual", "smart", "auto", "decider"] as const) {
      expect(warrantFor(conversation(mode), 1)).toBeUndefined()
    }
  })

  it("leaves the plan before it to the mode", () => {
    expect(warrantFor(conversation("auto"), 0)).toEqual({ _tag: "Mode" })
    expect(warrantFor(conversation("decider"), 0)).toEqual({ _tag: "Mode" })
  })
})

describe("a hold, which holds the current step at every gate whatever the mode says", () => {
  const held = (mode: RunMode): Trak => ({ ...uneventful(mode), holding: true })

  it("stops an auto trak at a gate it would have taken", () => {
    expect(runsUnattended(held("auto"), 1)).toBe(false)
    expect(planWarrant(held("auto"))).toBeUndefined()
  })

  it("stops a smart trak at an uneventful gate", () => {
    expect(runsUnattended(held("smart"), 1)).toBe(false)
  })

  it("answers no to every question auto answers yes to, not only the artifact's", () => {
    // A hold that let the questions be answered unattended and stood only at the
    // artifact would be a hold on one kind of gate.
    expect(approvedInAdvance(held("auto"))).toBe(false)
    expect(unanswered(held("auto"), 1)).toBe(false)
    const piece: Trak = {
      ...held("auto"),
      parent: { id: TrakId.make("parent"), step: 1, child: 0, depth: 1 },
    }
    expect(endsUnattended(piece, false)).toBe(false)
  })

  it("gives no warrant, because nothing went past", () => {
    expect(warrantFor(held("auto"), 1)).toBeUndefined()
  })
})

/**
 * One row per reason, each a trak the row alone stops.
 *
 * Every case is the uneventful trak with one thing changed, so a row that stopped
 * passing would say which rule stopped firing rather than that something is wrong
 * somewhere in a flow.
 */
const STOPPED: readonly (readonly [string, Trak, number])[] = [
  [
    "the turn said it met a fork",
    trak("smart", ORDINARY, { 0: spent({}), 1: spent({ ambiguity: "some" }) }),
    1,
  ],
  [
    "the turn said it met several",
    trak("smart", ORDINARY, { 0: spent({}), 1: spent({ ambiguity: "a_lot" }) }),
    1,
  ],
  [
    "the position took a second turn",
    trak("smart", ORDINARY, { 0: spent({}), 1: spent({ iterations: 2 }) }),
    1,
  ],
  [
    "the step raised work nobody planned",
    trak(
      "smart",
      plan(
        compose(),
        step("build"),
        compose({ _tag: "Raised", step: 1, requirements: ["a mockup first"], corrections: [] }),
      ),
      { 0: spent({}), 1: spent({}) },
    ),
    1,
  ],
  [
    "the step raised work nobody planned alongside sending a document back",
    trak(
      "smart",
      plan(
        compose(),
        step("review"),
        compose({
          _tag: "Raised",
          step: 1,
          requirements: ["the offline case still needs building"],
          corrections: [{ at: "0-build", text: "no check ran" }],
        }),
      ),
      { 0: spent({}), 1: spent({}) },
    ),
    1,
  ],
  [
    "the round made the same complaint twice",
    trak(
      "smart",
      plan(
        compose(),
        step("build"),
        compose(raised(1, "1-build", "no check ran")),
        step("build"),
        compose(raised(3, "3-build", "no check ran")),
        step("build"),
      ),
      { 0: spent({}), 1: spent({}), 2: spent({}), 3: spent({}), 4: spent({}) },
    ),
    5,
  ],
  // The two rows above, with the raise absorbed: a recompose pressed mid-turn landed
  // after the step had sent the plan back, so the entry carries the person's reason with
  // the raise inside it. Both readers go through `raisedIn`; matching the entry's own
  // tag would walk past the step, and stop seeing the round.
  [
    "the step raised work nobody planned, and a raced recompose absorbed the raise",
    trak(
      "smart",
      plan(
        compose(),
        step("build"),
        compose({
          _tag: "Replanned",
          step: 1,
          reason: "go simpler",
          displaced: { _tag: "Raised", step: 1, requirements: ["a mockup first"], corrections: [] },
        }),
      ),
      { 0: spent({}), 1: spent({}) },
    ),
    1,
  ],
  [
    "the round made the same complaint twice, the second time inside a raced recompose",
    trak(
      "smart",
      plan(
        compose(),
        step("build"),
        compose(raised(1, "1-build", "no check ran")),
        step("build"),
        compose({
          _tag: "Replanned",
          step: 3,
          reason: "go simpler",
          displaced: raised(3, "3-build", "no check ran"),
        }),
        step("build"),
      ),
      { 0: spent({}), 1: spent({}), 2: spent({}), 3: spent({}), 4: spent({}) },
    ),
    5,
  ],
]

describe("what still stops a smart trak", () => {
  it.each(STOPPED)("%s", (_why, t, at) => {
    expect(runsUnattended(t, at)).toBe(false)
  })

  it("and not a step that only sent another document back", () => {
    // The other half of the same entry, and the both-fields row above is its twin: a complaint
    // names a document the plan already has a step for, so nothing about the shape
    // of the work moved and the loop answering it is the loop working.
    const rejecting = trak(
      "smart",
      plan(compose(), step("review"), compose(raised(1, "0-build", "no check ran"))),
      { 0: spent({}), 1: spent({}) },
    )
    expect(runsUnattended(rejecting, 1)).toBe(true)
  })
})

/** The fix a round planned — the last entry of the plan `after` builds. */
const lastFix = (t: Trak): number => (t.plan?.steps.length ?? 1) - 1

describe("the round of fixing a trak may spend unread", () => {
  /**
   * `rounds` complaint-and-fix rounds, each about something the last one did not say —
   * so nothing here is the repeat rule firing, which is the other bound.
   */
  const after = (rounds: number): Trak => {
    const steps: Step[] = [compose(), step("build")]
    const slots: Record<number, Slot> = { 0: spent({}), 1: spent({}) }
    for (let k = 0; k < rounds; k += 1) {
      slots[steps.length] = spent({})
      steps.push(
        compose(raised(steps.length - 1, `${steps.length - 1}-build`, `round ${String(k)}`)),
      )
      slots[steps.length] = spent({})
      steps.push(step("build"))
    }
    const [first, ...rest] = steps
    return trak("smart", { title: "the work", steps: [first ?? step("build"), ...rest] }, slots)
  }

  it("keeps going while every round finds something the last one did not", () => {
    // The rule that decides is the repeat, and a loop getting somewhere never trips it.
    const four = after(4)
    expect(runsUnattended(four, lastFix(four))).toBe(true)
  })

  it("stops on the round past the budget, for what comparing words cannot see", () => {
    // A reviewer that rephrases the same objection never repeats exactly, so *the
    // complaint changed* stays true while nothing is being fixed.
    const five = after(5)
    expect(runsUnattended(five, lastFix(five))).toBe(false)
    // And the re-cut that planned it stops with it: a round nobody should buy unread
    // is not one whose plan should go by unread either.
    expect(runsUnattended(five, lastFix(five) - 1)).toBe(false)
  })
})

describe("the plan gate, which is the compose entry's own", () => {
  it("goes past where the run that wrote the plan reported nothing and asked nothing", () => {
    expect(runsUnattended(uneventful(), 0)).toBe(true)
  })

  it("stops where that run reported a fork", () => {
    const asked = trak("smart", ORDINARY, { 0: spent({ ambiguity: "some" }), 1: spent({}) })
    expect(runsUnattended(asked, 0)).toBe(false)
  })

  it("stops where the composer asked the person a question first", () => {
    // A round of questions is a turn at that position, so the composer that had to ask
    // has spent two — which is the record saying the person was already in this.
    const asked = trak("smart", ORDINARY, { 0: spent({ iterations: 2 }), 1: spent({}) })
    expect(runsUnattended(asked, 0)).toBe(false)
  })

  it("stops where that run handed work off, and goes past the same run with none", () => {
    // Approving opens traks on the main line that never come back: the one thing on
    // this list that costs more than this trak, so `smart` wants a person at it.
    const handing = { 0: spent({ handOffs: ["fix the hook"] }), 1: spent({}) }
    expect(runsUnattended(trak("smart", ORDINARY, handing), 0)).toBe(false)
    expect(runsUnattended(uneventful(), 0)).toBe(true)
    // `auto` is the mode that means it, and is asked before the list.
    expect(runsUnattended(trak("auto", ORDINARY, handing), 0)).toBe(true)
  })

  it("goes past a goal's trak's hand-off, which opens nothing and goes to the goal", () => {
    const handing = { 0: spent({ handOffs: ["fix the hook"] }), 1: spent({}) }
    const inGoal = { ...trak("smart", ORDINARY, handing), goal: GoalId.make("g") }
    expect(runsUnattended(inGoal, 0)).toBe(true)
    // `manual` still stands there: the person approves, and the goal still places it.
    expect(runsUnattended({ ...inGoal, mode: "manual" }, 0)).toBe(false)
  })
})

describe("what the engine has to say for a gate it took", () => {
  it("names the rung the turn reported, which is the one clause anybody wrote", () => {
    expect(warrantFor(uneventful(), 1)).toEqual({ _tag: "Uneventful", ambiguity: "none" })
  })

  it("carries the rung a turn wrote even where it is not the reason the gate went past", () => {
    // `none` is a claim rather than a silence, and the band draws it as one: a position
    // that reported nothing and one that reported the lowest rung read alike here only
    // because absent *is* the lowest rung. See `ambiguityOf`.
    const rung = (a: Ambiguity): unknown =>
      warrantFor(trak("smart", ORDINARY, { 0: spent({}), 1: spent({ ambiguity: a }) }), 1)
    expect(rung("none")).toEqual({ _tag: "Uneventful", ambiguity: "none" })
    expect(rung("some")).toBeUndefined()
  })

  it("says the mode where the mode is what took the gate", () => {
    expect(warrantFor(uneventful("auto"), 1)).toEqual({ _tag: "Mode" })
    // The plan gate's record belongs to the compose entry that ran, so the entry has
    // to hold a session for there to be one to stamp — see `firstUnrun`.
    const landed = trak("auto", ORDINARY, {
      0: spent({ session: SessionId.make("00000000-0000-4000-8000-000000000001") }),
    })
    expect(planWarrant(landed)).toEqual([0, { _tag: "Mode" }])
    expect(planWarrant(uneventful("auto"))).toBeUndefined()
  })

  it("says nothing at all about a gate somebody read", () => {
    expect(warrantFor(uneventful("manual"), 1)).toBeUndefined()
    expect(planWarrant(uneventful("manual"))).toBeUndefined()
  })
})

describe("decider, which takes every document and leaves every call to the person", () => {
  const STOPS_SMART_NOT_DECIDER: readonly (readonly [string, Trak, number])[] = STOPPED.map(
    ([why, t, at]) => [why, { ...t, mode: "decider" }, at] as const,
  )

  it("takes the plan and an uneventful artifact, marked as the mode's", () => {
    const t = uneventful("decider")
    expect(warrantFor(t, 0)).toEqual({ _tag: "Mode" })
    expect(warrantFor(t, 1)).toEqual({ _tag: "Mode" })
    const landed = trak("decider", ORDINARY, {
      0: spent({ session: SessionId.make("00000000-0000-4000-8000-000000000001") }),
    })
    expect(planWarrant(landed)).toEqual([0, { _tag: "Mode" }])
  })

  // Every row `smart` stops on: a reported fork, a second turn after answered
  // questions, raised work, a round of fixing that has stopped landing. None is a
  // question or a conversation in front of a person.
  it.each(STOPS_SMART_NOT_DECIDER)("goes past where smart stops: %s", (_why, t, at) => {
    expect(runsUnattended(t, at)).toBe(true)
  })

  it("answers no question and ends no conversation on the person's behalf", () => {
    const t = uneventful("decider")
    expect(approvedInAdvance(t)).toBe(false)
    expect(unanswered(t, 1)).toBe(false)
    expect(unanswered(t, 0)).toBe(false)
  })

  it("stops at a plan that hands work off, but not on a goal's trak", () => {
    const handing = { 0: spent({ handOffs: ["fix the hook"] }), 1: spent({}) }
    expect(runsUnattended(trak("decider", ORDINARY, handing), 0)).toBe(false)
    expect(
      runsUnattended({ ...trak("decider", ORDINARY, handing), goal: GoalId.make("g") }, 0),
    ).toBe(true)
  })

  it("stops at every gate of a held step", () => {
    const held = { ...uneventful("decider"), holding: true }
    expect(runsUnattended(held, 0)).toBe(false)
    expect(runsUnattended(held, 1)).toBe(false)
  })

  it("ends a child as auto does, and holds one with a pending hold", () => {
    const piece: Trak = {
      ...uneventful("decider"),
      parent: { id: TrakId.make("parent"), step: 1, child: 0, depth: 1 },
    }
    expect(endsUnattended(piece, true)).toBe(true)
    expect(endsUnattended(piece, false)).toBe(true)
    expect(endsUnattended({ ...piece, holding: true }, false)).toBe(false)
    expect(endsUnattended(uneventful("decider"), true)).toBe(false)
  })
})
