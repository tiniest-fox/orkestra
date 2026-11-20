// Tier-1: which states the engine draws a block at, and what it says at each.

import { describe, expect, it } from "vitest"
import type { PlanDto, TrakStateDto } from "../../api/types"
import { trakLabel } from "../../format/trakLabel"
import { engineWork } from "./engineWork"

/** A new state is a missing key here, which is the point of writing it as a record. */
type StateSamples = { [K in TrakStateDto["_tag"]]: Extract<TrakStateDto, { readonly _tag: K }> }

const states: StateSamples = {
  Preparing: { _tag: "Preparing" },
  Composing: { _tag: "Composing" },
  AwaitingProposal: { _tag: "AwaitingProposal" },
  AwaitingComposerAnswers: { _tag: "AwaitingComposerAnswers" },
  AgentWorking: { _tag: "AgentWorking", step: 2 },
  Stopping: { _tag: "Stopping", step: 2 },
  CheckRunning: { _tag: "CheckRunning", step: 2 },
  ConditionRunning: { _tag: "ConditionRunning", step: 2 },
  AwaitingHuman: { _tag: "AwaitingHuman", step: 2, kind: "approval" },
  Spawning: { _tag: "Spawning", step: 1 },
  HandingOff: { _tag: "HandingOff", step: 0 },
  AwaitingChildren: { _tag: "AwaitingChildren", step: 1 },
  Joining: { _tag: "Joining", step: 1 },
  Committing: { _tag: "Committing", step: 2 },
  Effecting: { _tag: "Effecting", step: 2 },
  Integrating: { _tag: "Integrating" },
  Abandoning: { _tag: "Abandoning", reason: "did it by hand" },
  Finished: { _tag: "Finished" },
  Merging: { _tag: "Merging" },
  Closing: { _tag: "Closing" },
  Closed: { _tag: "Closed" },
  Merged: { _tag: "Merged", sha: "b8c3120eb1b3f4a2" },
  Abandoned: { _tag: "Abandoned", reason: "did it by hand" },
  Failed: { _tag: "Failed", error: "usage limit reached", kind: "provider", apiKind: "rate_limit" },
}

const BRANCH = "trak/01HQ8G"

/** A spawn at entry 1, so `Spawning{step: 1}` above lands on it. */
const plan: PlanDto = {
  title: "Add a read-only client",
  steps: [
    { type: "compose" },
    {
      type: "spawn",
      instruction: "build both halves",
      children: [
        [{ agent: "builder", instruction: "wire the band" }],
        [{ agent: "builder", instruction: "draw the columns" }],
      ],
    },
  ],
}

const at = (state: TrakStateDto) => engineWork(state, BRANCH, plan, undefined)

