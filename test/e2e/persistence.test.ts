// State survives the process. Every other flow test drives one trak through
// one in-memory store inside one `Effect.runPromise` — this is the one theme
// where the point is TWO separate layer sets over the same directory's SQLite store,
// the one an engine with no `ORKESTRA_STORE` keeps, so
// explicit layer construction replaces `runFlow` throughout: what is asserted
// is that a second set agrees with the first, not the sequence within either.
//
// Offline apart from the filesystem: `NoVcsLayer` and a scripted agent, same
// as every other theme — a real worktree is `worktrees.test.ts`'s job, and
// mixing the two here would leave two things to fail explaining one failure.

import { seedLog } from "../support/seed.js"
import { diagramsRefusing } from "../support/diagrams.js"
import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import { SessionId } from "../../src/agent/types/session.js"
import { Transcript } from "../../src/agent/ports/transcript.js"
import { Lib } from "../../src/library/ports/library.js"
import type { Library } from "../../src/library/types/library.js"
import { BranchName, CommitSha, WorktreePath } from "../../src/vcs/index.js"
import { NoVcsLayer } from "../../src/vcs/adapters/none.js"
import { NoWorkspaceLayer } from "../../src/workflow/adapters/workspace-none.js"
import { NoHostedProcessesLayer } from "../../src/workflow/adapters/processes-none.js"
import { BuiltinPromptsLayer } from "../../src/prompts/adapters/builtin.js"
import { TEMPLATES } from "../../src/app/packaged.js"
import { PhraseIdsLayer } from "../../src/workflow/adapters/ids-phrase.js"
import { FileRunsLayer } from "../../src/workflow/adapters/runs-file.js"
import { FilePassesLayer } from "../../src/workflow/adapters/passes-file.js"
import { MemoryTurnToolsLayer } from "../../src/workflow/adapters/turn-tools-memory.js"
import { MemorySetupsLayer } from "../../src/workflow/adapters/setups-memory.js"
import { MemoryLocksLayer } from "../../src/workflow/adapters/locks-memory.js"
import { SqliteStoresLayer } from "../../src/workflow/adapters/store-sqlite.js"
import { Events } from "../../src/workflow/domain/event.js"
import { Actions } from "../../src/workflow/domain/human-action.js"
import { artifact } from "../../src/workflow/domain/outputs/artifact.js"
import { proposal } from "../../src/workflow/domain/outputs/proposal.js"
import { slotAt, TrakId } from "../../src/workflow/domain/trak.js"
import { Checks } from "../../src/workflow/ports/checks.js"
import { EngineVersion } from "../../src/workflow/ports/engine-version.js"
import { Observer } from "../../src/workflow/ports/observer.js"
import { Runs } from "../../src/workflow/ports/runs.js"
import { Store } from "../../src/workflow/ports/store.js"
import { advance, resume } from "../../src/workflow/runtime.js"
import {
  createAndStart,
  ENGINE_VERSION,
  human,
  logTags,
  restartsOn,
  sectionOf,
} from "../support/scenario.js"
import { library, workDeclaring } from "../support/library.js"
import { composer, step, stepRuns } from "../support/flow.js"
import { noPullRequest } from "../support/forge.js"
import { onResume, reply, scriptedAgent, type Turn } from "../support/scripted-agent.js"
import { pass, scriptedChecks } from "../support/scripted-checks.js"
import { inheritedEnvironment } from "../support/scripted-environment.js"

/** A fresh directory that looks like a project — `orkestraDir` needs a marker. */
const newRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "orkestra-persistence-"))
  mkdirSync(join(dir, ".orkestra"), { recursive: true })
  return dir
}

/**
 * One complete set of layers over `dir` — a stand-in for "one `ork` process".
 * Called twice against the same directory is the whole of what this file
 * tests: two independent sets that only agree because the directory does.
 *
 * `checksLayer` defaults to a die-on-run fake — nothing in this theme declares
 * checks — and is overridable for the one test that does (interruption during
 * `CheckRunning`).
 */
