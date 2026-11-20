// A trak born to merge itself: the forge sweep merges its pull request once GitHub says it
// would go in, and sends the trak back to its own composer when it would not.
//
// The theme is *what the sweep does with each answer the forge can give*. The forge is a
// fake whose listing the case sets and whose merges it records; the drives are real.

import * as fs from "node:fs"
import * as path from "node:path"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import {
  afterReentry,
  composer,
  type FlowDeps,
  onGit,
  runFlow,
  runFlowWithAgentLog,
  step,
} from "../support/flow.js"
import { git, worktreeOf, writeWork } from "../support/git.js"
import { act, expectState, human, idle, logged, logTags } from "../support/scenario.js"
import { reply, type ScriptedStep } from "../support/scripted-agent.js"
import { type CheckScript, fail } from "../support/scripted-checks.js"
import { settableClock } from "../support/clock.js"
import { library } from "../support/library.js"
import { Conditions } from "../../src/app/conditions.js"
import type { Check } from "../../src/library/types/check.js"
import type { Library } from "../../src/library/types/library.js"
import { recordingAfterMerge } from "../support/host-git.js"
import { forgeSweep, sweepMemory } from "../../src/app/forge-sweep.js"
import { BranchName, ForgeAnswer, ForgeListing, ForgeMerge } from "../../src/vcs/index.js"
import { Forge } from "../../src/vcs/ports/forge.js"
import { forgeSaying, refusesOpen } from "../support/forge.js"
import type { PullRequestSummary } from "../../src/vcs/types/pull-request.js"
import { type Event, Events } from "../../src/workflow/domain/event.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import { GoalId, TrakId, waitingAt } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import { AUTO_MERGE_SENDS } from "../../src/workflow/domain/attention.js"
import { advance, type RuntimeError } from "../../src/workflow/runtime.js"

const id = TrakId.make("merging-itself")
const BRANCH = "trak/merging-itself"

/** An open pull request that merges cleanly with its checks passed, unless `over` says not. */
const open = (over: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number: 7,
  title: "Work",
  url: "https://forge/pr/7",
  state: "open",
  isDraft: false,
  merging: "clean",
  checks: "passed",
  head: "aaa111",
  ...over,
})

/**
 * A forge saying `pull` about the trak's branch until `say` changes it, `failed` as the
 * checks that failed on it, and keeping every branch it was asked to merge and the method
 * picked for it — which it merges, or refuses where `refusing` says so.
 */
const forgeSays = (first: PullRequestSummary, failed: readonly string[] = [], refusing = false) => {
  const merged: string[] = []
  const picks: (string | undefined)[] = []
  let pull = first
  const layer = Layer.succeed(Forge, {
    listing: () => Effect.succeed(ForgeListing.Listed({ entries: [{ branch: BRANCH, pull }] })),
    pullRequest: () =>
      Effect.succeed(
        ForgeAnswer.Found({
          pullRequest: {
            number: pull.number,
            title: pull.title,
            url: pull.url,
            state: pull.state,
            isDraft: pull.isDraft,
            merging: pull.merging,
            rollup: pull.checks,
            checks: failed.map((name) => ({ id: name, name, verdict: "failed" as const })),
            reviews: [],
            conversation: [],
            truncated: [],
            mergeMethods: [],
          },
        }),
      ),
    merge: (branch, pick) =>
      Effect.sync(() => {
        merged.push(branch)
        picks.push(pick)
        return refusing
          ? ForgeMerge.Refused({ why: "Pull request is not mergeable" })
          : ForgeMerge.Merged()
      }),
    openPullRequest: refusesOpen,
  })
  const say = (next: PullRequestSummary): void => {
    pull = next
  }
  return { layer, merged, picks, say }
}

const replayed = Effect.flatMap(Store, (store) =>
  Effect.map(store.events(id), (log) => replayHistory(id, log)),
)

const WORK = [composer("work"), step(1, "work", reply.artifact("done"))]

/** Take the trak to `Finished` with a commit on its branch, through both of its gates. */
const finish = (born: Event) =>
  Effect.gen(function* () {
    yield* advance(id, born)
    writeWork(worktreeOf(yield* replayed), "flag.ts", "export const json = true\n")
    yield* act(id, 0, human.approve())
    yield* act(id, 1, human.approve())
    expect((yield* replayed).state._tag).toBe("Finished")
  })

