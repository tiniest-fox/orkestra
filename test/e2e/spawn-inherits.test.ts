// What a child of a spawn is born with, and what it hands back to its parent: the
// plan's requirements, the documents the split was decided from, and a supersedes
// either side files against the other. The rest of the spawn is `spawn.test.ts`.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { afterReentry, childStep, composer, onGit, step } from "../support/flow.js"
import { inWorktree, readInWorktree, worktreeOf } from "../support/git.js"
import { approveAll, createAndStart, human, logTags, act } from "../support/scenario.js"
import type { AgentLog } from "../support/scripted-agent.js"
import { onPrompt, reply } from "../support/scripted-agent.js"
import type { SessionRequest } from "../../src/agent/types/session.js"
import type { Decided } from "../../src/workflow/domain/outputs/decided.js"
import { slotAt, type TrakId } from "../../src/workflow/domain/trak.js"
import { advance, driveChild } from "../../src/workflow/runtime.js"
import { Events } from "../../src/workflow/domain/event.js"
import { current, lenses, mergeChild, runChildren } from "../support/spawn.js"

// The subject here is git, so every flow runs on it.
const { runFlow, runFlowWithAgentLog } = onGit

/**
 * The composer's turns, hoisted because a `.map` or `.filter` inside a test body
 * is one callback deeper than this repository allows.
 */
const composerTurns = (log: AgentLog): readonly SessionRequest[] =>
  log.requests.filter((r) => r.prompt.includes("Compose a pipeline"))

/** The turns that were told what larger work they are a piece of. Same reason. */
const pieceTurns = (log: AgentLog): readonly SessionRequest[] =>
  log.requests.filter((r) => r.prompt.includes("The work this is a piece of"))

/**
 * One decision from each side of the boundary, so the flow can assert both.
 *
 * Both are constraints, so neither re-cuts the plan — the flow below is about what a
 * child inherits and hands back, and a plan redrawn under it would be a second thing
 * happening at the same time.
 */
const PER_KEY: Decided = {
  text: "rate-limit per key, not per IP",
  source: "stated",
  kind: "constraint",
}
const GUESSABLE: Decided = {
  text: "assumed the key is not guessable",
  source: "assumed",
  kind: "constraint",
}

/** The same, as the parent records them: provenance stamped, kind spent. */
const at = (d: Decided, key: string) => ({ text: d.text, source: d.source, at: key })

/** A parent step's supersedes against the plan before it. */
const STALE: Decided = {
  text: "the limiter is per key, not per route as planned",
  source: "assumed",
  kind: "constraint",
  supersedes: ["1-plan"],
}
/**
 * A child's supersedes against the same plan, by the key the child opened it under —
 * and against the parent's entry above, by the id both traks give it.
 */
const BACK: Decided = {
  text: "and it has no burst allowance",
  source: "assumed",
  kind: "constraint",
  supersedes: ["from-parent/1-plan", "2-work.1"],
}