const buildLayers = (
  dir: string,
  turns: readonly Turn[],
  checksLayer: Layer.Layer<Checks> = Layer.succeed(Checks, {
    run: () => Effect.die("persistence flow declares no checks"),
    live: () => Effect.succeed(undefined),
  }),
  lib: Library = library(),
) =>
  Effect.map(scriptedAgent(turns), ({ layer: agentLayer, log: agentLog }) => {
    // Named because the mint takes it too: naming a trak asks what the store
    // already holds. `NoVcsLayer` holds no branches, so that is the whole check.
    const store = SqliteStoresLayer(dir)
    return {
      agentLog,
      layers: Layer.mergeAll(
        BuiltinPromptsLayer(TEMPLATES),
        Layer.succeed(EngineVersion, ENGINE_VERSION),
        diagramsRefusing(),
        store,
        FileRunsLayer(dir).pipe(Layer.provide(NodeProcessLayer)),
        FilePassesLayer(dir),
        MemoryLocksLayer,
        PhraseIdsLayer.pipe(Layer.provide(Layer.merge(store, NoVcsLayer))),
        agentLayer,
        checksLayer,
        Layer.succeed(Lib, lib),
        inheritedEnvironment,
        Layer.succeed(Observer, { transition: () => Effect.void, agentEvent: () => Effect.void }),
        Layer.succeed(Transcript, { record: () => Effect.void }),
        NoVcsLayer,
        noPullRequest,
        NoWorkspaceLayer,
        NoHostedProcessesLayer,
        MemoryTurnToolsLayer(undefined),
        MemorySetupsLayer,
      ),
    }
  })

describe("survival", () => {
  it("resuming in a fresh layer set over the same directory rebuilds the identical trak", async () => {
    const dir = newRepo()
    const id = TrakId.make("survives")
    const turns = [composer("work"), step(1, "work", reply.artifact("v1"))]

    const { layers: first } = await Effect.runPromise(buildLayers(dir, turns))
    const parked = await Effect.runPromise(
      createAndStart(id, "do the thing").pipe(Effect.provide(first)),
    )
    expect(parked.state._tag).toBe("AwaitingHuman")

    const { layers: second } = await Effect.runPromise(buildLayers(dir, turns))
    const resumed = await Effect.runPromise(resume(id).pipe(Effect.provide(second)))

    expect(resumed).toEqual(parked)
    expect(await Effect.runPromise(logTags(id).pipe(Effect.provide(second)))).toEqual(
      await Effect.runPromise(logTags(id).pipe(Effect.provide(first))),
    )
  })
})

