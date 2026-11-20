// The two conditions the engine answers itself, end to end: `merged`, off the forge's
// listing or a merge made here, and `deployed`, which is `merged` and then the
// project's `deploy.sh` run with the merge commit. What follows from either passing —
// the trak has landed — is the other half of the theme: a local Merge that keeps the
// checkout, an archive that ends `Merged`, a write agent refused, and the deploy
// answer a page and a list row draw.
//
// `conditions.test.ts` owns the waiting itself; nothing here re-asserts the sweep's
// timing beyond advancing past one interval. The forge is a `Ref` the test moves, so
// a pull request can merge under a waiting trak the way one does.

import { existsSync } from "node:fs"
import { join } from "node:path"
import { Deferred, Duration, Effect, Fiber, Layer, Ref, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { DeployDto, TrakDetailDto, TrakListDto } from "@orkestra/shared/dto/trak"
import type { Check } from "../../src/library/types/check.js"
import type { Library } from "../../src/library/types/library.js"
import { BranchName, ForgeAnswer, ForgeListing } from "../../src/vcs/index.js"
import type { PullRequestSummary } from "../../src/vcs/types/pull-request.js"
import { Forge } from "../../src/vcs/ports/forge.js"
import { refusesMerge, refusesOpen } from "../support/forge.js"
import { Conditions } from "../../src/app/conditions.js"
import { DEPLOY_ANSWER_REUSED_FOR } from "../../src/app/deploys.js"
import { type Event, Events } from "../../src/workflow/domain/event.js"
import { landedRefusal } from "../../src/workflow/domain/outputs/composer-output.js"
import { visibleArtifacts } from "../../src/workflow/domain/projection.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import { slotAt, type Trak, type TrakId, waitingAt } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import { advance, driveChild, landOnParent } from "../../src/workflow/runtime.js"
import { settableClock } from "../support/clock.js"
import {
  afterReentry,
  afterReplan,
  child,
  childStep,
  composer,
  onGit,
  runFlowWithAgentLog,
  spawn,
  step,
  stepRuns,
} from "../support/flow.js"
import { commitInWorktree, git, repoOf, worktreeOf, writeWork } from "../support/git.js"
import { mount } from "../support/http.js"
import { actionRoutes } from "../../src/app/routes/actions.js"
import { trakRoutes } from "../../src/app/routes/trak.js"
import {
  act,
  approveAll,
  createAndStart,
  expectAwaiting,
  expectState,
  human,
  idle,
  logged,
  logTags,
  workWaitingOn,
} from "../support/scenario.js"
import { did, fail, pass } from "../support/scripted-checks.js"
import { type AgentLog, onPrompt, onPromptAfter, reply } from "../support/scripted-agent.js"
import type { SessionRequest } from "../../src/agent/types/session.js"
import type { Step } from "../../src/workflow/domain/outputs/proposal.js"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"

const { get, post } = mount(actionRoutes, trakRoutes)

// Most flows here answer through the forge, `deploy.sh` or the `Vcs` port, so they run
// on the fake `Vcs`. The three that read the repository with `git` — the tip a merge
// made here leaves, the branch it removes, a commit made by hand — take `onGit`.

const DEPLOY_ASKED_EVERY = 120
const MERGE_ASKED_EVERY = 60

/** The project's `deploy.sh`, as the loader hands it over. */
const DEPLOY: Check = {
  name: "deploy",
  description: "Whether the merge commit is live.",
  timeoutSeconds: 30,
  askedEverySeconds: DEPLOY_ASKED_EVERY,
  exclusive: false,
  cache: true,
  ignoresLinguistGenerated: false,
  units: undefined,
  cacheAcross: "platform" as const,
  path: "/repo/.orkestra/deploy.sh",
}

/**
 * A fleet whose `work` agent waits on the engine's names it is given, or on none — and
 * reads, as an agent that runs once the branch is in has to: the loader refuses a writer
 * here, and the composer's decode a writer at a step's own `wait_for`.
 */
const waitingOn = (...names: readonly ("merged" | "deployed")[]): Library => {
  const lib = workWaitingOn(names, { deploy: DEPLOY, root: "/repo" })
  const work = lib.agents.get("work")
  if (work === undefined) throw new Error("the fixture fleet lost its `work` agent")
  return { ...lib, agents: new Map(lib.agents).set("work", { ...work, permission: "read-only" }) }
}

const planned = [
  composer("plan", "work"),
  step(1, "plan", reply.artifact("the plan")),
  step(2, "work", reply.artifact("checked production")),
]

/** The log through the wait, as `conditions.test.ts` reaches it. */
const RESTED: readonly string[] = [
  "TrakCreated",
  "WorktreeReady",
  "ComposerReturned",
  "HumanActed",
  "ConditionsMet",
  "AgentReturned",
  "ChecksPassed",
  "HumanActed",
  "WorkCommitted",
  "EffectsRan",
  "ConditionsUnmet",
  "WorkCommitted",
]

const stepLanded = (tags: readonly string[]): boolean =>
  tags.at(-1) === "ChecksPassed" && tags.length > RESTED.length

const grewPastRest = (tags: readonly string[]): boolean => tags.length > RESTED.length

const eventsOf = (id: TrakId) => Effect.flatMap(Store, (store) => store.events(id))

const trakOf = (id: TrakId) => Effect.map(eventsOf(id), (events) => replayHistory(id, events))

const sweepAt = (clock: ReturnType<typeof settableClock>) =>
  Effect.flatMap(Conditions, (c) => c.sweep).pipe(Effect.withClock(clock.clock))

const nextAskOf = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    const events = yield* store.events(id)
    return yield* (yield* Conditions).nextAsk(replayHistory(id, events), events)
  })

// -- the forge, moved by hand ---------------------------------------------------

const MERGE_COMMIT = "9f31c07aa11"

const pull = (state: PullRequestSummary["state"], mergeCommit?: string): PullRequestSummary => ({
  number: 7,
  title: "Add a --json flag",
  url: "https://github.com/o/r/pull/7",
  state,
  isDraft: false,
  merging: "clean",
  checks: "passed",
  ...(mergeCommit === undefined ? {} : { mergeCommit }),
})

const saying = (branch: string, answer?: PullRequestSummary): ForgeListing =>
  ForgeListing.Listed({ entries: [answer === undefined ? { branch } : { branch, pull: answer }] })

/**
 * A `Forge` whose listing the test rewrites — a pull request that merges while a
 * trak waits on it. The detailed answer stays `None`, because nothing here asks it.
 */
const movingForge = () => {
  const listing = Effect.runSync(Ref.make<ForgeListing>(ForgeListing.Listed({ entries: [] })))
  return {
    layer: Layer.succeed(Forge, {
      pullRequest: () => Effect.succeed(ForgeAnswer.None()),
      merge: refusesMerge,
      openPullRequest: refusesOpen,
      listing: () => Ref.get(listing),
    }),
    say: (next: ForgeListing) => Ref.set(listing, next),
  }
}

/**
 * A `Forge` whose listing can be held open once asked — the run-now press's re-ask of
 * `merged` in flight, so another press can land under it. It says *no pull request*
 * on either side of the hold, and `asked` resolves when the held call has begun.
 */
