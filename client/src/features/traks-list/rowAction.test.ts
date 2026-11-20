// Tier-1: which states put a word in the row's right-hand slot, and which do not.

import { describe, expect, it } from "vitest"
import type { TrakStateDto } from "../../api/types"
import { rowAction } from "./rowAction"

/** Same shape as `trakLabel.test.ts`'s: a new state is a missing key. */
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
  Failed: { _tag: "Failed", error: "usage limit reached", kind: "provider" },
}

describe("rowAction", () => {
  it("offers a word at exactly the states a person can do something about", () => {
    // The three gates, plus the two states that are at rest and still owe a person a
    // decision. Everything else belongs to the engine or is over, and a word there
    // would be an affordance for something nobody can do.
    const offered = Object.entries(states)
      .filter(([, state]) => rowAction(state) !== undefined)
      .map(([tag]) => tag)
      .sort()
    expect(offered).toEqual([
      "AwaitingComposerAnswers",
      "AwaitingHuman",
      "AwaitingProposal",
      "Failed",
      "Finished",
    ])
  })

  it("says nothing at `AwaitingChildren`, which is not a gate", () => {
    // The one state whose name says *awaiting* and whose wait is not a person's.
    // Each child gates on its own row.
    expect(rowAction(states.AwaitingChildren)).toBeUndefined()
  })

  it("distinguishes the five human gates, which share a state", () => {
    const kinds: readonly TrakStateDto[] = [
      { _tag: "AwaitingHuman", step: 0, kind: "approval" },
      { _tag: "AwaitingHuman", step: 0, kind: "answers" },
      { _tag: "AwaitingHuman", step: 0, kind: "checks" },
      { _tag: "AwaitingHuman", step: 0, kind: "stuck" },
      { _tag: "AwaitingHuman", step: 0, kind: "conversation" },
    ]
    // Checks and stuck share `Decide`: both put a judgement rather than a
    // document in front of a person.
    expect(kinds.map(rowAction)).toEqual(["Review", "Answer", "Decide", "Decide", "Reply"])
  })

  it("offers `Archive` at `Finished`, not `Merge`", () => {
    // One word for all seven finished piles — the status beside it is what differs.
    // Merging writes to whatever branch the machine is standing on, so it shows the
    // destination and asks — which the wire does not carry. A row must not name a
    // control the page it links to does not have.
    expect(rowAction(states.Finished)).toBe("Archive")
  })
})