describe("continuation", () => {
  it("acting at the gate in the resumed process resumes the same agent session", async () => {
    const dir = newRepo()
    const id = TrakId.make("continues")

    const { layers: first } = await Effect.runPromise(
      buildLayers(dir, [composer("work"), step(1, "work", reply.artifact("v1"))]),
    )
    const parked = await Effect.runPromise(
      createAndStart(id, "do the thing").pipe(Effect.provide(first)),
    )
    const originalSession = slotAt(parked, 1).session
    expect(originalSession).toBeDefined()

    const { layers: second, agentLog } = await Effect.runPromise(
      buildLayers(dir, [onResume(reply.artifact("v2"))]),
    )
    const continued = await Effect.runPromise(
      resume(id).pipe(
        Effect.zipRight(advance(id, Events.humanActed(0, human.chat("make it shorter")))),
        Effect.provide(second),
      ),
    )

    expect(sectionOf(continued, "1-work")).toBe("v2")
    const requests = stepRuns(await Effect.runPromise(agentLog))
    expect(requests).toHaveLength(1)
    // The assertion that catches a resume which quietly started a fresh
    // conversation instead of picking up the one the log recorded.
    expect(requests[0]?.resumeFrom).toBe(originalSession)
  })

  it("names on each turn the engine it ran under, across an upgrade between two turns", async () => {
    // Per turn rather than per trak because of exactly this: the roles are read at
    // boot, so the turn after an upgrade ran under a different brief than the ones
    // before it, and a version recorded once at creation would claim otherwise.
    const dir = newRepo()
    const id = TrakId.make("upgraded")
    const { layers: first } = await Effect.runPromise(
      buildLayers(dir, [composer("work"), step(1, "work", reply.artifact("v1"))]),
    )
    await Effect.runPromise(createAndStart(id, "do the thing").pipe(Effect.provide(first)))

    const { layers: second } = await Effect.runPromise(
      buildLayers(dir, [onResume(reply.artifact("v2"))]),
    )
    const turns = await Effect.runPromise(
      resume(id).pipe(
        Effect.zipRight(advance(id, Events.humanActed(0, human.chat("make it shorter")))),
        Effect.zipRight(Effect.flatMap(Store, (store) => store.events(id))),
        Effect.provideService(EngineVersion, "9.9.9"),
        Effect.provide(second),
      ),
    )

    const named = turns.flatMap((e) =>
      e._tag === "ComposerReturned" || e._tag === "AgentReturned"
        ? [[e._tag, e.engineVersion]]
        : [],
    )
    expect(named).toEqual([
      ["ComposerReturned", ENGINE_VERSION],
      ["AgentReturned", ENGINE_VERSION],
      ["AgentReturned", "9.9.9"],
    ])
  })
})

describe("interruption", () => {
  it("a turn interrupted on its own first attempt still resumes the session it recorded", async () => {
    const dir = newRepo()
    const id = TrakId.make("interrupted")
    const sid = SessionId.make(randomUUID())

    // The log a crash before step 0's first turn ever returned would leave:
    // approved through to `AgentWorking(0)`, no `AgentReturned` for it yet —
    // `iterations` for step 0 is still 0, which is the attempt===0 wrinkle.
    const { layers: setup } = await Effect.runPromise(buildLayers(dir, []))
    await Effect.runPromise(
      Effect.flatMap(Store, (store) =>
        seedLog(store, id, [
          Events.trakCreated("do the thing"),
          Events.worktreeReady({
            path: WorktreePath.make("."),
            branch: BranchName.make("(no branch)"),
            base: CommitSha.make("(no base)"),
          }),
          Events.composerReturned(
            SessionId.make(randomUUID()),
            proposal("Add a --json flag", [{ agent: "work", instruction: "do it" }]),
          ),
          Events.humanActed(0, Actions.approve()),
        ]),
      ).pipe(Effect.provide(setup)),
    )
    // What `SpawnStep` would have written to `run.json` just before spawning,
    // and never got the chance to clear.
    mkdirSync(join(dir, ".orkestra", ".database", "traks", id), { recursive: true })
    writeFileSync(
      join(dir, ".orkestra", ".database", "traks", id, "run.json"),
      JSON.stringify({ holder: { pid: 999_999, startedAt: 0 }, turn: { step: 0, sessionId: sid } }),
    )

    const { layers, agentLog } = await Effect.runPromise(
      buildLayers(dir, [onResume(reply.artifact("v1"))]),
    )
    const interrupted = await Effect.runPromise(
      Effect.scoped(Effect.flatMap(Runs, (runs) => runs.adopt(id))).pipe(Effect.provide(layers)),
    )
    expect(interrupted).toEqual({ step: 0, sessionId: sid, agentPid: undefined })

    const final = await Effect.runPromise(
      advance(id, Events.restarted(interrupted?.sessionId)).pipe(Effect.provide(layers)),
    )
    expect(await Effect.runPromise(logTags(id).pipe(Effect.provide(layers)))).toEqual([
      "TrakCreated",
      "WorktreeReady",
      "ComposerReturned",
      "HumanActed",
      "Restarted",
      "AgentReturned",
      "ChecksPassed",
    ])
    expect(sectionOf(final, "1-work")).toBe("v1")

    // The restart is that turn's only ending, so it names the position — stamped
    // from the same `run.json` the session came from, and not by the caller: this
    // one is `advance` reached directly, which is the shape the child pick-up has
    // and the shape that used to leave the turn with no ending at all.
    expect(await Effect.runPromise(restartsOn(id).pipe(Effect.provide(layers)))).toEqual([
      Events.restarted(sid, 0),
    ])

    const requests = stepRuns(await Effect.runPromise(agentLog))
    expect(requests).toHaveLength(1)
    expect(requests[0]?.resumeFrom).toBe(sid)
  })
})