describe("what a child is born with", () => {
  it("never runs a composer — a human approved the plan that named it", () =>
    runFlowWithAgentLog(
      [
        composer("work", lenses, "plan"),
        step(1, "work", reply.artifact("the change")),
        childStep("review", "security", reply.artifact("no injection")),
        childStep("review", "performance", reply.artifact("one N+1")),
        step(3, "plan", reply.artifact("both addressed")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Rate-limit the public API")
          yield* runChildren(yield* act(id, 1, human.approve()), 2)
          // One compose for the whole trak, not one per child. A second approval
          // of the same decision is a tax, not a gate — so a child enters its
          // plan at step 0 straight out of `WorktreeReady`.
          expect(composerTurns(yield* agentLog)).toHaveLength(1)
        }),
    ))

  it("inherits the parent's requirements, and the parent gets the child's back", () =>
    runFlow(
      [
        composer("work", lenses, "plan"),
        step(1, "work", reply.deciding("the change", [PER_KEY])),
        childStep("review", "security", reply.decidingStuck("two passes", [GUESSABLE])),
        childStep("review", "performance", reply.artifact("one N+1")),
        step(3, "plan", reply.artifact("both addressed")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Rate-limit the public API")
          const parked = yield* act(id, 1, human.approve())

          // Down: the child opens on the same request-plus-requirements every other
          // turn reads, with the parent's provenance intact.
          const born = yield* driveChild(parked, 2, 0)
          expect(born.decisions).toContainEqual(at(PER_KEY, "1-work"))

          const joined = yield* runChildren(parked, 2)
          // Up: what the child settled, stamped where the parent filed it — and
          // the parent's own entry is not sent back and duplicated.
          expect(joined.decisions).toEqual([at(PER_KEY, "1-work"), at(GUESSABLE, "2.0-review")])
        }),
    ))

  it("inherits the artifacts the split was decided from, as files in its own checkout", () =>
    runFlowWithAgentLog(
      [
        composer("work", lenses, "plan"),
        step(1, "work", reply.artifact("the change")),
        childStep("review", "security", reply.artifact("no injection")),
        childStep("review", "performance", reply.artifact("one N+1")),
        step(3, "plan", reply.artifact("both addressed")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Rate-limit the public API")
          const parked = yield* act(id, 1, human.approve())
          const born = yield* driveChild(parked, 2, 0)

          // The projection is gitignored and a child branches rather than shares
          // a checkout, so nothing else would put the parent's spec where the
          // child can open it. Its own projection does, from what it was born
          // with — under a directory of its own, because the child's plan
          // numbers from zero and would otherwise collide.
          expect(born.inherited).toHaveLength(1)
          expect(inWorktree(worktreeOf(born), ".orkestra/.trak/from-parent/1-work.md")).toBe(true)

          const told = pieceTurns(yield* agentLog)
          expect(told).toHaveLength(1)
          expect(told[0]?.prompt).toContain(
            "- from-parent/1-work — `.orkestra/.trak/from-parent/1-work.md`",
          )
          // And the one it was split out of comes inline, as the handoff it is.
          expect(told[0]?.prompt).toContain("The step before yours: from-parent/1-work")
          expect(told[0]?.prompt).toContain("the change")
        }),
    ))

  it("opens on the pieces it was split from, and is told they are not its work", () =>
    runFlowWithAgentLog(
      [
        composer("work", lenses, "plan"),
        step(1, "work", reply.artifact("the change")),
        childStep("review", "security", reply.artifact("no injection")),
        childStep("review", "performance", reply.artifact("one N+1")),
        step(3, "plan", reply.artifact("both addressed")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Rate-limit the public API")
          const parked = yield* act(id, 1, human.approve())
          const born = yield* driveChild(parked, 2, 0)

          // Read off disk, because the file is the whole mechanism: `trak.md` is what
          // every turn of this child opens, composer and step agent alike.
          const opened = readInWorktree(worktreeOf(born), ".orkestra/.trak/trak.md")
          expect(opened).toContain("- 2.0-review — Produce the review for security.  ← THIS PIECE")
          expect(opened).toContain("- 2.1-review — Produce the review for performance.")
          // Names and instructions, never a location. A sibling's id or branch is an
          // invitation to build against a tree that may never land, and the answer for
          // this child is the same either way: not yours.
          const sibling = slotAt(parked, 2).children[1]
          expect(sibling).toBeDefined()
          expect(opened).not.toContain(String(sibling?.id))

          // And the rule, which is what stops the roster being decoration: without it
          // the requirements channel still says an unmet gap is work nobody planned.
          const told = pieceTurns(yield* agentLog)
          expect(told[0]?.prompt).toContain("## The pieces beside this one")
          expect(told[0]?.prompt).toContain("not work this plan is missing")
          // And where its branch goes, which is the one fact the conventions' rule
          // about a child's pull request is written against.
          expect(told[0]?.prompt).toContain("## This trak is a child")
          expect(told[0]?.prompt).toContain("merged back into the parent's worktree")
        }),
    ))
})

// A supersedes crosses the spawn boundary twice, and the key it names is a different
// trak's each time — down, it has to land on the copy the child opens; up, on the
// parent's own file. Neither direction is one the step that wrote it can see.
describe("a supersedes across the spawn boundary", () => {
  it("carries a supersedes down onto the copy the child opens, and back up onto the parent's own", () =>
    runFlow(
      [
        composer("plan", "work", lenses, "plan"),
        step(1, "plan", reply.artifact("per route")),
        step(2, "work", reply.deciding("the change", [STALE])),
        childStep("review", "security", reply.deciding("two passes", [BACK])),
        childStep("review", "performance", reply.artifact("one N+1")),
        step(4, "plan", reply.artifact("both addressed")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Rate-limit the public API")
          yield* act(id, 1, human.approve())
          const parked = yield* act(id, 2, human.approve())

          // Down: named by the key the child files the document under, so the note
          // is on the file the child opens rather than on nothing.
          const born = yield* driveChild(parked, 3, 0)
          expect(born.decisions).toContainEqual({
            ...at(STALE, "2-work"),
            supersedes: ["from-parent/1-plan"],
          })
          expect(readInWorktree(worktreeOf(born), ".orkestra/.trak/from-parent/1-plan.md")).toBe(
            "> **Superseded by `2-work.1`** — the limiter is per key, not per route as planned\n\n" +
              "## Summary\n\nper route\n",
          )

          // Up: by the parent's own key, beside the parent's own entry — and on the
          // parent's own file once its next step is given the directory. The id the
          // child named is the parent's own for that entry, so the child's entry
          // folds it out of the list the parent's next step reads.
          const joined = yield* runChildren(parked, 3)
          expect(joined.decisions).toEqual([
            { ...at(STALE, "2-work"), supersedes: ["1-plan"] },
            { ...at(BACK, "3.0-review"), supersedes: ["1-plan", "2-work.1"] },
          ])
          expect(readInWorktree(worktreeOf(joined), ".orkestra/.trak/1-plan.md")).toBe(
            "> **Superseded by `2-work.1`** — the limiter is per key, not per route as planned\n\n" +
              "> **Superseded by `3.0-review.1`** — and it has no burst allowance\n\n" +
              "## Summary\n\nper route\n",
          )
          expect(readInWorktree(worktreeOf(joined), ".orkestra/.trak/trak.md")).not.toContain(
            "not per route as planned",
          )
        }),
    ))
})