const mergingItself = (mode: "manual" | "auto" = "manual") =>
  Events.trakCreated("Add a --json flag", undefined, mode, true)

const promptOf = (r: { readonly prompt: string }): string => r.prompt
const isReentry = (e: Event): boolean => e._tag === "Reentered"

/** One tick of the sweep, and the drive it started run to rest. */
const tick = (memory: Parameters<typeof forgeSweep>[0]) =>
  Effect.gen(function* () {
    yield* forgeSweep(memory)
    yield* idle(id)
  })

/** Two ticks: a `passed` or `none` reading is recorded on the first and acted on by the second. */
const twoTicks = (memory: Parameters<typeof forgeSweep>[0]) =>
  Effect.zipRight(tick(memory), tick(memory))

/** Two ticks against `pull`: what the forge merged, and whether the trak's log moved. */
const tickAgainst = (pull: PullRequestSummary) => {
  const forge = forgeSays(pull)
  const moved = { log: false }
  return runFlow(
    WORK,
    () =>
      Effect.gen(function* () {
        yield* finish(mergingItself())
        const before = yield* logTags(id)
        yield* twoTicks(yield* sweepMemory)
        moved.log = (yield* logTags(id)).length !== before.length
      }),
    undefined,
    undefined,
    forge.layer,
  ).then(() => ({ merged: forge.merged, moved: moved.log }))
}

describe("a pull request that would go in", () => {
  // The merge writes nothing: the next tick hears it as any merge is heard.
  it("is merged on the forge when its checks passed", async () => {
    expect(await tickAgainst(open())).toEqual({ merged: [BRANCH], moved: false })
  })

  it.each([
    ["the forge merged it", false, ["main"]],
    ["the forge refused the merge", true, []],
  ])("brings the checkout up to its base only where %s", async (_, refusing, bases) => {
    const forge = forgeSays(open({ base: "main" }), [], refusing)
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finish(mergingItself())
          const memory = yield* sweepMemory
          yield* tick(memory)
          const ticked = yield* recordingAfterMerge(tick(memory))
          expect(forge.merged).toEqual([BRANCH])
          expect(ticked.bases).toEqual(bases)
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })

  it("is merged with no checks only once none has held on one head for two ticks", async () => {
    const forge = forgeSays(open({ checks: "none", head: "aaa111" }))
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finish(mergingItself())
          const memory = yield* sweepMemory
          // The first reading on a head may be CI that has not registered yet.
          yield* tick(memory)
          expect(forge.merged).toEqual([])
          // A push moves the head, and the reading starts over.
          forge.say(open({ checks: "none", head: "bbb222" }))
          yield* tick(memory)
          expect(forge.merged).toEqual([])
          yield* tick(memory)
          expect(forge.merged).toEqual([BRANCH])
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })

  // A workflow whose every job is skipped completes in a second or two, and GitHub counts
  // skipped as success: until the real CI registers its check runs, the rollup reads
  // `passed` on a head nothing has tested.
  it("is merged with its checks passed only once passed has held on one head for two ticks", async () => {
    const forge = forgeSays(open({ checks: "passed", head: "aaa111" }))
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finish(mergingItself())
          const memory = yield* sweepMemory
          // Every check skipped, before the real CI registers.
          yield* tick(memory)
          expect(forge.merged).toEqual([])
          forge.say(open({ checks: "running", head: "aaa111" }))
          yield* tick(memory)
          expect(forge.merged).toEqual([])
          forge.say(open({ checks: "passed", head: "aaa111" }))
          yield* tick(memory)
          expect(forge.merged).toEqual([])
          yield* tick(memory)
          expect(forge.merged).toEqual([BRANCH])
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })

  it.each([
    ["the forge has not worked out its mergeability", open({ merging: "unknown" })],
    ["its checks are running", open({ checks: "running" })],
    ["its checks have no verdict this build reads", open({ checks: "unknown" })],
    ["it is a draft", open({ isDraft: true })],
    [
      "the forge holds it and its checks are running",
      open({ merging: "blocked", checks: "running" }),
    ],
  ])("is not merged, and nothing is counted, while %s", async (_, pull) => {
    expect(await tickAgainst(pull)).toEqual({ merged: [], moved: false })
  })

  it("is left for its person on a trak born without auto-merge", async () => {
    const forge = forgeSays(open())
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finish(Events.trakCreated("Add a --json flag", undefined, "auto"))
          yield* tick(yield* sweepMemory)
          expect(forge.merged).toEqual([])
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })
})

