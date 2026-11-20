// A merge that does not go in, end to end: the trak plans the resolution instead
// of stopping at it.
//
// The distinction every case here turns on is `Vcs`'s own — unmerged paths are
// git's *answer*, and a refusal to start is git *declining to answer*. Only the
// first is about the work, so only the first reaches the composer; the second
// still ends the trak with a sentence naming what a person can go and fix.
//
// Real git throughout, for the reason the worktree theme uses it: what has to be
// true here is that a second press actually merges, and only the repository can
// say so. Each case is a full flow against a real repository, so there are as few
// of them as the claims allow.

import * as fs from "node:fs"
import * as path from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { afterConflict, child, childStep, composer, onGit, spawn, step } from "../support/flow.js"
import {
  addOrigin,
  commitInWorktree,
  commitOnHost,
  git,
  resolveInward,
  worktreeOf,
  writeWork,
} from "../support/git.js"
import {
  act,
  approveAll,
  countTag,
  create,
  createAndStart,
  expectAwaitingProposal,
  expectReconsult,
  expectState,
  human,
  logTags,
} from "../support/scenario.js"
import { library } from "../support/library.js"
import { reply } from "../support/scripted-agent.js"
import { BranchName } from "../../src/vcs/index.js"
import { Events } from "../../src/workflow/domain/event.js"
import { stepName } from "../../src/workflow/domain/outputs/proposal.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import { GoalId, type Trak, type TrakId } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import { advance, driveChild } from "../../src/workflow/runtime.js"

// The subject here is git, so every flow runs on it.
const { runFlow, runFlowWithAgentLog } = onGit

/**
 * The fleet, plus the role a resolution is planned for.
 *
 * Local to this theme rather than in the shared fixture, because the composer is
 * shown every agent's name and description — a fifth in `scenario.ts` would
 * change what every other flow's composer was looking at.
 */
const withResolve = (): ReturnType<typeof library> => {
  const lib = library()
  return {
    ...lib,
    agents: new Map(lib.agents).set("resolve", {
      name: "resolve",
      description: "Settles what two branches disagree about.",
      brief: "Merge the destination inward and settle it.",
      model: "opus",
      permission: "write",
      sections: [
        { title: "Summary", description: "What disagreed.", when: undefined, figure: undefined },
      ],
      checks: [],
      effects: [],
      conditions: [],
      processes: [],
      skills: [],
      // `false` here as in the real fleet: a resolve with no merge behind it has
      // nothing to read, which is the whole of what `start:` says.
      start: false,
      place: "sandbox" as const,
      icon: undefined,
      effort: undefined,
    }),
  }
}

/** The plan as agent names, in order — the record of how it grew. */
const agentsOf = (trak: Trak): readonly string[] => (trak.plan?.steps ?? []).map(stepName)

/** The trak as it stands now, without acting on it. */
const current = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    return replayHistory(id, yield* store.events(id))
  })

/**
 * One trak, one step, then a merge — and a plan that grows a resolution when it
 * does not go in. `resolve` is at index 3, because the ask the conflict wrote is
 * an entry of its own at 2.
 */
const conflictThenResolve = [
  composer("work"),
  step(1, "work", reply.artifact("the flag")),
  afterConflict("resolve"),
  step(3, "resolve", reply.artifact("took both sides")),
]

/** A trak whose one step wrote a file the destination has since changed too. */
const upToTheConflict = (id: TrakId, repoDir: string) =>
  Effect.gen(function* () {
    const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
    writeWork(worktree, "flag.ts", "the trak's answer\n")
    yield* act(id, 0, human.approve())
    expectState(yield* act(id, 1, human.approve()), "Finished")
    // The destination moves under it, which is what 34 commits of drift is, one
    // commit at a time.
    commitOnHost(repoDir, "flag.ts", "the host's answer\n")
    return worktree
  })