describe("interruption during a check", () => {
  it("is detected with no run.json turn record at all", async () => {
    const dir = newRepo()
    const id = TrakId.make("interrupted-checks")

    // Only `Compose` and `SpawnStep` ever write a `turn` to `run.json` —
    // `RunChecks` never does, so a crash while a check is running leaves no
    // custody record whatsoever. Detecting the interruption has to come from
    // the state alone: `CheckRunning` is neither parked nor terminal.
    const { layers: setup } = await Effect.runPromise(buildLayers(dir, []))
    await Effect.runPromise(
      Effect.flatMap(Store, (store) =>
        seedLog(store, id, [
          Events.trakCreated("do the thing"),
          Events.worktreeReady({
            path: WorktreePath.make("."),
            branch: BranchName.make("(no branch)"),
            base: CommitSha.make("(no base)"),
          }),
          Events.composerReturned(
            SessionId.make(randomUUID()),
            proposal("Add a --json flag", [{ agent: "work", instruction: "do it" }]),
          ),
          Events.humanActed(0, Actions.approve()),
          Events.agentReturned(0, SessionId.make(randomUUID()), artifact({ Summary: "v1" })),
        ]),
      ).pipe(Effect.provide(setup)),
    )

    const replayed = await Effect.runPromise(resume(id).pipe(Effect.provide(setup)))
    expect(replayed.state._tag).toBe("CheckRunning")

    const { layer: checksLayer, log: checksLog } = await Effect.runPromise(
      scriptedChecks({ verify: [pass] }),
    )
    // The agent declares the check now, so the fleet is what carries it.
    const lib = workDeclaring(["verify"], {
      checks: new Map([
        [
          "verify",
          {
            name: "verify",
            description: "verifies",
            timeoutSeconds: 60,
            askedEverySeconds: undefined,
            exclusive: false,
            cache: true,
            ignoresLinguistGenerated: false,
            units: undefined,
            cacheAcross: "platform" as const,
            path: "/bin/true",
          },
        ],
      ]),
    })
    const { layers } = await Effect.runPromise(buildLayers(dir, [], checksLayer, lib))

    const interrupted = await Effect.runPromise(
      Effect.scoped(Effect.flatMap(Runs, (runs) => runs.adopt(id))).pipe(Effect.provide(layers)),
    )
    // Nothing to report: the state is the only signal here, not the run record.
    expect(interrupted).toBeUndefined()

    const final = await Effect.runPromise(
      advance(id, Events.restarted(undefined)).pipe(Effect.provide(layers)),
    )
    expect(await Effect.runPromise(logTags(id).pipe(Effect.provide(layers)))).toEqual([
      "TrakCreated",
      "WorktreeReady",
      "ComposerReturned",
      "HumanActed",
      "AgentReturned",
      "Restarted",
      "ChecksPassed",
    ])
    expect((await Effect.runPromise(checksLog)).ran).toEqual(["verify"])
    expect(final.state._tag).toBe("AwaitingHuman")

    // The other side of the stamp: no record, so the restart names no turn — and
    // that is the honest answer here, because the turn this trak was in the middle
    // of already ended in the `AgentReturned` above.
    expect(await Effect.runPromise(restartsOn(id).pipe(Effect.provide(layers)))).toEqual([
      Events.restarted(undefined),
    ])
  })
})