describe("the method it merges by", () => {
  it("is merged with the method a person picked on the trak", async () => {
    const forge = forgeSays(open())
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finish(mergingItself())
          yield* advance(id, Events.mergeMethodPicked("rebase"))
          yield* twoTicks(yield* sweepMemory)
          expect(forge.picks).toEqual(["rebase"])
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })

  it("leaves the method to the forge where nobody picked one", async () => {
    const forge = forgeSays(open())
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finish(mergingItself())
          yield* twoTicks(yield* sweepMemory)
          expect(forge.picks).toEqual([undefined])
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })
})

describe("a pull request that would not", () => {
  it("sends a conflict back, and a manual trak runs the fix to rest with nobody at a gate", async () => {
    const forge = forgeSays(open({ merging: "conflicting", base: "main" }))
    await runFlowWithAgentLog(
      [...WORK, afterReentry("work"), step(3, "work", reply.artifact("merged main in"))],
      (_id, agentLog) =>
        Effect.gen(function* () {
          yield* finish(mergingItself("manual"))
          yield* tick(yield* sweepMemory)
          const asked = (yield* agentLog).requests.map(promptOf).join("\n")
          expect(asked).toContain("conflicting with its base branch")
          expect(asked).toContain("https://forge/pr/7")
          // The pull request's own base, as the remote has it — not the local branch.
          expect(asked).toContain("Plan the merge of `origin/main`, the pull request's base")
          expect((yield* (yield* Store).events(id)).find(isReentry)).toMatchObject({
            cause: { _tag: "Conflict" },
            base: "main",
          })
          const fixed = yield* replayed
          expect(fixed.state._tag).toBe("Finished")
          expect(fixed.autoMerge).toEqual({ sentBack: 1, stopped: undefined })
          expect(fixed.resolving).toBe(false)
          // The plan gate and the step's gate were both taken, on the conflict's account.
          expect(fixed.marks.get(2)?._tag).toBe("Resolving")
          expect(fixed.marks.get(3)?._tag).toBe("Resolving")
          const tags = yield* logTags(id)
          expect(tags.slice(tags.lastIndexOf("Reentered"))).not.toContain("HumanActed")
          expect(forge.merged).toEqual([])
        }),
      undefined,
      undefined,
      undefined,
      forge.layer,
    )
  })

  it("sends failing checks back by name, and the fix follows the trak's mode", async () => {
    const forge = forgeSays(open({ checks: "failed", base: "main" }), ["test", "lint"])
    await runFlow(
      [...WORK, afterReentry("work")],
      () =>
        Effect.gen(function* () {
          yield* finish(mergingItself("manual"))
          yield* tick(yield* sweepMemory)
          const sent = (yield* (yield* Store).events(id)).find(isReentry)
          expect(sent).toMatchObject({
            what: "https://forge/pr/7",
            cause: { _tag: "Checks", failed: ["test", "lint"] },
          })
          // Red checks are not a refusal to merge, so nothing names a base to merge.
          expect(sent).not.toHaveProperty("base")
          const parked = yield* replayed
          // `manual` stands at the plan gate of a fix for red checks.
          expect(parked.state._tag).toBe("AwaitingProposal")
          expect(parked.resolving).toBe(false)
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })
})

describe("a person sending back a refusal on a trak that merges itself", () => {
  it("counts no send and takes no gate", async () => {
    await runFlow([...WORK, afterReentry("work")], () =>
      Effect.gen(function* () {
        yield* finish(mergingItself("manual"))
        yield* advance(id, Events.reentered("Pull request #7 cannot merge.", undefined, "main"))
        const sent = yield* replayed
        expect(sent.autoMerge).toEqual({ sentBack: 0, stopped: undefined })
        expect(sent.resolving).toBe(false)
        expect(sent.state._tag).toBe("AwaitingProposal")
      }),
    )
  })
})

describe("a merge the forge holds", () => {
  it("does not stop on a blocked head with no checks until none has held on it for two ticks", async () => {
    const forge = forgeSays(open({ merging: "blocked", checks: "none", head: "aaa111" }))
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finish(mergingItself())
          const memory = yield* sweepMemory
          // Required CI that has not registered on a fresh head reads `none` and `blocked`.
          yield* tick(memory)
          expect((yield* replayed).autoMerge?.stopped).toBeUndefined()
          // A push moves the head, and the reading starts over.
          forge.say(open({ merging: "blocked", checks: "none", head: "bbb222" }))
          yield* tick(memory)
          expect((yield* replayed).autoMerge?.stopped).toBeUndefined()
          yield* tick(memory)
          expect((yield* replayed).autoMerge?.stopped).toEqual({ _tag: "Blocked" })
          expect(forge.merged).toEqual([])
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })

  it("stops a pull request blocked with its checks green, and merges nothing", async () => {
    const forge = forgeSays(open({ merging: "blocked" }))
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finish(mergingItself())
          const memory = yield* sweepMemory
          yield* twoTicks(memory)
          const stopped = yield* replayed
          expect(stopped.state._tag).toBe("Finished")
          expect(stopped.autoMerge).toEqual({ sentBack: 0, stopped: { _tag: "Blocked" } })
          expect(forge.merged).toEqual([])
          // Stopped is stopped: the next tick asks nothing of it.
          const before = yield* logTags(id)
          yield* tick(memory)
          expect(yield* logTags(id)).toEqual(before)
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })

  it("stops after three refusals in a row, with the forge's reason, and not after one", async () => {
    const forge = forgeSays(open(), [], true)
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finish(mergingItself())
          const memory = yield* sweepMemory
          yield* twoTicks(memory)
          yield* tick(memory)
          expect((yield* replayed).autoMerge?.stopped).toBeUndefined()
          yield* tick(memory)
          expect((yield* replayed).autoMerge?.stopped).toEqual({
            _tag: "Refused",
            why: "Pull request is not mergeable",
          })
          yield* tick(memory)
          expect(forge.merged).toHaveLength(3)
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })
})

describe("a person's switch", () => {
  it("merges a trak born without auto-merge once it was turned on while it ran", async () => {
    const forge = forgeSays(open())
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* advance(id, Events.trakCreated("Add a --json flag", undefined, "manual"))
          yield* advance(id, Events.autoMergeChanged(true))
          writeWork(worktreeOf(yield* replayed), "flag.ts", "export const json = true\n")
          yield* act(id, 0, human.approve())
          yield* act(id, 1, human.approve())
          expect((yield* replayed).state._tag).toBe("Finished")
          yield* twoTicks(yield* sweepMemory)
          expect(forge.merged).toEqual([BRANCH])
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })

  it("starts a stopped trak afresh at Finished, and the next tick merges it", async () => {
    const forge = forgeSays(open({ merging: "blocked" }))
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finish(mergingItself())
          const memory = yield* sweepMemory
          yield* twoTicks(memory)
          expect((yield* replayed).autoMerge?.stopped).toEqual({ _tag: "Blocked" })
          // The review is in; the person turns it back on.
          forge.say(open())
          yield* advance(id, Events.autoMergeChanged(true))
          expect((yield* replayed).autoMerge).toEqual({ sentBack: 0, stopped: undefined })
          yield* tick(memory)
          expect(forge.merged).toEqual([BRANCH])
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })

  it("keeps the sweep from merging once turned off at Finished", async () => {
    const forge = forgeSays(open())
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finish(mergingItself())
          yield* advance(id, Events.autoMergeChanged(false))
          yield* tick(yield* sweepMemory)
          expect(forge.merged).toEqual([])
          expect((yield* replayed).state._tag).toBe("Finished")
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })
})

/** What the engine's forge answers where there is no `origin`: nothing is asked of `gh`. */
const noOrigin = forgeSaying(ForgeAnswer.NoOrigin(), ForgeListing.NoOrigin())

/** A commit on the branch the project's checkout is on, made with git as a person would. */
const commitOnHost = (repoDir: string, name: string, content: string) =>
  Effect.sync(() => {
    fs.writeFileSync(path.join(repoDir, name), content)
    git(repoDir, "add", "--", name)
    git(repoDir, "commit", "--no-verify", "-q", "-m", `add ${name}`)
  })

describe("a project with no origin", () => {
  it("merges a finished trak into the checkout's branch with no press", async () => {
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finish(mergingItself())
          yield* tick(yield* sweepMemory)
          expect(yield* logTags(id)).toContain("Merged")
          expect((yield* replayed).state._tag).toBe("Merged")
        }),
      undefined,
      undefined,
      noOrigin,
    )
  })

  it("leaves a trak born without auto-merge for its person", async () => {
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finish(Events.trakCreated("Add a --json flag", undefined, "auto"))
          yield* tick(yield* sweepMemory)
          expect((yield* replayed).state._tag).toBe("Finished")
        }),
      undefined,
      undefined,
      noOrigin,
    )
  })

  it("waits while the checkout has uncommitted files, and merges on a later tick", async () => {
    await runFlowWithAgentLog(
      WORK,
      (_id, _agentLog, _checksLog, repoDir) =>
        Effect.gen(function* () {
          yield* finish(mergingItself())
          const memory = yield* sweepMemory
          const notes = path.join(repoDir, "notes.txt")
          fs.writeFileSync(notes, "half a thought\n")
          const before = yield* logTags(id)
          yield* tick(memory)
          expect(yield* logTags(id)).toEqual(before)
          fs.rmSync(notes)
          yield* tick(memory)
          expect((yield* replayed).state._tag).toBe("Merged")
        }),
      undefined,
      undefined,
      undefined,
      noOrigin,
    )
  })
})

