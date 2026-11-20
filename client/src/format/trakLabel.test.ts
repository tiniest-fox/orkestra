// Tier-1: every state, as a list row reads it.

import { describe, expect, it } from "vitest"
import type { TrakStateDto } from "../api/types"
import { TONES } from "./tone"
import { trakLabel as labelOf } from "./trakLabel"

/**
 * Every case below but the ones about a no-code trak reads a branch something was
 * committed to, which is what all but a handful of traks are — and it keeps each case
 * about the state it names. `trakLabel` itself takes the fact required for the reason its
 * docstring gives; this is where the reading is fixed, once, rather than at forty sites.
 */
const trakLabel = (state: TrakStateDto): ReturnType<typeof labelOf> => labelOf(state, true)

/** The other reading: a trak that ran its plan out with nothing on its branch. */
const nothing = (state: TrakStateDto): ReturnType<typeof labelOf> => labelOf(state, false)

/** A new state is a missing key here, which is the point of writing it as a record. */
type StateSamples = { [K in TrakStateDto["_tag"]]: Extract<TrakStateDto, { readonly _tag: K }> }

const states: StateSamples = {
  Preparing: { _tag: "Preparing" },
  Composing: { _tag: "Composing" },
  AwaitingProposal: { _tag: "AwaitingProposal" },
  AgentWorking: { _tag: "AgentWorking", step: 2 },
  Stopping: { _tag: "Stopping", step: 2 },
  CheckRunning: { _tag: "CheckRunning", step: 2 },
  ConditionRunning: { _tag: "ConditionRunning", step: 2 },
  AwaitingHuman: { _tag: "AwaitingHuman", step: 2, kind: "approval" },
  AwaitingComposerAnswers: { _tag: "AwaitingComposerAnswers" },
  Spawning: { _tag: "Spawning", step: 2 },
  HandingOff: { _tag: "HandingOff", step: 2 },
  AwaitingChildren: { _tag: "AwaitingChildren", step: 2 },
  Joining: { _tag: "Joining", step: 2 },
  Committing: { _tag: "Committing", step: 2 },
  Effecting: { _tag: "Effecting", step: 2 },
  Integrating: { _tag: "Integrating" },
  Abandoning: { _tag: "Abandoning", reason: "did it by hand" },
  Finished: { _tag: "Finished" },
  Closing: { _tag: "Closing" },
  Closed: { _tag: "Closed" },
  Merging: { _tag: "Merging" },
  Merged: { _tag: "Merged", sha: "b8c3120eb1b3f4a2" },
  Abandoned: { _tag: "Abandoned", reason: "did it by hand" },
  Failed: {
    _tag: "Failed",
    error: "usage limit reached",
    kind: "provider",
    apiKind: "rate_limit",
  },
}

describe("trakLabel", () => {
  it("labels every state but one, from the closed tone set", () => {
    // No count: the mapped type above is the guard, and a number would be a second copy.
    const every = Object.values(states)
    for (const state of every) {
      const row = trakLabel(state)
      // `undefined` where there is nothing to say, never a blank string: one
      // representation of absence, and it is what makes both surfaces render
      // nothing rather than an empty pill.
      expect(row.label).not.toBe("")
      expect(TONES).toContain(row.tone)
    }
  })

  it("says nothing at all at `AwaitingChildren`, and something everywhere else", () => {
    // Its children are each on their own row saying what they are doing; a phrase here
    // would be a fourth way of reading the same fact.
    const silent = Object.entries(states)
      .filter(([, state]) => trakLabel(state).label === undefined)
      .map(([tag]) => tag)
    expect(silent).toEqual(["AwaitingChildren"])
  })

  it("repeats a phrase only where two states mean the same thing to a reader", () => {
    // Two states reading the same is normally a list that cannot be scanned, and it
    // is how a copy-pasted arm survives review — so the collisions are enumerated
    // rather than allowed. Both of these are deliberate: committing a step's work and
    // committing the last of it are one act at two positions, and the composer asking
    // before it plans is the same ask as a step asking mid-plan. What separates each
    // pair on a row is the instruction line beside it, not the status.
    const labels = Object.values(states)
      .map((state) => trakLabel(state).label)
      .filter((label) => label !== undefined)
    const repeated = labels.filter((label, i) => labels.indexOf(label) !== i)
    expect(repeated).toEqual(["Committing work…"])
    expect(trakLabel(states.AwaitingComposerAnswers).label).toBe(
      trakLabel({ _tag: "AwaitingHuman", step: 0, kind: "answers" }).label,
    )
  })

  it("says `waiting` at exactly the states a human is standing at", () => {
    // The three `asGate` recognises. Nothing else may claim a human is owed something.
    const waiting = Object.entries(states)
      .filter(([, state]) => trakLabel(state).tone === "waiting")
      .map(([tag]) => tag)
      .sort()
    // `Finished` is the odd one and the reason this list changed: a trak that ran
    // out of plan now holds its checkout and waits for a person to close, merge or
    // re-enter it. It is the one `waiting` state with no gate — see `asGate`,
    // which offers nothing there because none of those is a `HumanAction`. It is here
    // because these readings are all of a branch something was committed to; a trak
    // with nothing on its branch is owed nothing and is not, which is the case below.
    expect(waiting).toEqual([
      "AwaitingComposerAnswers",
      "AwaitingHuman",
      "AwaitingProposal",
      "Finished",
    ])
  })
})