const heldForge = () => {
  const release = Effect.runSync(Deferred.make<void>())
  const asked = Effect.runSync(Deferred.make<void>())
  const holding = Effect.runSync(Ref.make(false))
  const nothing = ForgeListing.Listed({ entries: [] })
  return {
    layer: Layer.succeed(Forge, {
      pullRequest: () => Effect.succeed(ForgeAnswer.None()),
      merge: refusesMerge,
      openPullRequest: refusesOpen,
      listing: () =>
        Effect.flatMap(Ref.get(holding), (held) =>
          held
            ? Effect.as(
                Effect.andThen(Deferred.succeed(asked, undefined), Deferred.await(release)),
                nothing,
              )
            : Effect.succeed(nothing),
        ),
    }),
    hold: Ref.set(holding, true),
    asked: Deferred.await(asked),
    release: Deferred.succeed(release, undefined),
  }
}

/** Approve the plan and the first step with the forge saying `answer` about the branch. */
const untilWaiting = (
  id: TrakId,
  say: (l: ForgeListing) => Effect.Effect<void>,
  answer?: PullRequestSummary,
) =>
  Effect.gen(function* () {
    const parked = yield* createAndStart(id, "Add a --json flag")
    expectAwaiting(parked, "approval")
    yield* say(saying(worktreeOf(parked).branch, answer))
    return yield* act(id, 1, human.approve())
  })

const jsonOf = (response: HttpServerResponse): Effect.Effect<unknown> =>
  Effect.promise(async (): Promise<unknown> => JSON.parse(await toWeb(response).text()))

/** The list's rows, through the published contract. */
const rows = Effect.flatMap(get(""), (response) =>
  Effect.map(jsonOf(response), (body) => Schema.decodeUnknownSync(TrakListDto)(body).traks),
)

const deployOf = (response: HttpServerResponse) =>
  Effect.map(jsonOf(response), Schema.decodeUnknownSync(DeployDto))