describe("a local merge that would conflict, with no origin", () => {
  it("sends a conflict back naming the checkout's branch, with no pull request to push", async () => {
    await onGit.runFlowWithAgentLog(
      [...WORK, afterReentry("work"), step(3, "work", reply.artifact("merged main in"))],
      (_id, agentLog, _checksLog, repoDir) =>
        Effect.gen(function* () {
          yield* finish(mergingItself())
          yield* commitOnHost(repoDir, "flag.ts", "export const json = false\n")
          yield* tick(yield* sweepMemory)
          const sent = (yield* (yield* Store).events(id)).find(isReentry)
          expect(sent).toMatchObject({ cause: { _tag: "Conflict", into: "main" } })
          expect(sent).not.toHaveProperty("base")
          const asked = (yield* agentLog).requests.map(promptOf).join("\n")
          expect(asked).toContain("Plan the merge of `main` into this branch")
          expect(asked).toContain("Do not push: there is no remote.")
          expect(asked).not.toContain("origin/")
          const fixed = yield* replayed
          expect(fixed.state._tag).toBe("Finished")
          expect(fixed.autoMerge).toEqual({ sentBack: 1, stopped: undefined })
          expect(fixed.marks.get(2)?._tag).toBe("Resolving")
        }),
      undefined,
      undefined,
      undefined,
      noOrigin,
    )
  })

  it("stops once the sends are spent on a conflict that keeps coming back", async () => {
    // Each send is a re-entry the scripted composer answers with one step that leaves the
    // conflict where it is.
    const resends = Array.from({ length: AUTO_MERGE_SENDS }, (_, i) => [
      afterReentry("work"),
      step(3 + 2 * i, "work", reply.artifact("tried")),
    ]).flat()
    await onGit.runFlowWithAgentLog(
      [...WORK, ...resends],
      (_id, _agentLog, _checksLog, repoDir) =>
        Effect.gen(function* () {
          yield* finish(mergingItself())
          yield* commitOnHost(repoDir, "flag.ts", "export const json = false\n")
          const memory = yield* sweepMemory
          for (let i = 0; i < AUTO_MERGE_SENDS; i++) yield* tick(memory)
          expect((yield* replayed).autoMerge).toEqual({
            sentBack: AUTO_MERGE_SENDS,
            stopped: undefined,
          })
          yield* tick(memory)
          const stopped = yield* replayed
          expect(stopped.autoMerge?.stopped).toEqual({ _tag: "Conflict", into: "main" })
          expect(stopped.state._tag).toBe("Finished")
        }),
      undefined,
      undefined,
      undefined,
      noOrigin,
    )
  })
})

