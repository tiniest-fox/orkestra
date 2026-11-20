// A composer that finds work belonging on a base this trak does not have — a fix to
// code its branch already merged, a piece wanting its own pull request — hands it off:
// one or more descriptions on either of its answers, each a trak of its own cut from
// the repository's default branch, which never comes back.
//
// The theme is the gate and the birth. `manual` and `smart` stop at the plan gate for
// it and `auto` does not; approving names the traks on this trak's own log, and the
// daemon opens each once from what the log says. What the new trak is born with —
// the hand-off's own words, the default branch, the mode, and which trak sent it —
// is asserted here by calling `driveHandOff` by hand, as `spawn.test.ts` calls
// `driveChild`; that the daemon forks one per named trak is asserted through `Drives`.

import { seedLog } from "../support/seed.js"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { toWeb } from "@effect/platform/HttpServerResponse"
import { TrakDetailDto } from "@orkestra/shared/dto/trak"
import type { Library } from "../../src/library/types/library.js"
import { forkRefFor } from "../../src/vcs/logic/paths.js"
import { Drives } from "../../src/app/drive.js"
import { Events } from "../../src/workflow/domain/event.js"
import { GoalEvents } from "../../src/workflow/domain/goal.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import { GoalId, Mark, slotAt, type TrakId, UserId } from "../../src/workflow/domain/trak.js"
import { GoalStore } from "../../src/workflow/ports/goal-store.js"
import { Store } from "../../src/workflow/ports/store.js"
import { advance, driveHandOff } from "../../src/workflow/runtime.js"
import {
  composer,
  composerFinishes,
  composerHandingOff,
  composerOf,
  onGit,
  step,
} from "../support/flow.js"
import { git, worktreeOf } from "../support/git.js"
import { mount } from "../support/http.js"
import { trakRoutes } from "../../src/app/routes/trak.js"
import {
  act,
  create,
  createAndStart,
  expectAwaiting,
  expectAwaitingProposal,
  expectState,
  human,
  idle,
  logged,
  logTags,
  workWaitingOn,
} from "../support/scenario.js"
import { onPrompt, reply } from "../support/scripted-agent.js"

const { get } = mount(trakRoutes)

// The subject here is git, so every flow runs on it.
const { runFlow, runFlowWithAgentLog } = onGit

/** What the composer hands off, in its own words: what the work is and why it is elsewhere. */
const OFF = "Fix the deploy hook, which fires against the wrong host once this branch is live."

/**
 * What a clone records and a `git init` does not: which branch `origin` points at.
 * Written directly rather than through a second repository, because what the engine
 * reads is the symbolic ref and never the network.
 */
const withDefaultBranch = (repoDir: string): void => {
  git(repoDir, "update-ref", "refs/remotes/origin/main", "main")
  git(repoDir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
}

/** The traks this trak's log says it handed off, at which compose entry. */
const handedOff = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    const events = yield* store.events(id)
    return events.flatMap((e) =>
      e._tag === "HandedOff" ? [{ step: e.step, base: e.base, ids: e.ids }] : [],
    )
  })

/** The trak's detail, through the published contract — what the card at the gate reads. */
const detailOf = (id: TrakId) =>
  Effect.gen(function* () {
    const response = yield* get(`/${id}`)
    const body: unknown = yield* Effect.promise(
      async (): Promise<unknown> => JSON.parse(await toWeb(response).text()),
    )
    return Schema.decodeUnknownSync(TrakDetailDto)(body)
  })

/** The trak as it stands now, without acting on it. */
const current = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    return replayHistory(id, yield* store.events(id))
  })

/**
 * A fleet whose `work` agent waits on the branch merging — and reads, as an agent that
 * runs once the branch is in has to: the loader refuses a writer here, and the runtime
 * refuses one on a landed trak.
 */
const landing = (): Library => {
  const lib = workWaitingOn(["merged"])
  const work = lib.agents.get("work")
  if (work === undefined) throw new Error("the fixture fleet lost its `work` agent")
  return { ...lib, agents: new Map(lib.agents).set("work", { ...work, permission: "read-only" }) }
}

/** The event a forked drive is born from, hoisted: one callback deeper is one too many. */
const bornAuto = (): ReturnType<typeof Events.trakCreated> =>
  Events.trakCreated("Check the deploy once this is live", undefined, "auto")

