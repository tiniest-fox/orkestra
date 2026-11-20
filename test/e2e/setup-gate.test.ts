// The project's setup script in the background: a trak's first turn starts beside it,
// what needs it waits for it, and its failure stops the trak with what it printed.
//
// The scripted CLI holds no command while setup runs, as Codex holds none, so its turns
// wait for setup before they start. The cases about a turn starting beside setup hand the
// engine a provider that says it holds them, as Claude's hook does — the hook itself is
// the provider's, and `argv.test.ts` reads the file it is written to.

import * as fs from "node:fs"
import * as path from "node:path"
import { Deferred, Effect, Fiber, Schedule } from "effect"
import { describe, expect, it } from "vitest"
import { Provider } from "../../src/agent/ports/provider.js"
import type { Check } from "../../src/library/types/check.js"
import type { Worktree } from "../../src/vcs/index.js"
import { Events } from "../../src/workflow/domain/event.js"
import { Store } from "../../src/workflow/ports/store.js"
import { advance } from "../../src/workflow/runtime.js"
import { Drives } from "../../src/app/drive.js"
import { composer, composerRuns, step, stepHangs, stepRuns } from "../support/flow.js"
import { worktreeOf } from "../support/git.js"
import {
  act,
  create,
  expectAwaiting,
  expectAwaitingProposal,
  human,
  idle,
  logged,
  logTags,
} from "../support/scenario.js"
import { library, workDeclaring } from "../support/library.js"
import { onResume, reply } from "../support/scripted-agent.js"
import { fail, heldBack, pass } from "../support/scripted-checks.js"
import { runFlowWithAgentLog } from "../support/flow.js"
import { Vcs } from "../../src/vcs/ports/vcs.js"
import { Preparation } from "../../src/vcs/ports/preparation.js"
import { PreparingPhase } from "../../src/vcs/types/preparing.js"

const setup: Check = {
  name: "setup",
  description: "Installs dependencies.",
  timeoutSeconds: 60,
  askedEverySeconds: undefined,
  exclusive: false,
  cache: true,
  ignoresLinguistGenerated: false,
  units: undefined,
  cacheAcross: "platform" as const,
  path: "/nowhere/setup.sh",
}

const verify: Check = { ...setup, name: "verify", path: "/nowhere/verify.sh" }

/** `work` declaring `verify`, beside the setup script. */
const withChecks = workDeclaring(["verify"], { setup, checks: new Map([["verify", verify]]) })

/** `effect` run with a provider that holds a turn's commands while setup runs. */
const holdingCommands = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.provideServiceEffect(
    effect,
    Provider,
    Effect.map(Provider, (provider) => ({ ...provider, gatesCommandsFor: () => true })),
  )

/** Whether a log's tags hold `tag` — what `logged` waits on. */
const has =
  (tag: string) =>
  (tags: readonly string[]): boolean =>
    tags.includes(tag)

/** The preparation a surface would be told the trak is in. */
const preparingOf = (id: string) => Effect.flatMap(Preparation, (p) => p.of(id))

/** What the hook reads in a checkout. */
const status = (worktree: Worktree): string =>
  fs.readFileSync(path.join(worktree.path, ".orkestra", ".setup", "status"), "utf8")

const ranSetup = (log: { readonly ran: readonly string[] }): number =>
  log.ran.filter((name) => name === "setup").length

describe("a turn beside a setup still running", () => {
  it("starts the composer before setup ends, its commands held on the status file", async () => {
    const release = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [composer("work")],
      (id, agentLog) =>
        Effect.gen(function* () {
          const trak = yield* holdingCommands(create(id, "Add a --json flag"))
          const worktree = worktreeOf(trak)

          expectAwaitingProposal(trak)
          expect(trak.setup).toBe("running")
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "SetupStarted",
            "WorktreeReady",
            "ComposerReturned",
          ])
          expect(composerRuns(yield* agentLog)[0]?.setupGate).toEqual({
            statusFile: path.join(worktree.path, ".orkestra", ".setup", "status"),
            waitSeconds: setup.timeoutSeconds + 60,
          })
          expect(status(worktree)).toBe("running\n")
          // What a surface is told while the turn runs ahead of it.
          expect(yield* preparingOf(id)).toEqual(PreparingPhase.SetupBeside())

          yield* Deferred.succeed(release, undefined)
          yield* logged(id, has("SetupPassed"))
          expect(status(worktree)).toBe("passed\n")
          expect(yield* preparingOf(id)).toBeUndefined()
        }),
      library({ setup }),
      { setup: [heldBack(Deferred.await(release), pass)] },
    )
  })

  it("holds a step's checks until setup ends", async () => {
    const release = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("done"))],
      (id, agentLog, checksLog) =>
        Effect.gen(function* () {
          yield* holdingCommands(create(id, "Add a --json flag"))
          const approved = yield* Effect.fork(holdingCommands(act(id, 0, human.approve())))
          // The step's turn has answered, and its checks are waiting on setup.
          yield* logged(id, has("AgentReturned"))
          expect(stepRuns(yield* agentLog)).toHaveLength(1)
          expect((yield* checksLog).ran).toEqual(["setup"])

          yield* Deferred.succeed(release, undefined)
          expectAwaiting(yield* Fiber.join(approved), "approval")
          expect((yield* checksLog).ran).toEqual(["setup", "verify"])
          expect((yield* logTags(id)).slice(-3)).toEqual([
            "AgentReturned",
            "SetupPassed",
            "ChecksPassed",
          ])
        }),
      withChecks,
      { setup: [heldBack(Deferred.await(release), pass)] },
    )
  })
})