describe("a goal's trak on its goal branch, with no origin", () => {
  const GOAL_BRANCH = BranchName.make("goal/ship")
  const goalRef = `refs/remotes/origin/${GOAL_BRANCH}`

  /**
   * The goal branch as the merge reads it, with no remote named `origin` behind it. It
   * moves to a commit whose `flag.ts` disagrees with the trak's, and the host checkout is
   * left clean of that file and detached — so only the goal branch conflicts, and a host
   * that names no branch has nothing to hold the merge up with.
   */
  const conflictOnGoalBranchOnly = (repoDir: string) => {
    fs.writeFileSync(path.join(repoDir, "flag.ts"), "export const json = false\n")
    git(repoDir, "add", "flag.ts")
    git(repoDir, "commit", "--quiet", "-m", "the goal branch moved")
    git(repoDir, "update-ref", goalRef, "HEAD")
    git(repoDir, "reset", "--quiet", "--hard", "HEAD~1")
    git(repoDir, "checkout", "--quiet", "--detach")
  }

  it("sends a conflict back naming the goal branch, whatever the host stands on", async () => {
    await onGit.runFlowWithAgentLog(
      [...WORK, afterReentry("work"), step(3, "work", reply.artifact("merged the goal in"))],
      (_id, _agentLog, _checksLog, repoDir) =>
        Effect.gen(function* () {
          git(repoDir, "update-ref", goalRef, "HEAD")
          yield* finish(
            Events.trakForGoal(
              "Add a --json flag",
              "manual",
              GoalId.make("ship"),
              BranchName.make(`origin/${GOAL_BRANCH}`),
              true,
              GOAL_BRANCH,
            ),
          )
          conflictOnGoalBranchOnly(repoDir)
          yield* tick(yield* sweepMemory)
          const sent = (yield* (yield* Store).events(id)).find(isReentry)
          expect(sent).toMatchObject({ cause: { _tag: "Conflict", into: GOAL_BRANCH } })
          expect((yield* replayed).autoMerge?.sentBack).toBe(1)
        }),
      undefined,
      undefined,
      undefined,
      noOrigin,
    )
  })
})