/**
 * A landed child sent back and filing again: the re-cut plan runs on after the
 * compose entry, so its `review` is `2-review` and adds one entry, and its `plan`
 * replaces that one and the one that landed — both by the ids the child's own
 * `trak.md` gave them.
 */
const AGAIN: Decided = {
  text: "and the cache is never warm on first hit",
  source: "assumed",
  kind: "constraint",
}
const REPLACING: Decided = {
  text: "the key is not guessable, and the cache is warm after the first hit",
  source: "assumed",
  kind: "constraint",
  supersedes: ["2-review.1", "0-review.1"],
}

/** `lenses` again, with the first lens sent back after it landed and filing twice more. */
const refilingFlow = [
  composer("work", lenses, "plan"),
  step(1, "work", reply.deciding("the change", [PER_KEY])),
  childStep("review", "security", reply.deciding("two passes", [GUESSABLE])),
  childStep("review", "performance", reply.artifact("one N+1")),
  afterReentry("review", "plan"),
  // Matched on the piece marker too: the parent's own `plan` is `3-plan` as well, and
  // a turn is spent by whichever request reaches it first.
  onPrompt(/piece of[\s\S]*artifact named `2-review`/, reply.deciding("a third pass", [AGAIN])),
  onPrompt(/piece of[\s\S]*artifact named `3-plan`/, reply.deciding("what stands", [REPLACING])),
  step(3, "plan", reply.artifact("both addressed")),
]

/** The child re-entered, planned again, run to its end and merged again, so it refiles. */
const sentBackAndMerged = (kid: TrakId) =>
  Effect.gen(function* () {
    const reentered = yield* advance(kid, Events.reentered("look again"))
    const settled = yield* approveAll(kid, reentered)
    expect(settled.state._tag).toBe("Finished")
    yield* mergeChild(settled)
  })

/** What the parent holds once the refile is in: the child's own numbered as the child's own, in order. */
const refiledOnParent = [
  at(PER_KEY, "1-work"),
  at(GUESSABLE, "2.0-review"),
  at(AGAIN, "2.0-review"),
  { ...at(REPLACING, "2.0-review"), supersedes: ["2.0-review.2", "2.0-review.1"] },
]

// A refile names the child's own entries by the child's ids, and the parent calls
// those entries by the piece's key and their place among the child's own — the
// one that landed first and the one refiled beside it alike. Numbered against the
// parent's recorded count, or over the slice going up, the names fold the wrong
// entry: a supersedes that silently deletes the wrong requirement, which is the
// failure the channel exists to close.
describe("a landed child that refiles a supersedes against its own entries", () => {
  it("folds the entries it named, before the join, whether they landed or came up beside it", () =>
    runFlow(refilingFlow, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        const parked = yield* act(id, 1, human.approve())
        const first = yield* driveChild(parked, 2, 0)
        yield* mergeChild(yield* approveAll(first.id, first))

        // Sent back while its sibling is still out: the refile goes onto the landing,
        // and nothing enters the parent until the join.
        yield* sentBackAndMerged(first.id)
        const waiting = yield* current(id)
        expect(waiting.state).toEqual({ _tag: "AwaitingChildren", step: 2 })
        expect(yield* logTags(id)).toContain("ChildRefiled")
        expect(waiting.decisions).toEqual([at(PER_KEY, "1-work")])

        const second = yield* driveChild(waiting, 2, 1)
        yield* mergeChild(yield* approveAll(second.id, second))
        const joined = yield* current(id)
        expect(joined.decisions).toEqual(refiledOnParent)
        // What the parent's next step reads: the replacing entry and neither of the
        // two it named.
        const intent = readInWorktree(worktreeOf(joined), ".orkestra/.trak/trak.md")
        expect(intent).toContain("the key is not guessable, and the cache is warm")
        expect(intent).toContain("*2.0-review.3*, supersedes `2.0-review.2`, `2.0-review.1`")
        expect(intent).not.toContain("assumed the key is not guessable\n")
        expect(intent).not.toContain("never warm on first hit")
      }),
    ))

  it("folds the entries it named after the join too, when the refile lands straight on the trak", () =>
    runFlow(refilingFlow, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        const parked = yield* act(id, 1, human.approve())
        const joined = yield* runChildren(parked, 2)
        expect(joined.decisions).toEqual([at(PER_KEY, "1-work"), at(GUESSABLE, "2.0-review")])

        const kid = slotAt(joined, 2).children[0]?.id
        if (kid === undefined) throw new Error("no child was spawned")
        yield* sentBackAndMerged(kid)
        const refiled = yield* current(id)
        expect(refiled.state).toEqual(joined.state)
        expect(refiled.decisions).toEqual(refiledOnParent)
      }),
    ))
})
