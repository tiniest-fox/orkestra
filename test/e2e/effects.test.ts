// Effects, end to end: an agent declares them, the engine runs them once the
// step's work is on the branch, and what they printed is the only record that
// anything left the checkout.
//
// The whole theme is the two things that separate an effect from a check — *when*
// it runs, and what a non-zero exit means — so almost every assertion here is
// about the order of the log or about where a failure sends the trak. What a
// script DOES is scripted per test, for `checks.test.ts`'s reason: running `bash`
// is the shell adapter's contract.

import * as fs from "node:fs"
import * as path from "node:path"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { type HttpServerResponse, toWeb } from "@effect/platform/HttpServerResponse"
import { RefusalDto } from "@orkestra/shared/dto/common"
import { composer, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import { worktreeOf } from "../support/git.js"
import {
  act,
  createAndStart,
  expectAwaiting,
  expectState,
  human,
  idle,
  logTags,
} from "../support/scenario.js"
import { mount } from "../support/http.js"
import { actionRoutes } from "../../src/app/routes/actions.js"
import { skipFailedEffect } from "../../src/app/drive.js"
import { workEffecting } from "../support/library.js"
import { did, fail } from "../support/scripted-checks.js"
import { reply } from "../support/scripted-agent.js"
import { BranchName } from "../../src/vcs/index.js"
import { Events } from "../../src/workflow/domain/event.js"
import { GoalId, type TrakId } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import { advance } from "../../src/workflow/runtime.js"

/** A script declared in the project, under `name`. */
const script = (name: string, description: string) => ({
  name,
  description,
  timeoutSeconds: 60,
  askedEverySeconds: undefined,
  exclusive: false,
  cache: true,
  ignoresLinguistGenerated: false,
  units: undefined,
  cacheAcross: "platform" as const,
  path: `/repo/.orkestra/checks/${name}.sh`,
})

const SCRIPTS = new Map([
  [
    "open-pr",
    script("open-pr", "Opens a pull request for this branch, or updates the one it has."),
  ],
  ["notify", script("notify", "Tells the channel the pull request is up.")],
])

/** A fleet whose `work` agent declares the given effects. Policy, not plan. */
const acting = (...effects: readonly string[]) => workEffecting(effects, { checks: SCRIPTS })

/** The one-step plan every test here runs. What differs is the agent's policy. */
const planned = composer("work")

const PR_URL = "https://example.invalid/pull/7"

/** Every effect the log says ran, in order, with what it printed. */
const effectsOn = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    const log = yield* store.events(id)
    return log.flatMap((e) => (e._tag === "EffectsRan" ? e.ran : []))
  })

/** What the log recorded about the effect that could not do it. */
const refusalsOn = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    const log = yield* store.events(id)
    return log.flatMap((e) =>
      e._tag === "EffectFailed" ? [{ name: e.name, output: e.output }] : [],
    )
  })

const { post } = mount(actionRoutes)

/** A response's JSON body, as a thunk for `Effect.promise`. */
const bodyOf = (response: HttpServerResponse) => (): Promise<unknown> => toWeb(response).json()

/** Where the projection puts a step's own artifact, relative to the checkout. */
const FILED = path.join(".orkestra", ".trak", "1-work.md")