describe("a merge that conflicts plans its own resolution", () => {
  it("routes to the composer rather than stopping, and tells it what disagreed", async () => {
    await runFlowWithAgentLog(
      conflictThenResolve,
      (id, agentLog, _checksLog, repoDir) =>
        Effect.gen(function* () {
          yield* upToTheConflict(id, repoDir)

          const asked = yield* advance(id, Events.merged())

          // Not `Failed`: the work disagreed, and disagreeing work is what a
          // pipeline is for. What is on the table is a plan nobody has read yet.
          expectAwaitingProposal(asked)
          expectReconsult(asked, "Conflicted")
          expect(agentsOf(asked)).toEqual(["compose", "work", "compose", "resolve"])
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
            "HumanActed",
            "WorkCommitted", // step 0's own work kept
            "EffectsRan", // and its effects run, of which this agent declares none
            "WorkCommitted", // Integrating's catch-all
            "Merged",
            // Its own event, and the whole of the change: this used to be a
            // `WorktreeFailed` carrying a sentence.
            "Conflicted",
            "ComposerReturned",
          ])

          // The list, not a sentence: a composer cannot recover a file list out of
          // prose, and the paths are what let it size the work — or decline.
          const prompt = (yield* agentLog).requests.at(-1)?.prompt ?? ""
          expect(prompt).toContain("The merge did not go in")
          expect(prompt).toContain("`flag.ts`")
          expect(prompt).toContain("`main`")
        }),
      withResolve(),
    )
  })

  it("comes back to rest holding the merge, and goes in on the second press", async () => {
    await runFlow(
      conflictThenResolve,
      (id, _agentLog, _checksLog, repoDir) =>
        Effect.gen(function* () {
          const worktree = yield* upToTheConflict(id, repoDir)
          yield* advance(id, Events.merged())

          // Approving the plan runs the resolution, which is where the agent's own
          // git would happen — `resolveInward` is what stands in for it.
          yield* act(id, 0, human.approve())
          resolveInward(worktree, "main", { "flag.ts": "both answers\n" })
          const settled = yield* act(id, 3, human.approve())

          // Back at `Finished` with the press on offer, and nothing merged on the
          // person's behalf: the destination is not ours and it can have moved
          // again while the resolution ran.
          expectState(settled, "Finished")
          expect(yield* countTag(id, "WorkMerged")).toBe(0)
          expect(fs.existsSync(worktree.path)).toBe(true)

          // And now it goes in, which is the whole of what the resolution bought.
          expectState(yield* advance(id, Events.merged()), "Merged")
          expect(fs.readFileSync(path.join(repoDir, "flag.ts"), "utf8")).toBe("both answers\n")
          expect(git(repoDir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main")
        }),
      withResolve(),
    )
  })

  it("still fails a merge git refused to start, rather than composing against a fault", async () => {
    await runFlow(
      conflictThenResolve,
      (id, _agentLog, _checksLog, repoDir) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* create(id, "Add a --json flag"))
          writeWork(worktree, "flag.ts", "the trak's answer\n")
          yield* act(id, 0, human.approve())
          yield* act(id, 1, human.approve())

          // Uncommitted work in the host on the file the merge would touch: git
          // refuses to start, so there are no unmerged paths to read and nothing
          // about the *work* has been established. A composer handed this would
          // plan against somebody's dirty checkout.
          fs.writeFileSync(path.join(repoDir, "flag.ts"), "half-done\n")

          const stopped = yield* advance(id, Events.merged())

          expectState(stopped, "Failed")
          if (stopped.state._tag === "Failed") expect(stopped.state.kind).toBe("merge")
          expect(yield* countTag(id, "Conflicted")).toBe(0)
          // And the checkout is kept, which is what a restart re-runs the merge from.
          expect(fs.existsSync(worktree.path)).toBe(true)
        }),
      withResolve(),
    )
  })
})

describe("a child that conflicts with its parent", () => {
  const pieces = spawn(child("work", "the handler"))

  it("takes the same route, because the destination is the only thing that differs", async () => {
    await runFlow(
      [
        composer("work", pieces, "plan"),
        step(1, "work", reply.artifact("the change")),
        childStep("work", "the handler", reply.artifact("the piece")),
        afterConflict("resolve"),
      ],
      (id) =>
        Effect.gen(function* () {
          const parent = worktreeOf(yield* createAndStart(id, "Rate-limit the public API"))
          const parked = yield* act(id, 1, human.approve())

          const kid = yield* driveChild(parked, 2, 0)
          writeWork(worktreeOf(kid), "handler.ts", "the child's answer\n")
          yield* approveAll(kid.id, kid)

          // The parent's own branch moves after the child branched off it, which
          // is the same drift the host case has one level up.
          writeWork(parent, "handler.ts", "the parent's answer\n")
          commitInWorktree(parent, "the parent got there first")

          expectAwaitingProposal(yield* advance(kid.id, Events.merged()))
          // The parent's branch, not the host's — `mergeDestination` is shared, and
          // this is what says nobody special-cased the child.
          expect((yield* current(kid.id)).reconsult?.why).toEqual({
            _tag: "Conflicted",
            paths: ["handler.ts"],
            into: parent.branch,
          })
        }),
      withResolve(),
    )
  })
})

describe("a goal's trak that conflicts with its goal branch", () => {
  it("names `origin/<goal branch>`, which the resolving step can merge from its own checkout", async () => {
    await runFlow(
      conflictThenResolve,
      (id, _agentLog, _checksLog, repoDir) =>
        Effect.gen(function* () {
          const origin = addOrigin(repoDir)
          git(repoDir, "push", "--quiet", "origin", "main:refs/heads/goal/ship")
          git(repoDir, "fetch", "--quiet", "origin")
          const born = Events.trakForGoal(
            "Add a --json flag",
            "manual",
            GoalId.make("ship-1"),
            BranchName.make("origin/goal/ship"),
            false,
            BranchName.make("goal/ship"),
          )
          const worktree = worktreeOf(yield* advance(id, born))
          writeWork(worktree, "flag.ts", "the trak's answer\n")
          yield* act(id, 0, human.approve())
          expectState(yield* act(id, 1, human.approve()), "Finished")

          // The goal branch moves on origin, the way a sibling's pull request would.
          git(origin.elsewhere, "fetch", "--quiet", "origin")
          git(origin.elsewhere, "checkout", "--quiet", "-b", "goal/ship", "origin/goal/ship")
          commitOnHost(origin.elsewhere, "flag.ts", "the sibling's answer\n")
          git(origin.elsewhere, "push", "--quiet", "origin", "goal/ship")

          expectAwaitingProposal(yield* advance(id, Events.merged()))
          // The bare `goal/ship` names no branch here: the goal checkout is detached.
          expect((yield* current(id)).reconsult?.why).toEqual({
            _tag: "Conflicted",
            paths: ["flag.ts"],
            into: "origin/goal/ship",
          })

          // The name the conflict recorded is one the trak's checkout can merge.
          yield* act(id, 0, human.approve())
          resolveInward(worktree, "origin/goal/ship", { "flag.ts": "both answers\n" })
          expectState(yield* act(id, 3, human.approve()), "Finished")
          expectState(yield* advance(id, Events.merged()), "Merged")
          expect(git(origin.origin, "show", "goal/ship:flag.ts")).toBe("both answers")
          origin.remove()
        }),
      withResolve(),
    )
  })
})