/** Did the log reach the composer's turn? Hoisted for the same reason. */
const hasComposed = (tags: readonly string[]): boolean => tags.includes("ComposerReturned")

/** The composer asked again after a step raised work, answering that it belongs elsewhere. */
const handsOffWhatWasRaised = onPrompt(
  /did its work and filed its artifact/,
  reply.finished("The branch is in, and what the check found cannot be built on it.", [OFF]),
  "compose hands off",
)

describe("a trak whose branch has merged", () => {
  it("can name a fix, and approving opens a trak on the default branch that never comes back", async () => {
    await runFlowWithAgentLog(
      [
        composer("plan", "work"),
        step(1, "plan", reply.artifact("the plan")),
        // The held step runs once the branch is in, reads production, and raises what
        // it found — which is what asks the composer again on a trak nothing may write to.
        step(2, "work", reply.raising("checked production", ["the deploy hook is wrong"])),
        handsOffWhatWasRaised,
        composerOf(OFF, "work"),
      ],
      (id, _agent, _checks, repoDir) =>
        Effect.gen(function* () {
          withDefaultBranch(repoDir)
          const parked = yield* createAndStart(id, "Check the deploy once this is live")
          expectAwaiting(parked, "approval")
          const rested = yield* act(id, 1, human.approve())
          expectState(rested, "Finished")

          // The press passes the wait: the branch goes into `main`, the trak lands, and
          // the held step runs read-only in a checkout nothing may build on.
          const raised = yield* advance(id, Events.merged())
          expectAwaiting(raised, "approval")
          expect(raised.landed).toBeDefined()
          const asked = yield* act(id, 2, human.approve())
          // The composer's answer is a finish carrying a hand-off, and on `manual` that
          // is the plan gate — where a plain finish would have rested at once.
          expectAwaitingProposal(asked)
          expect(slotAt(asked, 3).handOffs).toEqual([OFF])

          const done = yield* act(id, 0, human.approve())
          expectState(done, "Finished")
          expect((yield* logTags(id)).slice(-3)).toEqual([
            "HumanActed",
            "HandedOff",
            "WorkCommitted",
          ])
          const [named] = yield* handedOff(id)
          const child = named?.ids?.[0]
          if (named === undefined || child === undefined) {
            return yield* Effect.die("the approval named no trak")
          }
          expect(named).toEqual({ step: 3, base: "main", ids: [child] })
          // Nothing waits on it: this trak holds no child at that position, and it is at
          // rest with nobody owing it an event.
          expect(slotAt(done, 3).children).toEqual([])

          // Opened by hand here, exactly as the daemon opens it: born with the hand-off's
          // own words, cut from `main` as it now stands — the merge included — naming this
          // trak, on this trak's mode and its owner, and holding nothing else.
          const opened = yield* driveHandOff({ ...done, owner: UserId.make("gh:1234") }, 3, 0)
          expect(opened.id).toBe(child)
          expect(opened.owner).toBe("gh:1234")
          expect(opened.description).toBe(OFF)
          expect(opened.handedOffFrom).toBe(id)
          expect(opened.parent).toBeUndefined()
          expect(opened.base).toBe("main")
          expect(opened.mode).toBe("manual")
          expect(opened.inherited).toEqual([])
          expect(opened.decisions).toEqual([])
          // Its own composer ran, on the description alone, and its plan waits as any
          // trak a person opened would.
          expectAwaitingProposal(opened)
          const worktree = worktreeOf(opened)
          expect(worktree.base).toBe(git(repoDir, "rev-parse", "main"))
          expect(git(repoDir, "symbolic-ref", forkRefFor(worktree.branch))).toBe("refs/heads/main")

          // Opened once. Driven again it is handed back as it stands, and its log is
          // the same log.
          const before = yield* logTags(child)
          const again = yield* driveHandOff(done, 3, 0)
          expect(again.state).toEqual(opened.state)
          expect(yield* logTags(child)).toEqual(before)
        }),
      landing(),
    )
  })
})