describe("`merged`, answered from the forge", () => {
  it("waits while the pull request is open, and runs the step once the forge says it merged", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      planned,
      (id, agent, checks) =>
        Effect.gen(function* () {
          const rested = yield* untilWaiting(id, forge.say, pull("open"))
          expectState(rested, "Finished")
          expect(waitingAt(rested)).toStrictEqual({ step: 2, name: "merged", stopped: false })
          expect(rested.landed).toBeUndefined()
          // The engine answered it: no script ran, and the log holds what it said.
          expect((yield* checks).ran).toEqual([])
          expect(yield* logTags(id)).toEqual(RESTED)
          const branch = worktreeOf(rested).branch

          // The pull request merges over there. The sweep finds it on the engine's own
          // interval, and the step runs with nobody pressing anything.
          yield* forge.say(saying(branch, pull("merged", MERGE_COMMIT)))
          const clock = settableClock(Date.now())
          clock.advance(MERGE_ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* logged(id, stepLanded)
          yield* idle(id)

          const running = yield* trakOf(id)
          expectAwaiting(running, "approval")
          expectState(running, "AwaitingHuman", 2)
          expect(stepRuns(yield* agent)).toHaveLength(2)
          // The commit the branch landed as rides the answer and stays on the trak.
          expect(running.landed).toStrictEqual({ sha: MERGE_COMMIT })
          const events = yield* eventsOf(id)
          expect(events.at(-3)).toMatchObject({
            _tag: "ConditionsMet",
            ran: ["merged"],
            merged: MERGE_COMMIT,
          })

          // Archiving a landed trak ends it `Merged`, naming that commit — without asking
          // the forge again, whose detailed answer here says nothing.
          expectState(yield* act(id, 2, human.approve()), "Finished")
          const archived = yield* advance(id, Events.closed())
          expect(archived.state).toStrictEqual({ _tag: "Merged", sha: MERGE_COMMIT })
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })

  it("gives up when the pull request was closed without merging", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      planned,
      (id) =>
        Effect.gen(function* () {
          const rested = yield* untilWaiting(id, forge.say, pull("open"))
          yield* forge.say(saying(worktreeOf(rested).branch, pull("closed")))
          const clock = settableClock(Date.now())
          clock.advance(MERGE_ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* logged(id, grewPastRest)
          yield* idle(id)

          const stopped = yield* trakOf(id)
          expectState(stopped, "Finished")
          expect(waitingAt(stopped)).toStrictEqual({ step: 2, name: "merged", stopped: true })
          expect(stopped.landed).toBeUndefined()
          expect(yield* nextAskOf(id)).toBeUndefined()
          const events = yield* eventsOf(id)
          expect(events.at(-1)).toMatchObject({
            _tag: "ConditionsUnmet",
            name: "merged",
            output: "pull request #7 was closed without merging",
          })
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })

  it("reads a forge it cannot ask, and a branch left out of the answer, as not yet", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      planned,
      (id) =>
        Effect.gen(function* () {
          yield* forge.say(ForgeListing.Unavailable({ why: "gh: not logged in" }))
          const parked = yield* createAndStart(id, "Add a --json flag")
          const rested = yield* act(id, 1, human.approve())
          expect(waitingAt(rested)).toMatchObject({ name: "merged", stopped: false })
          expect(worktreeOf(parked).branch).toBe(worktreeOf(rested).branch)

          // Left out rather than answered about: a bounded listing, not a verdict.
          yield* forge.say(ForgeListing.Listed({ entries: [] }))
          const clock = settableClock(Date.now())
          clock.advance(MERGE_ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* idle(id)
          expect(waitingAt(yield* trakOf(id))).toMatchObject({ name: "merged", stopped: false })
          expect(yield* logTags(id)).toEqual(RESTED)
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })
})

/** The plan's own merge wait on the step that reports, where its agent declares none. */
const reportingOnceMerged = [
  composer("plan", { agent: "work", instruction: "Report on the release.", wait_for: "merged" }),
  step(1, "plan", reply.artifact("the plan")),
  step(2, "work", reply.artifact("checked production")),
]

const isMet = (e: Event): boolean => e._tag === "ConditionsMet"

describe("`merged`, as a step's own `wait_for`", () => {
  it("holds a step whose own `wait_for` names it, though its agent declares no wait", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      reportingOnceMerged,
      (id, agent, checks) =>
        Effect.gen(function* () {
          const rested = yield* untilWaiting(id, forge.say, pull("open"))
          expectState(rested, "Finished")
          expect(waitingAt(rested)).toStrictEqual({ step: 2, name: "merged", stopped: false })
          expect((yield* checks).ran).toEqual([])
          expect(yield* logTags(id)).toEqual(RESTED)

          yield* forge.say(saying(worktreeOf(rested).branch, pull("merged", MERGE_COMMIT)))
          const clock = settableClock(Date.now())
          clock.advance(MERGE_ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* logged(id, stepLanded)
          yield* idle(id)

          const running = yield* trakOf(id)
          expectState(running, "AwaitingHuman", 2)
          expect(stepRuns(yield* agent)).toHaveLength(2)
          expect(running.landed).toStrictEqual({ sha: MERGE_COMMIT })
        }),
      waitingOn(),
      {},
      undefined,
      forge.layer,
    )
  })

  it("asks a name once where the step and its agent both wait on it", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      reportingOnceMerged,
      (id) =>
        Effect.gen(function* () {
          yield* untilWaiting(id, forge.say, pull("merged", MERGE_COMMIT))
          yield* idle(id)
          expect((yield* eventsOf(id)).findLast(isMet)).toMatchObject({ ran: ["merged"] })
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })
})

/** The prompt the held step's first turn was given — the second step run of the flow. */
const forcedPrompt = (runs: readonly SessionRequest[]): string | undefined => runs[1]?.prompt

describe("a person runs the step held on `merged` now", () => {
  it("starts the step while the pull request is open, and the turn is told `merged` is unmet", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      planned,
      (id, agent) =>
        Effect.gen(function* () {
          yield* untilWaiting(id, forge.say, pull("open"))
          const response = yield* post(id, "run-now", {})
          expect(response.status).toBe(202)
          yield* logged(id, stepLanded)
          yield* idle(id)

          const running = yield* trakOf(id)
          expectState(running, "AwaitingHuman", 2)
          expect(stepRuns(yield* agent)).toHaveLength(2)
          expect(forcedPrompt(stepRuns(yield* agent))).toContain(
            "This step was held until `merged` was met, and it is not",
          )
          // The forge was asked once more and still said open: nothing landed.
          expect(running.landed).toBeUndefined()
          expect((yield* eventsOf(id)).at(-3)).toStrictEqual(
            expect.objectContaining({ _tag: "WaitSkipped", step: 2, name: "merged" }),
          )
          expect((yield* eventsOf(id)).at(-3)).not.toHaveProperty("merged")
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })

  it("records the merge the re-ask finds, so the trak has landed before the step runs", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      planned,
      (id) =>
        Effect.gen(function* () {
          const rested = yield* untilWaiting(id, forge.say, pull("open"))
          // Merged over there since the sweep last asked; the press asks once more.
          yield* forge.say(saying(worktreeOf(rested).branch, pull("merged", MERGE_COMMIT)))
          expect((yield* post(id, "run-now", {})).status).toBe(202)
          yield* logged(id, stepLanded)
          yield* idle(id)

          const running = yield* trakOf(id)
          expectState(running, "AwaitingHuman", 2)
          expect(running.landed).toStrictEqual({ sha: MERGE_COMMIT })
          expect((yield* eventsOf(id)).at(-3)).toMatchObject({
            _tag: "WaitSkipped",
            name: "merged",
            merged: MERGE_COMMIT,
          })
          // Landed, so archiving ends it `Merged` naming that commit.
          expectState(yield* act(id, 2, human.approve()), "Finished")
          expect((yield* advance(id, Events.closed())).state).toStrictEqual({
            _tag: "Merged",
            sha: MERGE_COMMIT,
          })
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })
})

describe("a person's other press wins over the run-now's re-ask", () => {
  it("archives under the forge call, and the late press lands nothing", async () => {
    const forge = heldForge()
    await runFlowWithAgentLog(
      planned,
      (id) =>
        Effect.gen(function* () {
          expectAwaiting(yield* createAndStart(id, "Add a --json flag"), "approval")
          const rested = yield* act(id, 1, human.approve())
          expect(waitingAt(rested)).toStrictEqual({ step: 2, name: "merged", stopped: false })

          // The route has read a waiting trak and is inside `askMerged`, holding
          // nothing — so an archive is accepted and runs to its end under it.
          yield* forge.hold
          const press = yield* Effect.fork(post(id, "run-now", {}))
          yield* forge.asked
          expect((yield* post(id, "close", {})).status).toBe(202)
          yield* idle(id)
          expect((yield* trakOf(id)).state._tag).toBe("Closed")
          const before = yield* logTags(id)

          // Released, the press asks for its drive, which re-reads under the permit and
          // finds the trak gone from the entry: accepted, and nothing appended.
          yield* forge.release
          expect((yield* Fiber.join(press)).status).toBe(202)
          yield* idle(id)
          expect(yield* logTags(id)).toEqual(before)
          expect((yield* trakOf(id)).state._tag).toBe("Closed")
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })
})

describe("a merge made here, on a trak held on `merged`", () => {
  it("keeps the checkout, runs the held step, and archives as Merged with that commit", async () => {
    const forge = movingForge()
    await onGit.runFlowWithAgentLog(
      planned,
      (id, agent) =>
        Effect.gen(function* () {
          const rested = yield* untilWaiting(id, forge.say, pull("open"))
          const worktree = worktreeOf(rested)
          const repoDir = repoOf(worktree.path)

          // The press is what passes the wait: the branch goes into the host's, the
          // checkout stays, and the step runs in it at once.
          const running = yield* advance(id, Events.merged())
          expectAwaiting(running, "approval")
          expectState(running, "AwaitingHuman", 2)
          expect(existsSync(worktree.path)).toBe(true)
          expect(stepRuns(yield* agent)).toHaveLength(2)
          expect(yield* logTags(id)).toEqual([
            ...RESTED,
            "Merged",
            "WorkMerged",
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
          ])
          const tip = git(repoDir, "rev-parse", "HEAD")
          expect(running.landed).toStrictEqual({ sha: tip })
          expect(git(repoDir, "branch", "--list", worktree.branch)).not.toBe("")

          // Approved, the plan runs out and the trak rests as any other — and archiving
          // it names where the work went, because the merge already happened.
          expectState(yield* act(id, 2, human.approve()), "Finished")
          const archived = yield* advance(id, Events.closed())
          expect(archived.state).toStrictEqual({ _tag: "Merged", sha: tip })
          expect(existsSync(worktree.path)).toBe(false)
          expect(git(repoDir, "branch", "--list", worktree.branch)).toBe("")
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })

  it("asks the engine's own agent — which writes — of a landed trak read-only", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      [...planned, answersAsk],
      (id, agent) =>
        Effect.gen(function* () {
          yield* untilWaiting(id, forge.say, pull("open"))
          yield* advance(id, Events.merged())
          expectState(yield* act(id, 2, human.approve()), "Finished")

          const response = yield* post(id, "reenter", { what: "is it live?", agent: "generic" })
          expect(response.status).toBe(202)
          yield* logged(id, askAnswered)
          // The one turn whose declaration is read down rather than obeyed: the deny
          // list and the prompt both say so.
          // And it runs bypassed rather than under auto mode, as any reader does.
          expect(askedOf(yield* agent)).toMatchObject([
            { toolAccess: "read-only", permission: "full" },
          ])
          expect(askedOf(yield* agent)[0]?.prompt).toContain("The tools that edit files are denied")

          // The detail says so, which is what hides the merge press on screen.
          const detail = yield* Effect.map(
            jsonOf(yield* get(`/${id}`)),
            Schema.decodeUnknownSync(TrakDetailDto),
          )
          expect(detail.landed).toStrictEqual({ sha: (yield* trakOf(id)).landed?.sha })
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })
})

/** What a scripted `deploy.sh` says: rolling out, timed out, live, and given up. */
const rollingOut = fail("release 88 is rolling out", 1)
const timedOut = { passed: false, output: "deploy timed out after 30s.", command: "bash deploy.sh" }
const live = did(
  '{"url":"https://app.example/","version":"v88","detail":"canary"}\nrelease 88 is live',
)
const gaveUp = fail("release 88 was rolled back", 2)

describe("`deployed`, answered by deploy.sh", () => {
  it("runs the script from the project root with the merge commit, and the step once it exits 0", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      planned,
      (id, agent, checks) =>
        Effect.gen(function* () {
          const rested = yield* untilWaiting(id, forge.say, pull("merged", MERGE_COMMIT))
          expectState(rested, "Finished")
          expect(waitingAt(rested)).toStrictEqual({ step: 2, name: "deployed", stopped: false })
          // Merged before the deploy is live: the trak has landed already, and the log
          // says with which commit.
          expect(rested.landed).toStrictEqual({ sha: MERGE_COMMIT })
          expect((yield* checks).calls).toEqual([
            { name: "deploy", cwd: "/repo", args: [MERGE_COMMIT] },
          ])

          // A timeout is not yet, and it changes nothing on the log.
          const clock = settableClock(Date.now())
          clock.advance(DEPLOY_ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* idle(id)
          yield* Effect.sleep("20 millis")
          expect((yield* checks).ran).toEqual(["deploy", "deploy"])
          expect(yield* logTags(id)).toEqual(RESTED)

          // The list draws the sweep's newest answer for the waiting row.
          expect((yield* rows)[0]?.deploy).toMatchObject({
            answer: "not-yet",
            text: "deploy timed out after 30s.",
          })

          clock.advance(DEPLOY_ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* logged(id, stepLanded)
          yield* idle(id)
          expectState(yield* trakOf(id), "AwaitingHuman", 2)
          expect(stepRuns(yield* agent)).toHaveLength(2)
        }),
      waitingOn("deployed"),
      { deploy: [rollingOut, timedOut, pass] },
      undefined,
      forge.layer,
    )
  })

  it("gives up on any other exit, and the list says so", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      planned,
      (id) =>
        Effect.gen(function* () {
          yield* untilWaiting(id, forge.say, pull("merged", MERGE_COMMIT))
          const clock = settableClock(Date.now())
          clock.advance(DEPLOY_ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* logged(id, grewPastRest)
          yield* idle(id)
          expect(waitingAt(yield* trakOf(id))).toStrictEqual({
            step: 2,
            name: "deployed",
            stopped: true,
          })
          expect((yield* rows)[0]?.deploy).toMatchObject({
            answer: "gave-up",
            text: "release 88 was rolled back",
          })
        }),
      waitingOn("deployed"),
      { deploy: [rollingOut, gaveUp] },
      undefined,
      forge.layer,
    )
  })

  /**
   * The pair a surface has to tell apart, and the reason `waitingRow` has a failing test
   * beside it: the page's own route keeps running the script after the wait has stopped
   * asking, so the row's newest answer is `live` on a trak whose held step nothing is
   * ever going to start.
   */
  it("still answers `live` from the page's route once the wait has stopped asking", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      planned,
      (id) =>
        Effect.gen(function* () {
          yield* untilWaiting(id, forge.say, pull("merged", MERGE_COMMIT))
          const clock = settableClock(Date.now())
          clock.advance(DEPLOY_ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* logged(id, grewPastRest)
          yield* idle(id)
          // Past the window an answer is reused for, so the page's poll runs the script.
          clock.advance(Duration.toMillis(DEPLOY_ANSWER_REUSED_FOR) + 1000)
          const page = yield* get(`/${id}/deploy`).pipe(Effect.withClock(clock.clock))
          expect(yield* deployOf(page)).toMatchObject({ answer: "live" })
          const row = (yield* rows)[0]
          expect(row?.deploy).toMatchObject({ answer: "live" })
          expect(row?.waiting).toMatchObject({ name: "deployed", stopped: true })
        }),
      waitingOn("deployed"),
      { deploy: [rollingOut, gaveUp, live] },
      undefined,
      forge.layer,
    )
  })
})

describe("`deployed` and the branch's merge", () => {
  it("does not run the script until the branch has merged", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      planned,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const rested = yield* untilWaiting(id, forge.say, pull("open"))
          expect(waitingAt(rested)).toMatchObject({ name: "deployed", stopped: false })
          expect(rested.landed).toBeUndefined()
          expect((yield* checks).ran).toEqual([])
          const events = yield* eventsOf(id)
          expect(events.at(-2)).toMatchObject({
            _tag: "ConditionsUnmet",
            name: "deployed",
            output: "not merged yet: pull request #7 is open",
          })
          // Nothing to draw for the deploy yet: the answer was about the branch.
          expect((yield* rows)[0]?.deploy).toBeUndefined()

          // Once it merges, the first ask records the landing and runs the script.
          yield* forge.say(saying(worktreeOf(rested).branch, pull("merged", MERGE_COMMIT)))
          const clock = settableClock(Date.now())
          clock.advance(DEPLOY_ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* logged(id, grewPastRest)
          yield* idle(id)
          const landed = yield* trakOf(id)
          expectState(landed, "Finished")
          expect(landed.landed).toStrictEqual({ sha: MERGE_COMMIT })
          expect(waitingAt(landed)).toMatchObject({ name: "deployed", stopped: false })
          expect((yield* checks).calls).toEqual([
            { name: "deploy", cwd: "/repo", args: [MERGE_COMMIT] },
          ])
        }),
      waitingOn("deployed"),
      { deploy: [rollingOut] },
      undefined,
      forge.layer,
    )
  })

  it("holds a merge made here until the deploy is live, and asks the script with that commit", async () => {
    const forge = movingForge()
    await onGit.runFlowWithAgentLog(
      planned,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const rested = yield* untilWaiting(id, forge.say, pull("open"))
          const worktree = worktreeOf(rested)
          const held = yield* advance(id, Events.merged())
          expectState(held, "Finished")
          expect(waitingAt(held)).toMatchObject({ name: "deployed", stopped: false })
          expect(existsSync(worktree.path)).toBe(true)
          const tip = git(repoOf(worktree.path), "rev-parse", "HEAD")
          expect(held.landed).toStrictEqual({ sha: tip })
          expect((yield* checks).calls).toEqual([{ name: "deploy", cwd: "/repo", args: [tip] }])
          expect(yield* logTags(id)).toEqual([
            ...RESTED,
            "Merged",
            "WorkMerged",
            "ConditionsUnmet",
            "WorkCommitted",
          ])
        }),
      waitingOn("deployed"),
      { deploy: [rollingOut] },
      undefined,
      forge.layer,
    )
  })
})

describe("the deploy route", () => {
  it("runs the script for a landed trak, reads its JSON line, and shares one run", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      planned,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          yield* untilWaiting(id, forge.say, pull("merged", MERGE_COMMIT))
          const before = (yield* checks).ran.length

          const [first, second] = yield* Effect.all([get(`/${id}/deploy`), get(`/${id}/deploy`)], {
            concurrency: "unbounded",
          })
          expect(first.status).toBe(200)
          const answer = yield* deployOf(first)
          expect(answer).toMatchObject({
            answer: "live",
            url: "https://app.example/",
            version: "v88",
            detail: "canary",
            text: "release 88 is live",
          })
          expect(yield* deployOf(second)).toStrictEqual(answer)
          // Two asks at once, one run — and a third inside the window runs nothing.
          expect((yield* checks).ran.length).toBe(before + 1)
          expect(yield* deployOf(yield* get(`/${id}/deploy`))).toStrictEqual(answer)
          expect((yield* checks).ran.length).toBe(before + 1)
          expect((yield* checks).calls.at(-1)).toEqual({
            name: "deploy",
            cwd: "/repo",
            args: [MERGE_COMMIT],
          })
        }),
      waitingOn("deployed"),
      { deploy: [rollingOut, live] },
      undefined,
      forge.layer,
    )
  })

  it("answers `none` for a trak with no merge commit, and runs nothing", async () => {
    await runFlowWithAgentLog(
      planned,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const response = yield* get(`/${id}/deploy`)
          expect(response.status).toBe(200)
          expect(yield* deployOf(response)).toStrictEqual({ answer: "none" })
          expect((yield* checks).ran).toEqual([])
          expect((yield* get(`/nope/deploy`)).status).toBe(404)
        }),
      waitingOn("deployed"),
      { deploy: [live] },
    )
  })

  it("answers `none` where the project has no deploy.sh", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      planned,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const rested = yield* untilWaiting(id, forge.say, pull("open"))
          const landed = yield* advance(id, Events.merged())
          expect(landed.landed).toBeDefined()
          expect(worktreeOf(rested).branch).toBe(BranchName.make(worktreeOf(rested).branch))
          expect(yield* deployOf(yield* get(`/${id}/deploy`))).toStrictEqual({ answer: "none" })
          expect((yield* checks).ran).toEqual([])
        }),
      { ...waitingOn("merged"), deploy: undefined },
      {},
      undefined,
      forge.layer,
    )
  })
})