/** The project's `deploy.sh` and its one condition script, as the loader hands them over. */
const script = (name: string, file: string): Check => ({
  name,
  description: `Whether ${name} is done.`,
  timeoutSeconds: 30,
  askedEverySeconds: 60,
  exclusive: false,
  cache: true,
  ignoresLinguistGenerated: false,
  units: undefined,
  cacheAcross: "platform",
  path: `/repo/.orkestra/${file}`,
})

const REVIEWED = "claude-review"

/** A fleet whose read-only `review` agent declares `conditions`, with a deploy script. */
const reviewWaitingOn = (...conditions: readonly string[]): Library => {
  const lib = library({
    deploy: script("deploy", "deploy.sh"),
    checks: new Map([[REVIEWED, script(REVIEWED, `checks/${REVIEWED}.sh`)]]),
    root: "/repo",
  })
  const review = lib.agents.get("review")
  if (review === undefined) throw new Error("the fixture fleet lost its `review` agent")
  return { ...lib, agents: new Map(lib.agents).set("review", { ...review, conditions }) }
}

/** The work, then a `review` step holding on `wait` — what the trak rests on once it finishes. */
const waitingPlan = (wait: Pick<ScriptedStep, "wait_for" | "wait_until"> = {}) => [
  composer("work", { agent: "review", instruction: "Check production.", ...wait }),
  step(1, "work", reply.artifact("done")),
  step(2, "review", reply.artifact("checked production")),
]

const notYet: CheckScript = { [REVIEWED]: [fail("the review is still running", 1)] }