describe("a setup that fails beside a turn", () => {
  it("kills the turn when setup fails, fails the trak with what it printed, and a retry runs it again", async () => {
    const release = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [
        composer("work"),
        stepHangs(1, "work"),
        onResume(reply.artifact("done"), "resumed after setup"),
      ],
      (id, agentLog, checksLog) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* holdingCommands(create(id, "Add a --json flag")))
          const approved = yield* Effect.fork(holdingCommands(act(id, 0, human.approve())))
          yield* logged(id, has("ConditionsMet"))
          yield* Effect.repeat(agentLog, {
            until: (log) => stepRuns(log).length === 1,
            schedule: Schedule.spaced("1 millis"),
          })
          const session = stepRuns(yield* agentLog)[0]?.sessionId

          yield* Deferred.succeed(release, undefined)
          const failed = yield* Fiber.join(approved)
          expect(failed.state).toMatchObject({
            _tag: "Failed",
            kind: "worktree",
            setup: "no lockfile",
          })
          expect(failed.state._tag === "Failed" ? failed.state.error : "").toContain(
            `setup failed in ${worktree.path}:\nno lockfile`,
          )
          expect(failed.failedFrom).toMatchObject({ _tag: "AgentWorking", step: 1 })
          const events = yield* (yield* Store).events(id)
          expect(events.at(-1)).toMatchObject({
            _tag: "SetupFailed",
            sessionId: session,
            step: 1,
          })
          // What a command the hook holds is refused with.
          expect(status(worktree)).toMatch(/^failed\n/)
          expect(status(worktree)).toContain("no lockfile")

          const retried = yield* holdingCommands(advance(id, Events.restarted(undefined)))
          expectAwaiting(retried, "approval")
          expect(ranSetup(yield* checksLog)).toBe(2)
          // The killed turn's conversation is the one the retry carries on.
          expect(stepRuns(yield* agentLog)[1]?.resumeFrom).toBe(session)
          // The resumed turn and the second setup run side by side, so their two endings
          // land in either order; the checks wait for setup, so they come last.
          const tags = yield* logTags(id)
          const retry = tags.lastIndexOf("SetupFailed")
          expect(tags.slice(retry, retry + 3)).toEqual(["SetupFailed", "Restarted", "SetupStarted"])
          expect(tags.slice(retry + 3, -1).sort()).toEqual(["AgentReturned", "SetupPassed"])
          expect(tags.at(-1)).toBe("ChecksPassed")
        }),
      library({ setup }),
      { setup: [heldBack(Deferred.await(release), fail("no lockfile")), pass] },
    )
  })
})

describe("a turn on a CLI that cannot hold its commands", () => {
  it("starts only once setup has passed, and is handed no gate", async () => {
    const release = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [composer("work")],
      (id, agentLog) =>
        Effect.gen(function* () {
          const created = yield* Effect.fork(create(id, "Add a --json flag"))
          yield* logged(id, has("WorktreeReady"))
          expect((yield* agentLog).requests).toHaveLength(0)
          expect(yield* preparingOf(id)).toEqual(PreparingPhase.SetupBeside())

          yield* Deferred.succeed(release, undefined)
          expectAwaitingProposal(yield* Fiber.join(created))
          const requests = (yield* agentLog).requests
          expect(requests).toHaveLength(1)
          expect(requests[0]?.setupGate).toBeUndefined()
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "SetupStarted",
            "WorktreeReady",
            "SetupPassed",
            "ComposerReturned",
          ])
        }),
      library({ setup }),
      { setup: [heldBack(Deferred.await(release), pass)] },
    )
  })
})