/**
 * A landed parent spawning a piece: the fleet above with a writer beside it, so the
 * child's composer has something to be refused. `fix` never runs — the refusal is
 * the point.
 */
const withWriter = (lib: Library): Library => {
  const work = lib.agents.get("work")
  if (work === undefined) throw new Error("the fixture fleet lost its `work` agent")
  return {
    ...lib,
    agents: new Map(lib.agents).set("fix", {
      ...work,
      name: "fix",
      description: "Fixes what the check found.",
      permission: "write",
      conditions: [],
      processes: [],
    }),
  }
}

/** `work` waits on `merged`, then one child checks the result. */
const spawning = [
  composer("plan", "work", spawn(child("plan", "the check"))),
  step(1, "plan", reply.artifact("the plan")),
  step(2, "work", reply.artifact("checked production")),
  childStep("plan", "the check", reply.artifact("looks fine")),
]

/** An entry by the agent it names, or its kind — hoisted: a callback too deep. */
const agentOrKind = (s: Step): string => ("agent" in s ? s.agent : s.type)

/** The composer turns handed the decode's reason. Same reason. */
const reAsked = (log: AgentLog): readonly SessionRequest[] =>
  log.requests.filter((r) => r.prompt.includes("branch has merged"))

/** The engine's own agent, answering the question the re-entry door carried. */
const answersAsk = onPrompt(/is it live\?/, reply.artifact("yes — 8c41d0e is on production"), "ask")