describe("an effect runs once the work is on the branch", () => {
  it("keeps what it printed, which is the only record it acted at all", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("Added --json"))],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          expectAwaiting(parked, "approval")
          // Nothing has been sent yet. The gate is the confirmation, so an effect
          // that ran before it would be acting on work nobody had said yes to.
          expect((yield* checks).ran).toEqual([])

          expectState(yield* act(id, 1, human.approve()), "Finished")
          expect((yield* checks).ran).toEqual(["open-pr"])
          expect(yield* effectsOn(id)).toEqual([{ name: "open-pr", output: PR_URL }])
        }),
      acting("open-pr"),
      { "open-pr": [did(PR_URL)] },
    )
  })

  it("runs after the commit's completion and not off the approval", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("done"))],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          yield* act(id, 1, human.approve())
          // The order is the assertion. A script asked to act on a branch whose
          // commit has not landed sees nothing to act on, and firing both off the
          // approval would make that a race rather than a bug.
          expect(yield* logTags(id)).toEqual([
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
            "WorkCommitted",
          ])
        }),
      acting("open-pr"),
      { "open-pr": [did(PR_URL)] },
    )
  })

  it("can read the document the step filed, which is not on disk until it re-projects", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("Added --json"))],
      (id) =>
        Effect.gen(function* () {
          const first = yield* createAndStart(id, "Add a --json flag")
          const worktree = worktreeOf(first)
          // The turn's own projection carries what steps *before* it filed, so the
          // step's artifact is not among the files it was given.
          expect(fs.existsSync(path.join(worktree.path, FILED))).toBe(false)

          yield* act(id, 1, human.approve())
          // One step, so nothing else projects after this: the file can only have
          // been written on the way into the effect.
          expect(fs.readFileSync(path.join(worktree.path, FILED), "utf8")).toContain("Added --json")
        }),
      acting("open-pr"),
      { "open-pr": [did(PR_URL)] },
    )
  })
})

describe("an effect that could not do it", () => {
  it("stops the trak as the project's own failure, never as the agent's", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("done"))],
      (id, agent) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const stopped = yield* act(id, 1, human.approve())

          expectState(stopped, "Failed")
          // `project`, because an unauthenticated `gh` is a file in this repository
          // rather than a defect in the document — and the step wrote a document
          // nobody has complained about.
          expect(stopped.state._tag === "Failed" ? stopped.state.kind : undefined).toBe("project")
          expect(stopped.state._tag === "Failed" ? stopped.state.error : "").toContain("open-pr")
          // One turn: the agent is not sent back to fix something it did not cause.
          expect(stepRuns(yield* agent)).toHaveLength(1)

          // What the script said rides on the event rather than on the state, so a
          // surface draws it beside the time it ran.
          expect(yield* refusalsOn(id)).toEqual([
            { name: "open-pr", output: "gh: not authenticated" },
          ])
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
            "HumanActed",
            "WorkCommitted",
            "EffectFailed",
          ])
        }),
      acting("open-pr"),
      { "open-pr": [fail("gh: not authenticated")] },
    )
  })

  it("goes back to the effects rather than to the turn, and carries on when it works", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("done"))],
      (id, agent, checks) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const stopped = yield* act(id, 1, human.approve())
          // The position a retry re-enters. Re-running is safe because an effect is
          // written to be idempotent — *open one if this branch has not got one*.
          expect(stopped.failedFrom?._tag).toBe("Effecting")

          const done = yield* advance(id, Events.restarted(undefined))
          expectState(done, "Finished")
          expect((yield* checks).ran).toEqual(["open-pr", "open-pr"])
          expect(yield* effectsOn(id)).toEqual([{ name: "open-pr", output: PR_URL }])
          // And no second turn was spent on the way through.
          expect(stepRuns(yield* agent)).toHaveLength(1)
        }),
      acting("open-pr"),
      { "open-pr": [fail("gh: not authenticated"), did(PR_URL)] },
    )
  })
})