describe("engineWork", () => {
  it("draws a block at the eight states the engine works at, and nowhere else", () => {
    const drawn = Object.entries(states)
      .filter(([, state]) => at(state) !== undefined)
      .map(([tag]) => tag)
      .sort()
    // Not simply `commandInFlight`'s list: `Composing` and `AgentWorking` are an agent's
    // turns and the pane already draws those; `CheckRunning` is out of this round by
    // decision; and `Joining` is a parent standing on a piece's row, where covering that
    // piece's work is the one thing this must not do.
    expect(drawn).toEqual([
      "Abandoning",
      "Closing",
      "Committing",
      "Effecting",
      "HandingOff",
      "Integrating",
      "Merging",
      "Preparing",
      "Spawning",
    ])
  })

  it("never repeats `trakLabel`'s phrase for the same state", () => {
    // Both faces, at every state that has one. All three of the design round's directions
    // printed `trakLabel`'s phrase again until a review caught it — the same words in two
    // voices, which is the whole reason this module writes its own.
    for (const state of Object.values(states)) {
      const work = at(state)
      if (work === undefined) continue
      // Both readings of `Finished`, since `trakLabel` says two different things there
      // and the block must not collide with either.
      for (const moved of [true, false]) {
        const { label } = trakLabel(state, moved)
        expect(work.doing).not.toBe(label)
        expect(work.stopped).not.toBe(label)
      }
    }
  })

  it("says something different when it is stopped, at every state", () => {
    for (const state of Object.values(states)) {
      const work = at(state)
      if (work === undefined) continue
      expect(work.stopped).not.toBe(work.doing)
      expect(work.doing).not.toBe("")
      expect(work.stopped).not.toBe("")
    }
  })

  it("carries a sentence under the working heading, at every state", () => {
    // `EmptyState`'s two-line rule: a heading is never on its own. The sentence is the
    // working face's; the stopped face takes `stoppedWords.line`.
    for (const state of Object.values(states)) {
      const work = at(state)
      if (work === undefined) continue
      expect(work.sentence).not.toBe("")
      expect(work.sentence).not.toBe(work.doing)
    }
  })

  it("names the branch at the three states that commit, and the command at the two endings", () => {
    expect(at(states.Committing)?.command).toBe(BRANCH)
    expect(at(states.Integrating)?.command).toBe(BRANCH)
    expect(at(states.Abandoning)?.command).toBe(BRANCH)
    // What the engine actually runs — `git merge --no-ff --no-verify -m … <branch>` and
    // `git worktree remove --force`, cut to the half that says what is happening.
    expect(at(states.Merging)?.command).toBe("git merge --no-ff")
    expect(at(states.Closing)?.command).toBe("git worktree remove --force")
  })

  it("says nothing in the mono line while the checkout is being made", () => {
    // Neither half of the design sheet's `.orkestra/.worktrees/<id> · pnpm install` is a
    // fact the client holds: `worktree` is absent from the detail until the checkout
    // exists, and the setup script never crosses the wire. Inventing the path would be a
    // second copy of a rule `vcs/logic/paths.ts` owns.
    expect(at(states.Preparing)?.command).toBeUndefined()
  })

  it("says the preparation the engine named, with a sandbox's line in the runner's own words", () => {
    const named = engineWork(states.Preparing, undefined, undefined, {
      _tag: "Resuming",
      runner: "Runs each trak in a sandbox.",
    })
    expect(named).toMatchObject({
      doing: "Resuming the stopped sandbox",
      sentence: "Runs each trak in a sandbox.",
      stopped: "Stopped while making the checkout",
    })
    // Before the engine names one, the whole act.
    expect(at(states.Preparing)?.doing).toBe("Making the checkout and running setup")
  })

  it("counts the pieces a spawn is putting out, off the plan entry it is at", () => {
    // The log has no `ChildrenSpawned` yet — that event is what `Spawning` is on its way
    // to — so the plan is the only thing that can say.
    expect(at(states.Spawning)?.command).toBe("2 pieces, off trak/01HQ8G")
  })

  it("says whichever half it has, where the plan or the checkout is not there yet", () => {
    expect(engineWork(states.Spawning, BRANCH, undefined, undefined)?.command).toBe(
      "off trak/01HQ8G",
    )
    expect(engineWork(states.Spawning, undefined, plan, undefined)?.command).toBe("2 pieces")
    expect(engineWork(states.Spawning, undefined, undefined, undefined)?.command).toBeUndefined()
    // A branch the detail has not brought back yet is an absence, never an empty chip.
    expect(engineWork(states.Committing, undefined, plan, undefined)?.command).toBeUndefined()
  })

  it("gives committing a step's work and committing the last of it the same words", () => {
    // One act at two positions, which is why `trakLabel` gives them one phrase too. The
    // step bar is what separates them.
    expect(at(states.Committing)?.doing).toBe(at(states.Integrating)?.doing)
    expect(at(states.Abandoning)?.doing).toBe(at(states.Integrating)?.doing)
    // And a different mark, which is the only thing that says where it is going.
    expect(at(states.Abandoning)?.icon).not.toBe(at(states.Integrating)?.icon)
  })

  it("names no destination for a merge", () => {
    // The engine merges into whatever branch the machine is standing on, or into its
    // parent for a piece. Neither is a fact this surface can name without inventing it.
    const merging = at(states.Merging)
    expect(merging?.doing).not.toMatch(/main/i)
    expect(merging?.sentence).not.toMatch(/main/i)
    expect(merging?.stopped).not.toMatch(/main/i)
  })
})