/** The turn the ask ran as — matched on the question, as the scripted turn is. */
const askedOf = (log: AgentLog): readonly SessionRequest[] =>
  log.requests.filter((r) => r.prompt.includes("is it live?"))

/** The ask has come back: an `AgentReturned` after the `Reentered` that asked it. */
const askAnswered = (tags: readonly string[]): boolean =>
  tags.lastIndexOf("AgentReturned") > tags.lastIndexOf("Reentered")

/** The child, born after the parent landed and holding at `Finished`. */
const childOfLanded = (id: TrakId, say: (l: ForgeListing) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    yield* untilWaiting(id, say, pull("open"))
    yield* advance(id, Events.merged())
    const spawned = yield* act(id, 2, human.approve())
    expect(spawned.state).toEqual({ _tag: "AwaitingChildren", step: 3 })
    const run = slotAt(spawned, 3).children[0]
    if (run === undefined) throw new Error("no child was spawned")
    const started = yield* driveChild(spawned, 3, 0)
    const finished = yield* approveAll(run.id, started)
    expectState(finished, "Finished")
    return finished
  })

describe("a spawn child of a trak that has landed", () => {
  const childOf = childOfLanded

  it("carries no landing of its own — the refusal reads the parent's log", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      spawning,
      (id) =>
        Effect.gen(function* () {
          const kid = yield* childOf(id, forge.say)
          expect(kid.landed).toBeUndefined()
          expect((yield* trakOf(id)).landed).toBeDefined()
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })

  it("still merges its documents into the landed parent, because its steps only read", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      spawning,
      (id) =>
        Effect.gen(function* () {
          const kid = yield* childOf(id, forge.say)
          const merged = yield* advance(kid.id, Events.merged())
          expect(merged.state._tag).toBe("Merged")
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })

  it("runs the engine's own agent read-only at the re-entry door, as its parent does", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      [...spawning, answersAsk],
      (id, agent) =>
        Effect.gen(function* () {
          const kid = yield* childOf(id, forge.say)
          const response = yield* post(kid.id, "reenter", { what: "is it live?", agent: "generic" })
          expect(response.status).toBe(202)
          yield* logged(kid.id, askAnswered)
          expect(askedOf(yield* agent)).toMatchObject([{ toolAccess: "read-only" }])
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })

  it("has its composer refused a write agent at decode, and re-asked with the reason", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      [
        ...spawning,
        // The child's composer proposes a writer first; the retry it is handed names
        // the reason, and the second turn matches on that rather than on the door.
        afterReentry("fix"),
        onPrompt(
          /branch has merged/,
          reply.proposal("the check, re-cut", [{ agent: "plan", instruction: "Look again." }]),
          "re-asked",
        ),
      ],
      (id, agent) =>
        Effect.gen(function* () {
          const kid = yield* childOf(id, forge.say)
          const replanned = yield* advance(kid.id, Events.reentered("the check missed a case"))
          expect(replanned.state._tag).toBe("AwaitingProposal")
          // The re-cut names the read-only agent; the refused proposal never reached
          // the log, so the plan holds the child's own step, the ask and the re-cut.
          expect(replanned.plan?.steps.map(agentOrKind)).toEqual(["plan", "compose", "plan"])
          const asked = reAsked(yield* agent)
          expect(asked).toHaveLength(1)
          expect(asked[0]?.prompt).toContain("`fix` writes")
        }),
      withWriter(waitingOn("merged")),
      {},
      undefined,
      forge.layer,
    )
  })
})

/** The child first, then `work` waits on `merged`: the child merges back before the parent lands. */
const spawningFirst = [
  composer("plan", spawn(child("plan", "the check")), "work"),
  step(1, "plan", reply.artifact("the plan")),
  childStep("plan", "the check", reply.artifact("looks fine")),
  step(3, "work", reply.artifact("checked production")),
]

describe("a spawn child that merged back before its parent landed", () => {
  /**
   * The child, merged into the parent's checkout while the parent is still ahead of
   * its wait — then the parent lands. The child's own log says nothing about it.
   */
  const childBefore = (id: TrakId, say: (l: ForgeListing) => Effect.Effect<void>) =>
    Effect.gen(function* () {
      const parked = yield* createAndStart(id, "Add a --json flag")
      yield* say(saying(worktreeOf(parked).branch, pull("open")))
      const spawned = yield* act(id, 1, human.approve())
      expect(spawned.state).toEqual({ _tag: "AwaitingChildren", step: 2 })
      const run = slotAt(spawned, 2).children[0]
      if (run === undefined) throw new Error("no child was spawned")
      const started = yield* driveChild(spawned, 2, 0)
      expectState(yield* approveAll(run.id, started), "Finished")
      const merged = yield* advance(run.id, Events.merged())
      expectState(merged, "Merged")
      yield* landOnParent(merged)
      // The parent carries on to `work`, rests on the wait, and a Merge lands it.
      expect(waitingAt(yield* trakOf(id))).toMatchObject({ name: "merged", stopped: false })
      const landed = yield* advance(id, Events.merged())
      expect(landed.landed).toBeDefined()
      const kid = yield* trakOf(run.id)
      expect(kid.landed).toBeUndefined()
      return kid
    })

  it("runs the engine's own agent read-only at the re-entry door once the parent has landed", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      [...spawningFirst, answersAsk],
      (id, agent) =>
        Effect.gen(function* () {
          const kid = yield* childBefore(id, forge.say)
          const response = yield* post(kid.id, "reenter", { what: "is it live?", agent: "generic" })
          expect(response.status).toBe(202)
          yield* logged(kid.id, askAnswered)
          expect(askedOf(yield* agent)).toMatchObject([{ toolAccess: "read-only" }])
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })

  it("has its composer refused a write agent at decode once the parent has landed", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      [
        ...spawningFirst,
        afterReentry("fix"),
        onPrompt(
          /branch has merged/,
          reply.proposal("the check, re-cut", [{ agent: "plan", instruction: "Look again." }]),
          "re-asked",
        ),
      ],
      (id, agent) =>
        Effect.gen(function* () {
          const kid = yield* childBefore(id, forge.say)
          const replanned = yield* advance(kid.id, Events.reentered("the check missed a case"))
          expect(replanned.state._tag).toBe("AwaitingProposal")
          expect(replanned.plan?.steps.map(agentOrKind)).toEqual(["plan", "compose", "plan"])
          const asked = reAsked(yield* agent)
          expect(asked).toHaveLength(1)
          expect(asked[0]?.prompt).toContain("`fix` writes")
        }),
      withWriter(waitingOn("merged")),
      {},
      undefined,
      forge.layer,
    )
  })
})