describe("skipping an effect that could not do it", () => {
  it("enters what comes next with it and every effect after it unrun, and says which", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("done"))],
      (id, agent, checks) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          expectState(yield* act(id, 1, human.approve()), "Failed")

          const response = yield* post(id, "skip-effects", {})
          expect(response.status).toBe(202)
          yield* idle(id)

          const store = yield* Store
          const log = yield* store.events(id)
          expect(log.at(-2)).toMatchObject({
            _tag: "EffectsRan",
            step: 1,
            ran: [],
            skipped: ["open-pr", "notify"],
          })
          expect(log.at(-1)?._tag).toBe("WorkCommitted")
          // Only the attempt that failed ever ran: the skip ran nothing, `notify` included.
          expect((yield* checks).ran).toEqual(["open-pr"])
          expect(stepRuns(yield* agent)).toHaveLength(1)
        }),
      acting("open-pr", "notify"),
      { "open-pr": [fail("gh: not authenticated")] },
    )
  })

  it("appends nothing where a restart moved the trak after the skip's read", async () => {
    // The route reads the trak, then starts the drive. A restart from another tab that
    // lands between the two leaves the route holding a stale step, which is what
    // `skipFailedEffect` is handed here.
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("done"))],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          expectState(yield* act(id, 1, human.approve()), "Failed")
          expectState(yield* advance(id, Events.restarted(undefined)), "Finished")
          const before = yield* logTags(id)

          yield* Effect.orDie(skipFailedEffect(id, 1, ["open-pr"]))
          yield* idle(id)

          expect(yield* logTags(id)).toEqual(before)
          expect((yield* checks).ran).toEqual(["open-pr", "open-pr"])
        }),
      acting("open-pr"),
      { "open-pr": [fail("gh: not authenticated"), did(PR_URL)] },
    )
  })

  it("refuses a trak no failed effect stopped, and appends nothing", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("done"))],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const before = yield* logTags(id)
          const response = yield* post(id, "skip-effects", {})
          expect(response.status).toBe(409)
          const body: unknown = yield* Effect.promise(bodyOf(response))
          expect(Schema.decodeUnknownSync(RefusalDto)(body)).toStrictEqual({
            _tag: "NoFailedEffect",
          })
          expect(yield* logTags(id)).toEqual(before)
          expect((yield* post("nobody", "skip-effects", {})).status).toBe(404)
        }),
      acting("open-pr"),
      {},
    )
  })
})

describe("a boundary with nothing to send", () => {
  it("passes straight through, and the log says nothing ran", async () => {
    // `decide` cannot see an agent's effects without reading policy, so every step
    // boundary enters `Effecting` and an empty declaration is the degenerate case —
    // `checks.test.ts` makes the same argument one hook earlier.
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("done"))],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const first = yield* createAndStart(id, "Add a --json flag")
          expectState(yield* act(id, 1, human.approve()), "Finished")
          expect((yield* checks).ran).toEqual([])
          expect(yield* logTags(id)).toEqual([
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
            "WorkCommitted",
          ])
          // Nothing to prepare, so nothing was prepared: the re-projection above is
          // paid for only where a script is going to read it.
          expect(fs.existsSync(path.join(worktreeOf(first).path, FILED))).toBe(false)
        }),
      acting(),
      {},
    )
  })

  it("sends nothing for a step a person skipped, which filed nothing to send", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.stuck("could not reach the tracker"))],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          expectAwaiting(parked, "stuck")
          // Carrying on without the step is a real answer, and it is the one shape
          // where the entry still names an agent whose effects would resolve.
          expectState(yield* act(id, 1, human.skip("doing it by hand")), "Finished")
          expect((yield* checks).ran).toEqual([])
        }),
      acting("open-pr"),
      { "open-pr": [did(PR_URL)] },
    )
  })
})

/** A goal's trak, on `goalBranch` where given, approved through its plan and its step. */
const openedForGoal = (id: TrakId, goalBranch?: BranchName) =>
  Effect.gen(function* () {
    const goal = GoalId.make("g-1")
    yield* advance(id, Events.trakForGoal("Ship", "manual", goal, undefined, false, goalBranch))
    yield* act(id, 0, human.approve())
    return yield* act(id, 1, human.approve())
  })

/** What the trak's `open-pr` effect was handed beyond its checkout. */
const effectEnv = async (goalBranch?: BranchName): Promise<unknown> => {
  let env: unknown = "never ran"
  await runFlowWithAgentLog(
    [planned, step(1, "work", reply.artifact("done"))],
    (id, _agent, checks) =>
      Effect.gen(function* () {
        yield* openedForGoal(id, goalBranch)
        const [call] = (yield* checks).calls
        env = call?.name === "open-pr" ? call.env : "open-pr did not run"
      }),
    acting("open-pr"),
    { "open-pr": [did(PR_URL)] },
  )
  return env
}

describe("a goal's trak on a goal branch", () => {
  it("hands its effects the branch its pull request targets", async () => {
    expect(await effectEnv(BranchName.make("goal/ship"))).toEqual({
      ORKESTRA_TARGET_BRANCH: "goal/ship",
    })
  })

  it("hands nothing where its goal has no goal branch", async () => {
    expect(await effectEnv()).toBeUndefined()
  })
})