/** A checkout made the way `SetupWorktree` makes one, and a log that stops after it. */
const seeded = (id: Parameters<typeof advance>[0], started: boolean) =>
  Effect.gen(function* () {
    const worktree = yield* (yield* Vcs).createWorktree(id)
    const store = yield* Store
    yield* store.append(
      id,
      [
        Events.trakCreated("Add a --json flag"),
        ...(started ? [Events.setupStarted()] : []),
        Events.worktreeReady(worktree),
      ],
      { after: 0 },
    )
  }).pipe(Effect.orDie)

describe("setup after a restart", () => {
  it("runs it again where the log says it started and never ended", async () => {
    // The engine that started it went, and this one has no run in memory for it.
    await runFlowWithAgentLog(
      [composer("work")],
      (id, _agentLog, checksLog) =>
        Effect.gen(function* () {
          yield* seeded(id, true)
          expectAwaitingProposal(yield* advance(id, Events.restarted(undefined)))
          expect(ranSetup(yield* checksLog)).toBe(1)
          // Nothing new started: the log already says it had.
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "SetupStarted",
            "WorktreeReady",
            "Restarted",
            "SetupPassed",
            "ComposerReturned",
          ])
        }),
      library({ setup }),
      { setup: [pass] },
    )
  })

  it("does not run it on a log written before setup ran in the background", async () => {
    // There, `WorktreeReady` was written only once setup had passed.
    await runFlowWithAgentLog(
      [composer("work")],
      (id, agentLog, checksLog) =>
        Effect.gen(function* () {
          yield* seeded(id, false)
          const trak = yield* advance(id, Events.restarted(undefined))
          expectAwaitingProposal(trak)
          expect(trak.setup).toBeUndefined()
          expect(ranSetup(yield* checksLog)).toBe(0)
          expect((yield* agentLog).requests[0]?.setupGate).toBeUndefined()
        }),
      library({ setup }),
      { setup: [pass] },
    )
  })
})

/** The press an abandon takes the trak's drive over with. */
const abandoning = () => Events.abandoned("not needed after all")

/** The setup events among a log's tags. */
const setupTags = (tags: readonly string[]): readonly string[] =>
  tags.filter((t) => t.startsWith("Setup"))

/**
 * A setup run that never ends by itself, noting in `ended` whether its checkout is there
 * as it is interrupted. Its outcome is a failure, so a run that leaked one would say so.
 */
const endless = (ended: boolean[], checkout: () => string) =>
  heldBack(
    Effect.never.pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          ended.push(fs.existsSync(checkout()))
        }),
      ),
    ),
    fail("a stale run's failure"),
  )

describe("a setup run whose drive is let go", () => {
  it("ends as this copy lets go of the trak, writes nothing, and the next work runs it again", async () => {
    // As a copy does when another copy wakes it to take the trak over.
    const ended: boolean[] = []
    let checkout = ""
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("done"))],
      (id, _agentLog, checksLog) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* holdingCommands(create(id, "Add a --json flag")))
          checkout = worktree.path
          const before = yield* logTags(id)

          yield* (yield* Drives).letGo(id)
          expect(ended).toEqual([true])
          expect(yield* logTags(id)).toEqual(before)
          expect(status(worktree)).toBe("running\n")
          expect(yield* preparingOf(id)).toBeUndefined()

          // The work after it, as the copy that took the trak over runs it.
          expectAwaiting(yield* holdingCommands(act(id, 0, human.approve())), "approval")
          expect(ranSetup(yield* checksLog)).toBe(2)
          expect(status(worktree)).toBe("passed\n")
          const tags = yield* logTags(id)
          expect(setupTags(tags)).toEqual(["SetupStarted", "SetupPassed"])
        }),
      library({ setup }),
      {
        setup: [endless(ended, () => checkout), pass],
      },
    )
  })

  it("ends before an abandon takes the checkout away", async () => {
    const ended: boolean[] = []
    let checkout = ""
    await runFlowWithAgentLog(
      [composer("work")],
      (id) =>
        Effect.gen(function* () {
          const worktree = worktreeOf(yield* holdingCommands(create(id, "Add a --json flag")))
          checkout = worktree.path

          yield* (yield* Drives).takeOver(id, abandoning)
          yield* idle(id)
          // The script was ended while its checkout was still there, and the checkout is gone.
          expect(ended).toEqual([true])
          expect(fs.existsSync(worktree.path)).toBe(false)
          const tags = yield* logTags(id)
          expect(tags.at(-1)).toBe("WorktreeRemoved")
          expect(setupTags(tags)).toEqual(["SetupStarted"])
        }),
      library({ setup }),
      {
        setup: [endless(ended, () => checkout)],
      },
    )
  })
})