describe("isolation", () => {
  it("two traks driven through one directory end with complete, separate logs", async () => {
    const dir = newRepo()
    const idA = TrakId.make("isolate-a")
    const idB = TrakId.make("isolate-b")

    const { layers: layersA } = await Effect.runPromise(
      buildLayers(dir, [composer("work"), step(1, "work", reply.artifact("va"))]),
    )
    const { layers: layersB } = await Effect.runPromise(
      buildLayers(dir, [composer("work"), step(1, "work", reply.artifact("vb"))]),
    )

    const a = await Effect.runPromise(createAndStart(idA, "trak a").pipe(Effect.provide(layersA)))
    const b = await Effect.runPromise(createAndStart(idB, "trak b").pipe(Effect.provide(layersB)))

    expect(sectionOf(a, "1-work")).toBe("va")
    expect(sectionOf(b, "1-work")).toBe("vb")
    expect(await Effect.runPromise(logTags(idA).pipe(Effect.provide(layersA)))).toHaveLength(7)
    expect(await Effect.runPromise(logTags(idB).pipe(Effect.provide(layersB)))).toHaveLength(7)

    // Reading trak A through B's layer set (same directory) sees the same
    // log — it is the directory that is shared, not the JS objects.
    const aViaB = await Effect.runPromise(resume(idA).pipe(Effect.provide(layersB)))
    expect(aViaB).toEqual(a)
  })
})

describe("wipe", () => {
  it("removing one trak leaves the other replaying correctly", async () => {
    const dir = newRepo()
    const idA = TrakId.make("wipe-a")
    const idB = TrakId.make("wipe-b")

    const { layers: layersA } = await Effect.runPromise(
      buildLayers(dir, [composer("work"), step(1, "work", reply.artifact("va"))]),
    )
    await Effect.runPromise(createAndStart(idA, "a").pipe(Effect.provide(layersA)))

    const { layers: layersB } = await Effect.runPromise(
      buildLayers(dir, [composer("work"), step(1, "work", reply.artifact("vb"))]),
    )
    await Effect.runPromise(createAndStart(idB, "b").pipe(Effect.provide(layersB)))

    await Effect.runPromise(
      Effect.flatMap(Store, (store) => store.remove(idA)).pipe(Effect.provide(layersA)),
    )

    expect(await Effect.runPromise(logTags(idA).pipe(Effect.provide(layersA)))).toEqual([])
    expect(await Effect.runPromise(logTags(idB).pipe(Effect.provide(layersA)))).toHaveLength(7)
  })

  it("a claim closed before the remove does not resurrect the trak directory", async () => {
    // Regression test: `runs.claim`'s release re-writes `run.json`, which
    // unconditionally recreates the trak directory. Closing the claim's scope
    // before `store.remove` runs — what `ork wipe <id>` now does — must leave
    // the trak gone; wrapping the remove inside the claim's scope instead is
    // exactly the bug this guards against.
    const dir = newRepo()
    const id = TrakId.make("wipe-claimed")
    const { layers } = await Effect.runPromise(
      buildLayers(dir, [composer("work"), step(1, "work", reply.artifact("v"))]),
    )
    await Effect.runPromise(createAndStart(id, "solo").pipe(Effect.provide(layers)))

    await Effect.runPromise(
      Effect.gen(function* () {
        const runs = yield* Runs
        const store = yield* Store
        yield* Effect.scoped(runs.adopt(id))
        yield* store.remove(id)
      }).pipe(Effect.provide(layers)),
    )

    const ids = await Effect.runPromise(
      Effect.flatMap(Store, (store) => store.list()).pipe(Effect.provide(layers)),
    )
    expect(ids).not.toContain(id)
  })
})