/** The child, finished, merged and landed while its parent still waits on `merged`. */
const landedOnce = (id: TrakId, say: (l: ForgeListing) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    const parked = yield* createAndStart(id, "Add a --json flag")
    yield* say(saying(worktreeOf(parked).branch, pull("open")))
    const spawned = yield* act(id, 1, human.approve())
    const run = slotAt(spawned, 2).children[0]
    if (run === undefined) throw new Error("no child was spawned")
    const started = yield* driveChild(spawned, 2, 0)
    expectState(yield* approveAll(run.id, started), "Finished")
    yield* landOnParent(yield* advance(run.id, Events.merged()))
    expect(waitingAt(yield* trakOf(id))).toMatchObject({ name: "merged", stopped: false })
    return run.id
  })

/**
 * The child merged back and re-entered while its parent still waits: its composer
 * plans `fix`, which writes, and the plan is accepted — nothing has landed yet.
 */
const replannedToWrite = (
  id: TrakId,
  say: (l: ForgeListing) => Effect.Effect<void>,
  plan: readonly string[] = ["plan", "compose", "fix"],
) =>
  Effect.gen(function* () {
    const kid = yield* landedOnce(id, say)
    const replanned = yield* advance(kid, Events.reentered("the check missed a case"))
    expect(replanned.state._tag).toBe("AwaitingProposal")
    expect(replanned.plan?.steps.map(agentOrKind)).toEqual(plan)
    return kid
  })

/** The parent lands: a Merge made here passes its `merged` wait. */
const landParent = (id: TrakId) =>
  Effect.map(advance(id, Events.merged()), (landed) => {
    expect(landed.landed).toBeDefined()
  })

const inParent = (id: TrakId, file: string) =>
  Effect.map(trakOf(id), (parent) => existsSync(join(worktreeOf(parent).path, file)))

/** The piece's name on the parent: the spawn at 2, its one child, whose last step is `plan`. */
const PIECE = "2.0-plan"

/**
 * A child that landed once and ended again: every document it filed is on the parent
 * under the piece's name — the later ones by a `ChildRefiled` — and the parent has
 * not moved for it.
 */
const expectRefiled = (kid: Trak, parent: TrakId) =>
  Effect.gen(function* () {
    const before = yield* trakOf(parent)
    yield* landOnParent(kid)
    const after = yield* trakOf(parent)
    expect(after.state).toEqual(before.state)
    const filed = visibleArtifacts(kid, undefined).map(([key]) => key)
    expect(filed.length).toBeGreaterThan(1)
    for (const key of filed) expect(after.artifacts.has(`${PIECE}/${key}`)).toBe(true)
    expect(yield* logTags(parent)).toContain("ChildRefiled")
  })

/**
 * Merge pressed on a child whose parent has landed and whose branch moved: the changes
 * are dropped whole, the child ends `Closed` with the log saying so, what it filed
 * since it landed reaches the parent, and the parent's checkout never sees the edit.
 */
const expectDropped = (kid: TrakId, parent: TrakId) =>
  Effect.gen(function* () {
    const dropped = yield* advance(kid, Events.merged())
    expect(dropped.state._tag).toBe("Closed")
    expect(yield* logTags(kid)).toContain("ChangesDropped")
    expect(yield* inParent(parent, "fix.ts")).toBe(false)
    expect(existsSync(worktreeOf(dropped).path)).toBe(false)
    yield* expectRefiled(dropped, parent)
    return dropped
  })

/** A composer's answer — the last of them is the proposal at the gate. */
const composed = (e: Event): boolean => e._tag === "ComposerReturned"

const refusedPlan = onPrompt(
  /branch has merged/,
  reply.proposal("the check, re-cut", [{ agent: "plan", instruction: "Look again." }]),
  "refused",
)