describe("trakLabel — the tones", () => {
  it("says `working` for every state the engine is mid-something in", () => {
    // `Integrating` belongs here and is easy to forget: committing the work is a
    // state that can fail, so it is something in flight rather than a trak that is
    // already done. `Closing` is its counterpart at the far end, one human decision
    // later, and `git worktree remove` can fail the same way.
    const working = Object.entries(states)
      .filter(([, state]) => trakLabel(state).tone === "working")
      .map(([tag]) => tag)
      .sort()
    // A spawn's three belong here for a sharper reason: `AwaitingChildren` is the
    // one state whose name says *awaiting* and whose tone is not `waiting`. What is
    // owed there is N traks running, not an action from a person — and `waiting` is
    // the tone an action bar reacts to.
    // `Abandoning` is `Integrating` with a different destination — the same commit,
    // and it can fail the same way, so it is in flight for the same reason.
    expect(working).toEqual([
      "Abandoning",
      "AgentWorking",
      "AwaitingChildren",
      "CheckRunning",
      "Closing",
      "Committing",
      "Composing",
      "ConditionRunning",
      "Effecting",
      "HandingOff",
      "Integrating",
      "Joining",
      "Merging",
      "Preparing",
      "Spawning",
      "Stopping",
    ])
  })

  it("gives each ending its own tone, and `neutral` to the two nobody merged", () => {
    // **This reversed twice.** It first asserted `neutral` was unreachable, on the
    // argument that a trak is always waiting on the engine, waiting on a person,
    // done or broken. Abandonment is the fifth situation: stopped on purpose,
    // nothing owed and nothing wrong — which is what `neutral` is for. `bad` would
    // scold, and a row that scolds is a declaration people stop making, which costs
    // the corpus exactly the traks worth reading.
    //
    // Then `Finished` stopped being an ending: it holds its checkout and waits for
    // a person, so `good` said the opposite of what is true. And now the three ended
    // states share `neutral`: they draw as one Archived pile, and toning one of them
    // `good` would be three tones under one lid.
    expect(trakLabel(states.Failed).tone).toBe("bad")
    expect(trakLabel(states.Merged).tone).toBe("neutral")
    expect(trakLabel(states.Closed).tone).toBe("neutral")
    expect(trakLabel(states.Abandoned).tone).toBe("neutral")
    // No *state* claims `good` at all now, which is the assertion this keeps: the app's
    // `good` rows are the MERGED rung's and a `Finished` trak read together with a
    // branch nothing was committed to — below.
    const good = Object.entries(states).filter(([, s]) => trakLabel(s).tone === "good")
    expect(good.map(([tag]) => tag)).toEqual([])
  })

  it("names no step at all", () => {
    // No phrase ends "— step 3". A bare index answers a question nobody asked —
    // *of how many?* — and the row carries `TrakSummaryDto.instruction`, the
    // composer's own sentence for that step, which is what a number stands in for.
    expect(trakLabel(states.AgentWorking).label).toBe("Working…")
    expect(trakLabel(states.CheckRunning).label).toBe("Running automated checks…")
    expect(trakLabel(states.Stopping).label).toBe("Stopping…")
    for (const state of Object.values(states)) {
      expect(trakLabel(state).label ?? "").not.toMatch(/step/i)
    }
  })

  it("distinguishes the five human gates, which share a state", () => {
    const kinds: readonly TrakStateDto[] = [
      { _tag: "AwaitingHuman", step: 0, kind: "approval" },
      { _tag: "AwaitingHuman", step: 0, kind: "answers" },
      { _tag: "AwaitingHuman", step: 0, kind: "checks" },
      { _tag: "AwaitingHuman", step: 0, kind: "stuck" },
      { _tag: "AwaitingHuman", step: 0, kind: "conversation" },
    ]
    expect(kinds.map((state) => trakLabel(state).label)).toEqual([
      "Output awaiting approval",
      "Questions need answers",
      "Automated checks failed",
      "Step could not do the work",
      "Agent awaiting response",
    ])
  })

  it("shows a failure's chip, not the provider's sentence", () => {
    // `error` can be a paragraph of CLI output. The row gets the short form of the same
    // fact — `failure.ts` holds both lengths, and the notice in the drawer has the other.
    const row = trakLabel(states.Failed)
    expect(row.label).toBe("usage limit")
    expect(row.label).not.toContain(states.Failed.error)
  })

  it("tells two provider failures apart, which `${kind} failed` could not", () => {
    // The complaint: an interruption and an exhausted usage limit both read *provider
    // failed*, and a person does opposite things about them.
    expect(trakLabel({ ...states.Failed, apiKind: "interrupted" }).label).toBe("interrupted")
    expect(trakLabel({ ...states.Failed, apiKind: undefined }).label).toBe("provider failed")
  })
})

/**
 * The second argument: the one thing about a trak that is not on its state. An
 * investigation that answered a question, work done on a deploy box and a check that found
 * nothing all reach `Finished` with a branch nobody committed to.
 */
describe("trakLabel — a finished trak whose branch never moved", () => {
  it("names the one press it has left, where a trak with commits names the other", () => {
    expect(nothing(states.Finished).label).toBe("Finished — nothing to merge")
    expect(trakLabel(states.Finished).label).toBe("Ready to merge")
  })

  it("is `good` rather than `waiting`, and it is the second `good` there is", () => {
    // Not `waiting`: the held checkout is real and Close is still the press, but there is
    // no merge to decide about — which is what separates it from the pile above it.
    expect(nothing(states.Finished).tone).toBe("good")
    expect(trakLabel(states.Finished).tone).toBe("waiting")
  })

  it("changes nothing at any other state, `Merging` and `Closing` included", () => {
    // Once a person has decided, *nothing landed* has stopped being the useful fact — so
    // the argument is read at exactly one state and the other twenty are untouched.
    // Written over the whole set rather than over the four endings, because a state added
    // to the union arrives here already asserted.
    const differs = Object.entries(states)
      .filter(([, state]) => nothing(state).label !== trakLabel(state).label)
      .map(([tag]) => tag)
    expect(differs).toEqual(["Finished"])
  })
})