/** Each wait a trak can rest on, and what the merge has to do with it. */
const WAITS = {
  merged: { wait: { wait_for: "merged" }, conditions: [] },
  deployed: { wait: { wait_for: "deployed" }, conditions: [] },
  "a time on an entry that waits for the merge": {
    wait: { wait_until: "PT8H", wait_for: "merged" },
    conditions: [],
  },
  "a project's script": { wait: {}, conditions: [REVIEWED] },
  "a time on an entry with no `wait_for`": { wait: { wait_until: "PT8H" }, conditions: [] },
} satisfies Record<
  string,
  {
    readonly wait: Pick<ScriptedStep, "wait_for" | "wait_until">
    readonly conditions: readonly string[]
  }
>

type WaitName = keyof typeof WAITS

/** Run `body` over a trak born merging itself and resting on `name`, on `forge`. */
const restingOn = (
  name: WaitName,
  forge: Layer.Layer<Forge>,
  body: Effect.Effect<void, RuntimeError, FlowDeps>,
) => {
  const { wait, conditions } = WAITS[name]
  return runFlowWithAgentLog(
    waitingPlan(wait),
    () =>
      Effect.gen(function* () {
        yield* finish(mergingItself())
        expect(waitingAt(yield* replayed)?.step).toBe(2)
        yield* body
      }),
    reviewWaitingOn(...conditions),
    notYet,
    undefined,
    forge,
  )
}

describe("a trak resting on a wait the merge answers", () => {
  it.each<WaitName>(["merged", "deployed", "a time on an entry that waits for the merge"])(
    "is merged on the forge while it waits on %s",
    async (name) => {
      const forge = forgeSays(open())
      await restingOn(
        name,
        forge.layer,
        Effect.gen(function* () {
          yield* twoTicks(yield* sweepMemory)
          expect(forge.merged).toEqual([BRANCH])
          expectState(yield* replayed, "Finished")
        }),
      )
    },
  )

  it("runs the waiting step once the forge says the merge went in", async () => {
    const forge = forgeSays(open())
    await restingOn(
      "merged",
      forge.layer,
      Effect.gen(function* () {
        yield* twoTicks(yield* sweepMemory)
        forge.say(open({ state: "merged", mergeCommit: "ccc333" }))
        const clock = settableClock(Date.now())
        clock.advance(60_000)
        yield* Effect.flatMap(Conditions, (c) => c.sweep).pipe(Effect.withClock(clock.clock))
        yield* logged(id, (tags) => tags.at(-1) === "ChecksPassed")
        yield* idle(id)
        const running = yield* replayed
        expectState(running, "AwaitingHuman", 2)
        expect(running.landed).toStrictEqual({ sha: "ccc333" })
      }),
    )
  })

  it.each<WaitName>(["merged", "deployed"])(
    "is merged locally while it waits on %s, and the waiting step runs",
    async (name) => {
      await restingOn(
        name,
        noOrigin,
        Effect.gen(function* () {
          yield* tick(yield* sweepMemory)
          yield* logged(id, (tags) => tags.at(-1) === "ChecksPassed")
          yield* idle(id)
          const running = yield* replayed
          expectState(running, "AwaitingHuman", 2)
          expect(yield* logTags(id)).toContain("WorkMerged")
          expect(running.worktree).toBeDefined()
        }),
      )
    },
  )
})

describe("a trak resting on a wait that holds the merge", () => {
  it.each<WaitName>(["a project's script", "a time on an entry with no `wait_for`"])(
    "is not merged on the forge while it waits on %s",
    async (name) => {
      const forge = forgeSays(open())
      await restingOn(
        name,
        forge.layer,
        Effect.gen(function* () {
          const before = yield* logTags(id)
          yield* twoTicks(yield* sweepMemory)
          expect(forge.merged).toEqual([])
          expect(yield* logTags(id)).toEqual(before)
        }),
      )
    },
  )

  // A local merge closes a trak resting on a time wait, dropping the step; on GitHub the
  // condition sweep asks the time and then `merged`, so only there does the merge go ahead.
  it.each<WaitName>([
    "a project's script",
    "a time on an entry with no `wait_for`",
    "a time on an entry that waits for the merge",
  ])("is not merged locally while it waits on %s", async (name) => {
    await restingOn(
      name,
      noOrigin,
      Effect.gen(function* () {
        const before = yield* logTags(id)
        yield* tick(yield* sweepMemory)
        expect(yield* logTags(id)).toEqual(before)
        expectState(yield* replayed, "Finished")
      }),
    )
  })
})