describe("the gate a hand-off takes", () => {
  it("stops a plan on smart that would otherwise have run unread", () =>
    runFlow([composerHandingOff([OFF], "work")], (id, _agent, _checks, repoDir) =>
      Effect.gen(function* () {
        withDefaultBranch(repoDir)
        const parked = yield* create(id, "Add a --json flag", "smart")
        expectAwaitingProposal(parked)
        expect(parked.marks.size).toBe(0)
      }),
    ))

  it("stops a plan on decider too, which takes every other plan unread", () =>
    runFlow([composerHandingOff([OFF], "work")], (id, _agent, _checks, repoDir) =>
      Effect.gen(function* () {
        withDefaultBranch(repoDir)
        const parked = yield* create(id, "Add a --json flag", "decider")
        expectAwaitingProposal(parked)
        expect(parked.marks.size).toBe(0)
      }),
    ))

  it("is taken on auto with nobody there, and the daemon opens the trak on the mode", () =>
    runFlow(
      [
        composerFinishes("Nothing to build on this branch.", [OFF]),
        composerOf(OFF, "work"),
        step(1, "work", reply.artifact("fixed the hook")),
      ],
      (id, _agent, _checks, repoDir) =>
        Effect.gen(function* () {
          withDefaultBranch(repoDir)
          const drives = yield* Drives
          yield* drives.start(id, bornAuto)
          yield* idle(id)
          // No `HumanActed` anywhere: the gate went past on the mode's account, and the
          // mark on the compose entry is the only record of it.
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HandedOff",
            "WorkCommitted",
          ])
          const from = yield* current(id)
          expectState(from, "Finished")
          expect([...from.marks]).toEqual([[0, Mark.Mode()]])

          // The drive that took the gate ended, and the daemon opened what it named —
          // on `auto`, so the new trak's own plan runs unread to its end.
          const [named] = yield* handedOff(id)
          const child = named?.ids?.[0]
          if (child === undefined) return yield* Effect.die("the gate named no trak")
          yield* logged(child, hasComposed)
          yield* idle(child)
          const opened = yield* current(child)
          expect(opened.mode).toBe("auto")
          expect(opened.handedOffFrom).toBe(id)
          expectState(opened, "Finished")
        }),
    ))

  it("refuses, retryably, where the repository has no default branch to cut from", () =>
    runFlow([composerFinishes("Nothing to build on this branch.", [OFF])], (id, _a, _c, repoDir) =>
      Effect.gen(function* () {
        const parked = yield* create(id, "Check the deploy once this is live")
        expectAwaitingProposal(parked)
        const refused = yield* act(id, 0, human.approve())
        expect(refused.state).toMatchObject({ _tag: "Failed", kind: "worktree" })
        expect(refused.state._tag === "Failed" ? refused.state.error : "").toContain("origin/HEAD")
        expect(yield* handedOff(id)).toEqual([])

        // The fix is the one the sentence names, and a resume re-issues the naming.
        withDefaultBranch(repoDir)
        const done = yield* advance(id, Events.restarted(undefined))
        expectState(done, "Finished")
        expect((yield* logTags(id)).slice(-4)).toEqual([
          "WorktreeFailed",
          "Restarted",
          "HandedOff",
          "WorkCommitted",
        ])
      }),
    ))
})

describe("a hand-off from the trak of a goal at rest", () => {
  it("goes the ordinary way once the goal is dropped: the card names the branch, and approving opens a trak", () =>
    runFlow(
      [composerFinishes("Nothing to build on this branch.", [OFF]), composerOf(OFF, "work")],
      (id, _agent, _checks, repoDir) =>
        Effect.gen(function* () {
          withDefaultBranch(repoDir)
          const goal = GoalId.make("dropped-goal")
          yield* seedLog(yield* GoalStore, goal, [
            GoalEvents.started({ file: "g", title: "G", line: "l", finished: "done", limits: {} }),
            GoalEvents.dropped("the person stopped it"),
          ])
          const parked = yield* advance(
            id,
            Events.trakForGoal("Check the deploy once this is live", "manual", goal),
          )
          expectAwaitingProposal(parked)
          // The card at the gate is told the branch, and no goal to send it to.
          const detail = yield* detailOf(id)
          expect(detail.handOffBase).toBe("main")
          expect(detail.handOffGoal).toBeUndefined()

          const done = yield* act(id, 0, human.approve())
          expectState(done, "Closed")
          const [named] = yield* handedOff(id)
          const child = named?.ids?.[0]
          if (named === undefined || child === undefined) {
            return yield* Effect.die("the approval named no trak")
          }
          expect(named).toEqual({ step: 0, base: "main", ids: [child] })
          const opened = yield* driveHandOff(done, 0, 0)
          expect(opened.id).toBe(child)
          expect(opened.description).toBe(OFF)
          expect(opened.handedOffFrom).toBe(id)
        }),
    ))
})