describe("an edited plan approved after the parent landed", () => {
  it("is refused at the act route when the approval carries edits, and nothing is appended", async () => {
    // The edited plan is held to the composer's decode as it stands now, so the parent
    // landing since the proposal refuses the writer the proposal was allowed.
    const forge = movingForge()
    await runFlowWithAgentLog(
      [...spawningFirst, afterReentry("fix")],
      (id) =>
        Effect.gen(function* () {
          const kid = yield* replannedToWrite(id, forge.say)
          yield* landParent(id)
          const store = yield* Store
          const before = yield* store.events(kid)
          const response = yield* post(kid, "act", {
            action: "approve",
            edits: {
              proposal: before.findLastIndex(composed),
              steps: [{ edit: "instruction", at: 2, instruction: "Fix only the case." }],
            },
          })
          expect(response.status).toBe(422)
          expect(yield* jsonOf(response)).toStrictEqual({
            _tag: "PlanRefused",
            reason: landedRefusal("fix"),
          })
          expect((yield* store.events(kid)).length).toBe(before.length)
        }),
      withWriter(waitingOn("merged")),
      {},
      undefined,
      forge.layer,
    )
  })
})

describe("a write agent accepted into a child's plan before its parent landed", () => {
  it("is refused as its step starts, and the child goes back to its composer with the reason", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      [...spawningFirst, afterReentry("fix"), refusedPlan],
      (id, agent) =>
        Effect.gen(function* () {
          const kid = yield* replannedToWrite(id, forge.say)
          yield* landParent(id)
          // Approving the plan now is what a person does without knowing the parent
          // moved. The step never begins: the composer is asked from that position.
          const asked = yield* act(kid, 0, human.approve())
          expect(asked.state._tag).toBe("AwaitingProposal")
          expect(asked.reconsult).toMatchObject({ why: { _tag: "Refused", step: 2 } })
          expect(asked.plan?.steps.map(agentOrKind)).toEqual(["plan", "compose", "compose", "plan"])
          expect(yield* logTags(kid)).toContain("StepRefused")
          const prompts = reAsked(yield* agent)
          expect(prompts).toHaveLength(1)
          expect(prompts[0]?.prompt).toContain("`fix` writes")
          expect(prompts[0]?.prompt).toContain("refused to start it")
        }),
      withWriter(waitingOn("merged")),
      {},
      undefined,
      forge.layer,
    )
  })

  it("is not merged into the parent when its turn ran as the parent landed", async () => {
    const forge = movingForge()
    const release = Effect.runSync(Deferred.make<void>())
    const started = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [
        ...spawningFirst,
        afterReentry("fix"),
        onPromptAfter(
          /Produce the fix\./,
          Effect.zipRight(Deferred.succeed(started, undefined), Deferred.await(release)),
          reply.artifact("fixed it"),
        ),
      ],
      (id) =>
        Effect.gen(function* () {
          const kid = yield* replannedToWrite(id, forge.say)
          // The turn starts before the landing and is still running when it happens.
          // Waited for rather than assumed: the press answers before the turn spawns.
          expect((yield* post(kid, "act", { action: "approve" })).status).toBe(202)
          yield* Deferred.await(started)
          yield* landParent(id)
          yield* Deferred.succeed(release, undefined)
          yield* idle(kid)
          const parked = yield* trakOf(kid)
          expectState(parked, "AwaitingHuman", 2)
          // What a write turn leaves: a change the approval commits onto the branch.
          writeWork(worktreeOf(parked), "fix.ts", "export const fixed = true\n")
          expectState(yield* act(kid, 2, human.approve()), "Finished")
          expect((yield* expectDropped(kid, id)).state._tag).toBe("Closed")
        }),
      withWriter(waitingOn("merged")),
      {},
      undefined,
      forge.layer,
    )
  })

  it("is not merged into the parent when its turn finished before the parent landed", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      [
        ...spawningFirst,
        afterReentry("fix"),
        onPrompt(/Produce the fix\./, reply.artifact("fixed it"), "fix"),
      ],
      (id) =>
        Effect.gen(function* () {
          const kid = yield* replannedToWrite(id, forge.say)
          const fixed = yield* act(kid, 0, human.approve())
          expectState(fixed, "AwaitingHuman", 2)
          writeWork(worktreeOf(fixed), "fix.ts", "export const fixed = true\n")
          expectState(yield* act(kid, 2, human.approve()), "Finished")
          yield* landParent(id)
          expect((yield* expectDropped(kid, id)).state._tag).toBe("Closed")
        }),
      withWriter(waitingOn("merged")),
      {},
      undefined,
      forge.layer,
    )
  })
})

/** The re-entered child's composer, asked a second time, plans read-only work. */
const reenteredToRead = afterReentry("plan")

const runsFix = onPrompt(/Produce the fix\./, reply.artifact("fixed it"), "fix")
const runsPlan = onPrompt(/Produce the plan\./, reply.artifact("looked again"), "plan-again")

/** Approve the `fix` plan, leave a change, approve the step: the child rests holding a write. */
const wroteFix = (kid: TrakId) =>
  Effect.gen(function* () {
    const fixed = yield* act(kid, 0, human.approve())
    expectState(fixed, "AwaitingHuman", 2)
    writeWork(worktreeOf(fixed), "fix.ts", "export const fixed = true\n")
    expectState(yield* act(kid, 2, human.approve()), "Finished")
  })

/** Re-enter a resting child and run the read-only plan its composer answers with. */
const readAgain = (kid: TrakId) =>
  Effect.gen(function* () {
    const replanned = yield* advance(kid, Events.reentered("look again"))
    expect(replanned.state._tag).toBe("AwaitingProposal")
    const ran = yield* act(kid, 0, human.approve())
    expect(ran.state).toMatchObject({ _tag: "AwaitingHuman", kind: "approval" })
    expectState(yield* approveAll(kid, ran), "Finished")
  })

describe("what a child's next merge would carry, whatever came between", () => {
  it("a write before a second re-entry from Finished is still refused once the parent lands", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      [...spawningFirst, afterReentry("fix"), runsFix, reenteredToRead, runsPlan],
      (id) =>
        Effect.gen(function* () {
          const kid = yield* replannedToWrite(id, forge.say)
          yield* wroteFix(kid)
          // A second re-entry hands the child its standing checkout — the write is
          // still on the branch, and only read-only work runs after it.
          yield* readAgain(kid)
          yield* landParent(id)
          expect((yield* expectDropped(kid, id)).state._tag).toBe("Closed")
        }),
      withWriter(waitingOn("merged")),
      {},
      undefined,
      forge.layer,
    )
  })

  it("a write before the landing is still refused after a read-only re-entry made after it", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      [...spawningFirst, afterReentry("fix"), runsFix, reenteredToRead, runsPlan],
      (id) =>
        Effect.gen(function* () {
          const kid = yield* replannedToWrite(id, forge.say)
          yield* wroteFix(kid)
          yield* landParent(id)
          // Re-entered once the parent has landed, the composer may only plan reads —
          // and what it reads on top of is still the write the branch carries.
          yield* readAgain(kid)
          expect((yield* expectDropped(kid, id)).state._tag).toBe("Closed")
        }),
      withWriter(waitingOn("merged")),
      {},
      undefined,
      forge.layer,
    )
  })

  it("a write on a branch that was dropped is not held against the fresh one", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      [...spawningFirst, afterReentry("fix"), runsFix, reenteredToRead, runsPlan],
      (id) =>
        Effect.gen(function* () {
          const kid = yield* replannedToWrite(id, forge.say)
          yield* wroteFix(kid)
          // Archived without merging: the branch and its write go. A later re-entry
          // starts a fresh branch from the parent, and what it reads there merges.
          const dropped = yield* advance(kid, Events.closed())
          expectState(dropped, "Closed")
          yield* readAgain(kid)
          yield* landParent(id)
          const merged = yield* advance(kid, Events.merged())
          expect(merged.state._tag).toBe("Merged")
          expect(yield* inParent(id, "fix.ts")).toBe(false)
        }),
      withWriter(waitingOn("merged")),
      {},
      undefined,
      forge.layer,
    )
  })
})

/** The step the refused composer planned in its place — see `refusedPlan`'s instruction. */
const looksAgain = onPrompt(/Look again\./, reply.artifact("looked again"), "look-again")

/** `fix` files questions rather than a document: the child parks at the answers gate. */
const asksFix = onPrompt(/Produce the fix\./, reply.questions("which env?"), "fix-asks")

describe("a write step's edits that a later read-only commit carried", () => {
  it("are dropped when a chat at the writer's gate is refused after the landing", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      [...spawningFirst, afterReentry("fix"), runsFix, refusedPlan, looksAgain],
      (id) =>
        Effect.gen(function* () {
          const kid = yield* replannedToWrite(id, forge.say)
          const fixed = yield* act(kid, 0, human.approve())
          expectState(fixed, "AwaitingHuman", 2)
          writeWork(worktreeOf(fixed), "fix.ts", "export const fixed = true\n")
          yield* landParent(id)
          // A chat resumes the writer's turn, which the landing now refuses: the
          // composer re-plans reads, and the read-only commit carries the edit.
          const asked = yield* act(kid, 2, human.chat("and the other env?"))
          expect(asked.state._tag).toBe("AwaitingProposal")
          expect(yield* logTags(kid)).toContain("StepRefused")
          const ran = yield* act(kid, 0, human.approve())
          expectState(yield* approveAll(kid, ran), "Finished")
          expect((yield* expectDropped(kid, id)).state._tag).toBe("Closed")
        }),
      withWriter(waitingOn("merged")),
      {},
      undefined,
      forge.layer,
    )
  })

  it("are dropped when a replan at the writer's answers gate leaves them uncommitted", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      [...spawningFirst, afterReentry("fix"), asksFix, afterReplan("plan"), runsPlan],
      (id) =>
        Effect.gen(function* () {
          const kid = yield* replannedToWrite(id, forge.say)
          const asking = yield* act(kid, 0, human.approve())
          expect(asking.state).toMatchObject({ _tag: "AwaitingHuman", step: 2, kind: "answers" })
          writeWork(worktreeOf(asking), "fix.ts", "export const fixed = true\n")
          yield* landParent(id)
          // Nothing is committed on the way to the composer; the next commit is a
          // read-only step's, and it carries the writer's edit.
          const replanned = yield* act(kid, 2, human.replan("skip the fix, just look"))
          expect(replanned.state._tag).toBe("AwaitingProposal")
          const ran = yield* act(kid, 0, human.approve())
          expectState(yield* approveAll(kid, ran), "Finished")
          expect((yield* expectDropped(kid, id)).state._tag).toBe("Closed")
        }),
      withWriter(waitingOn("merged")),
      {},
      undefined,
      forge.layer,
    )
  })
})

const runsWork = onPrompt(/Produce the work\./, reply.artifact("checked it"), "work-again")

describe("what git says the merge would carry, not what the log recorded", () => {
  it("drops a commit a person made by hand in a read-only child's checkout", async () => {
    const forge = movingForge()
    await onGit.runFlowWithAgentLog(
      spawning,
      (id) =>
        Effect.gen(function* () {
          const kid = yield* childOfLanded(id, forge.say)
          // Nothing in the log: no turn ran, no `CommitWork` recorded it.
          writeWork(worktreeOf(kid), "hand.ts", "export const byHand = true\n")
          commitInWorktree(worktreeOf(kid), "by hand")
          const dropped = yield* advance(kid.id, Events.merged())
          expect(dropped.state._tag).toBe("Closed")
          expect(yield* logTags(kid.id)).toContain("ChangesDropped")
          expect(yield* inParent(id, "hand.ts")).toBe(false)
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })

  it("merges a child merged before the landing and kept, when nothing changed after, and delivers what it filed", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      [...spawningFirst, afterReentry("fix", "work"), runsFix, runsWork],
      (id) =>
        Effect.gen(function* () {
          // The re-entered child writes, then holds on `work`'s own `merged` wait.
          const kid = yield* replannedToWrite(id, forge.say, ["plan", "compose", "fix", "work"])
          const fixed = yield* act(kid, 0, human.approve())
          expectState(fixed, "AwaitingHuman", 2)
          writeWork(worktreeOf(fixed), "fix.ts", "export const fixed = true\n")
          const held = yield* act(kid, 2, human.approve())
          expectState(held, "Finished")
          expect(waitingAt(held)).toMatchObject({ name: "merged", stopped: false })

          // Merged before the parent lands: the branch goes into the parent's checkout,
          // the checkout stays, and `work` runs on it without changing anything.
          const kept = yield* advance(kid, Events.merged())
          expectState(kept, "AwaitingHuman", 3)
          expect(yield* inParent(id, "fix.ts")).toBe(true)
          expectState(yield* act(kid, 3, human.approve()), "Finished")

          yield* landParent(id)
          const merged = yield* advance(kid, Events.merged())
          expect(merged.state._tag).toBe("Merged")
          expect(yield* logTags(kid)).not.toContain("ChangesDropped")
          // The checkout was kept past the first merge, and the child ran on: `fix`'s
          // and `work`'s documents reach the parent now, under the same piece.
          yield* expectRefiled(merged, id)
        }),
      withWriter(waitingOn("merged")),
      {},
      undefined,
      forge.layer,
    )
  })
})

describe("a landed child that is sent back", () => {
  it("delivers what it files after that when it merges again, without moving the parent", async () => {
    const forge = movingForge()
    await runFlowWithAgentLog(
      [...spawningFirst, afterReentry("plan"), runsPlan],
      (id) =>
        Effect.gen(function* () {
          const kid = yield* landedOnce(id, forge.say)
          const parent = yield* trakOf(id)
          expect(parent.artifacts.has(`${PIECE}/0-plan`)).toBe(true)
          // Sent back from `Merged`, it reads again and merges again — before the
          // parent lands, so nothing is dropped and the parent is still on its wait.
          yield* readAgain(kid)
          const merged = yield* advance(kid, Events.merged())
          expect(merged.state._tag).toBe("Merged")
          yield* expectRefiled(merged, id)
          expect(waitingAt(yield* trakOf(id))).toMatchObject({ name: "merged", stopped: false })
        }),
      waitingOn("merged"),
      {},
      undefined,
      forge.layer,
    )
  })
})
