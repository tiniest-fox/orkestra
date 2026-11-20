// The file adapter against a real, throwaway `.orkestra` directory, plus a
// scripted `Process` so liveness, start times and kills are deterministic —
// nothing here sleeps and no real subprocess is spawned.
//
// The shared contract in `runs.ts` only proves what both implementations can
// promise identically. Recovering a dead holder's interrupted turn, and the
// reaper's kill/decline decision, both depend on a real liveness check that
// only this adapter has a `Process` to perform — seeded by hand here the same
// way `store.ts`'s `corrupt` capability writes a bad line directly to disk.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { Process, type ProcessShape } from "../../src/agent/ports/process.js"
import { SessionId } from "../../src/agent/types/session.js"
import { FileRunsLayer } from "../../src/workflow/adapters/runs-file.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { Leaving } from "../../src/workflow/ports/leaving.js"
import { Reaped, Runs } from "../../src/workflow/ports/runs.js"
import { runsContract } from "./runs.js"

interface Scripted {
  readonly alive: ReadonlySet<number>
  /** What `ps` would print for each pid's start; a pid not here cannot be read. */
  readonly startTimes: ReadonlyMap<number, string>
}

const scriptedProcess = (
  opts: Scripted,
  killed: number[],
  stopped: string[] = [],
): Layer.Layer<Process> =>
  Layer.succeed(Process, {
    spawn: () => Effect.die("not used by the Runs contract"),
    isAlive: (pid) => Effect.succeed(opts.alive.has(pid)),
    kill: (pid) =>
      Effect.sync(() => {
        killed.push(pid)
      }),
    startTime: (pid) => Effect.succeed(opts.startTimes.get(pid)),
    killExec: (sandbox, execId) =>
      Effect.sync(() => {
        stopped.push(`${sandbox} ${execId}`)
      }),
  } satisfies ProcessShape)

runsContract({
  label: "file",
  layer: () => {
    const scratchDir = mkdtempSync(join(tmpdir(), "orkestra-runs-"))
    mkdirSync(join(scratchDir, ".orkestra"), { recursive: true })
    // Alive by default: the shared contract's "custody is exclusive" cases
    // need `isAlive(process.pid)` (this test process) to be true.
    return FileRunsLayer(scratchDir).pipe(
      Layer.provide(scriptedProcess({ alive: new Set([process.pid]), startTimes: new Map() }, [])),
    )
  },
})

// ============================================================================
// Recovery and reaping — file-only, seeded by hand
// ============================================================================

const sid = SessionId.make("00000000-0000-4000-8000-00000000aaaa")

const newScratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "orkestra-runs-"))
  mkdirSync(join(dir, ".orkestra"), { recursive: true })
  return dir
}

const runJson = (scratchDir: string, id: TrakId): string =>
  join(scratchDir, ".orkestra", ".database", "traks", id, "run.json")

/** Writes `run.json` exactly as a crashed process would have left it. */
const seedRun = (
  scratchDir: string,
  id: TrakId,
  record: {
    readonly holder?: { readonly pid: number; readonly startedAt: number; readonly start?: string }
    readonly turn?: {
      readonly step?: number
      readonly sessionId: string
      readonly agentPid?: number
      readonly agentStart?: string
      readonly execId?: string
      readonly detached?: true
    }
  },
): void => {
  const dir = join(scratchDir, ".orkestra", ".database", "traks", id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "run.json"), JSON.stringify(record))
}

describe("Runs contract: file — recovery", () => {
  it("takes over a trak whose holder is dead, and reports the turn it left in flight", async () => {
    const scratchDir = newScratch()
    const id = TrakId.make("dead-holder")
    seedRun(scratchDir, id, {
      holder: { pid: 999_001, startedAt: 0 },
      turn: { step: 2, sessionId: sid, agentPid: 999_002 },
    })
    const killed: number[] = []
    const layer = FileRunsLayer(scratchDir).pipe(
      Layer.provide(scriptedProcess({ alive: new Set(), startTimes: new Map() }, killed)),
    )

    const interrupted = await Effect.runPromise(
      Effect.scoped(Effect.flatMap(Runs, (runs) => runs.adopt(id))).pipe(Effect.provide(layer)),
    )
    expect(interrupted).toEqual({
      step: 2,
      sessionId: sid,
      agentPid: 999_002,
      agentStart: undefined,
    })
  })
})

describe("Runs contract: file — reading custody without taking it", () => {
  it("reports nobody for a holder that is no longer alive, and leaves the record where it found it", async () => {
    // Both halves matter. The answer is what `ork list` prints; the untouched
    // file is the reason `holder` exists at all rather than being `claim` —
    // `claim` would have cleared this record and taken the trak over.
    const scratchDir = newScratch()
    const id = TrakId.make("dead-holder-read")
    seedRun(scratchDir, id, {
      holder: { pid: 999_011, startedAt: 0 },
      turn: { step: 1, sessionId: sid, agentPid: 999_012 },
    })
    const before = readFileSync(runJson(scratchDir, id), "utf8")
    const layer = FileRunsLayer(scratchDir).pipe(
      Layer.provide(scriptedProcess({ alive: new Set(), startTimes: new Map() }, [])),
    )

    const held = await Effect.runPromise(
      Effect.flatMap(Runs, (runs) => runs.holder(id)).pipe(Effect.provide(layer)),
    )
    expect(held).toBeUndefined()
    expect(readFileSync(runJson(scratchDir, id), "utf8")).toEqual(before)
  })

  it("reports a live holder, and when it started", async () => {
    const scratchDir = newScratch()
    const id = TrakId.make("live-holder-read")
    seedRun(scratchDir, id, { holder: { pid: 999_013, startedAt: 0 } })
    const layer = FileRunsLayer(scratchDir).pipe(
      Layer.provide(scriptedProcess({ alive: new Set([999_013]), startTimes: new Map() }, [])),
    )

    const held = await Effect.runPromise(
      Effect.flatMap(Runs, (runs) => runs.holder(id)).pipe(Effect.provide(layer)),
    )
    // `startedAt` comes back off the record rather than being read from a clock
    // here, which is what makes *running for 2m* a projection rather than an
    // invention at the boundary.
    expect(held).toEqual({ pid: 999_013, startedAt: 0 })
  })

  it("reports nobody for a trak directory that has no run.json at all", async () => {
    // The common case: every trak starts with none, and `list` walks traks it
    // has never held. Absent must be absent, not an error.
    const scratchDir = newScratch()
    const id = TrakId.make("no-run-json")
    mkdirSync(join(scratchDir, ".orkestra", ".database", "traks", id), { recursive: true })
    const layer = FileRunsLayer(scratchDir).pipe(
      Layer.provide(scriptedProcess({ alive: new Set(), startTimes: new Map() }, [])),
    )

    const held = await Effect.runPromise(
      Effect.flatMap(Runs, (runs) => runs.holder(id)).pipe(Effect.provide(layer)),
    )
    expect(held).toBeUndefined()
  })
})

const STARTED = "Thu Sep 17 09:50:08 2026"

/** A stray as a crashed daemon leaves it: a dead holder and a recorded agent. */
const seedStray = (
  scratchDir: string,
  id: TrakId,
  agent: { readonly pid: number; readonly start?: string; readonly execId?: string },
): void =>
  seedRun(scratchDir, id, {
    holder: { pid: 999_003, startedAt: 0 },
    turn: {
      step: 0,
      sessionId: sid,
      agentPid: agent.pid,
      ...(agent.start === undefined ? {} : { agentStart: agent.start }),
      ...(agent.execId === undefined ? {} : { execId: agent.execId }),
    },
  })

const reapWith = (
  scratchDir: string,
  proc: Scripted,
): Promise<{
  readonly results: readonly Reaped[]
  readonly killed: readonly number[]
  readonly stopped: readonly string[]
}> => {
  const killed: number[] = []
  const stopped: string[] = []
  const layer = FileRunsLayer(scratchDir).pipe(
    Layer.provide(scriptedProcess(proc, killed, stopped)),
  )
  return Effect.runPromise(
    Effect.flatMap(Runs, (runs) => runs.reap()).pipe(
      Effect.provide(layer),
      Effect.map((results) => ({ results, killed, stopped })),
    ),
  )
}

describe("Runs contract: file — recording the agent", () => {
  it("records the pid with its start time read back from the process, so the reaper compares like with like", async () => {
    // The wall clock at spawn would never equal what `ps` prints — that is whole
    // seconds — and a reaper comparing the two would decline every stray silently.
    const scratchDir = newScratch()
    const id = TrakId.make("spawned-with-start")
    const layer = FileRunsLayer(scratchDir).pipe(
      Layer.provide(
        scriptedProcess(
          { alive: new Set([process.pid]), startTimes: new Map([[999_020, STARTED]]) },
          [],
        ),
      ),
    )
    const recorded = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runs = yield* Runs
          yield* runs.turn(id, {
            step: 1,
            sessionId: sid,
            agentPid: undefined,
            agentStart: undefined,
            usage: undefined,
            estimate: undefined,
          })
          yield* runs.spawned(id, 999_020)
          return yield* runs.inFlight(id)
        }),
      ).pipe(Effect.provide(layer)),
    )
    expect(recorded).toEqual({ step: 1, sessionId: sid, agentPid: 999_020, agentStart: STARTED })
  })

  it("records the pid alone when its start cannot be read, which the reaper then declines", async () => {
    const scratchDir = newScratch()
    const id = TrakId.make("spawned-unreadable")
    const layer = FileRunsLayer(scratchDir).pipe(
      Layer.provide(scriptedProcess({ alive: new Set([process.pid]), startTimes: new Map() }, [])),
    )
    const recorded = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runs = yield* Runs
          yield* runs.turn(id, {
            step: 1,
            sessionId: sid,
            agentPid: undefined,
            agentStart: undefined,
            usage: undefined,
            estimate: undefined,
          })
          yield* runs.spawned(id, 999_021)
          return yield* runs.inFlight(id)
        }),
      ).pipe(Effect.provide(layer)),
    )
    expect(recorded).toEqual({ step: 1, sessionId: sid, agentPid: 999_021, agentStart: undefined })
  })

  it("records a sandboxed turn's exec id beside its pid", async () => {
    const scratchDir = newScratch()
    const id = TrakId.make("spawned-sandboxed")
    const layer = FileRunsLayer(scratchDir).pipe(
      Layer.provide(scriptedProcess({ alive: new Set([process.pid]), startTimes: new Map() }, [])),
    )
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runs = yield* Runs
          yield* runs.turn(id, {
            step: 1,
            sessionId: sid,
            agentPid: undefined,
            agentStart: undefined,
            usage: undefined,
            estimate: undefined,
          })
          yield* runs.spawned(id, 999_022, "exec-3")
          expect(JSON.parse(readFileSync(runJson(scratchDir, id), "utf8"))).toMatchObject({
            turn: { agentPid: 999_022, execId: "exec-3" },
          })
        }),
      ).pipe(Effect.provide(layer)),
    )
  })
})

describe("Runs contract: file — reaping", () => {
  // Two strays that differ only in what their command lines would have said — a
  // Claude turn carries the session id in its arguments and a fresh Codex turn
  // carries none — and the reaper reads neither. The start time is the whole
  // verification, which is what makes the check hold for every provider.
  it.each([
    ["a Claude stray, whose argv carried the session id", 999_004],
    ["a Codex stray, whose argv carried no id at all", 999_014],
  ])("reaps %s, on its start time alone", async (_label, pid) => {
    const scratchDir = newScratch()
    const id = TrakId.make(`killable-${pid}`)
    seedStray(scratchDir, id, { pid, start: STARTED })
    const { results, killed } = await reapWith(scratchDir, {
      alive: new Set([pid]),
      startTimes: new Map([[pid, STARTED]]),
    })
    expect(results).toEqual([Reaped.Killed({ id, pid })])
    expect(killed).toEqual([pid])
  })

  it("declines a live pid that started at a different time — the number was reissued", async () => {
    // The pid-reuse case, and the assertion that matters most: a wrong kill is
    // worse than a leaked process.
    const scratchDir = newScratch()
    const id = TrakId.make("reused-pid")
    seedStray(scratchDir, id, { pid: 999_006, start: STARTED })
    const { results, killed } = await reapWith(scratchDir, {
      alive: new Set([999_006]),
      startTimes: new Map([[999_006, "Thu Sep 17 11:02:41 2026"]]),
    })
    expect(results).toEqual([Reaped.Declined({ id, pid: 999_006 })])
    expect(killed).toEqual([])
  })

  it("declines a live pid whose start cannot be read now", async () => {
    const scratchDir = newScratch()
    const id = TrakId.make("unreadable-now")
    seedStray(scratchDir, id, { pid: 999_016, start: STARTED })
    const { results, killed } = await reapWith(scratchDir, {
      alive: new Set([999_016]),
      startTimes: new Map(),
    })
    expect(results).toEqual([Reaped.Declined({ id, pid: 999_016 })])
    expect(killed).toEqual([])
  })

  it("declines a live pid whose start was never recorded", async () => {
    // A record written before the field existed, or a spawn whose read failed:
    // there is nothing to compare, and nothing to compare is not a match.
    const scratchDir = newScratch()
    const id = TrakId.make("unrecorded-start")
    seedStray(scratchDir, id, { pid: 999_017 })
    const { results, killed } = await reapWith(scratchDir, {
      alive: new Set([999_017]),
      startTimes: new Map([[999_017, STARTED]]),
    })
    expect(results).toEqual([Reaped.Declined({ id, pid: 999_017 })])
    expect(killed).toEqual([])
  })

  it("reports a recorded agent pid that is already gone, and does not try to kill it", async () => {
    const scratchDir = newScratch()
    const id = TrakId.make("already-gone")
    seedStray(scratchDir, id, { pid: 999_008, start: STARTED })
    const { results, killed } = await reapWith(scratchDir, {
      alive: new Set(),
      startTimes: new Map(),
    })
    expect(results).toEqual([Reaped.AlreadyGone({ id, pid: 999_008 })])
    expect(killed).toEqual([])
  })

  it("leaves a trak whose holder is alive alone entirely", async () => {
    const scratchDir = newScratch()
    const id = TrakId.make("live-holder")
    seedRun(scratchDir, id, {
      holder: { pid: 999_009, startedAt: 0 },
      turn: { step: 0, sessionId: sid, agentPid: 999_010, agentStart: STARTED },
    })
    const { results, killed } = await reapWith(scratchDir, {
      alive: new Set([999_009, 999_010]),
      startTimes: new Map([[999_010, STARTED]]),
    })
    expect(results).toEqual([])
    expect(killed).toEqual([])
  })
})

describe("Runs contract: file — reaping a sandboxed turn", () => {
  it("stops a sandboxed stray by its exec id once its local runner.sh is gone", async () => {
    const scratchDir = newScratch()
    const id = TrakId.make("sandboxed-gone")
    seedStray(scratchDir, id, { pid: 999_018, start: STARTED, execId: "exec-1" })
    const { results, killed, stopped } = await reapWith(scratchDir, {
      alive: new Set(),
      startTimes: new Map(),
    })
    expect({ results, killed, stopped }).toEqual({
      results: [Reaped.AlreadyGone({ id, pid: 999_018 })],
      killed: [],
      stopped: ["sandboxed-gone exec-1"],
    })
  })

  it("kills a live, verified sandboxed stray locally, and stops its exec id as well", async () => {
    // The live runner.sh forwards the SIGTERM itself; the stop by id costs nothing more.
    const scratchDir = newScratch()
    const id = TrakId.make("sandboxed-live")
    seedStray(scratchDir, id, { pid: 999_019, start: STARTED, execId: "exec-2" })
    const { results, killed, stopped } = await reapWith(scratchDir, {
      alive: new Set([999_019]),
      startTimes: new Map([[999_019, STARTED]]),
    })
    expect({ results, killed, stopped }).toEqual({
      results: [Reaped.Killed({ id, pid: 999_019 })],
      killed: [999_019],
      stopped: ["sandboxed-live exec-2"],
    })
  })

  // A declined pid is one this reaper will not signal, and after a reboot it is usually a
  // reissued number — so runner.sh is gone, and only the exec id still reaches the command.
  it.each([
    ["reissued, starting at another time", "exec-4", STARTED, "Thu Sep 17 11:02:41 2026"],
    ["whose start cannot be read now", "exec-5", STARTED, undefined],
    ["whose start was never recorded", "exec-6", undefined, STARTED],
  ])(
    "stops a sandboxed stray by its exec id when its pid is %s",
    async (_label, execId, start, now) => {
      const scratchDir = newScratch()
      const id = TrakId.make(`sandboxed-${execId}`)
      seedStray(scratchDir, id, {
        pid: 999_023,
        execId,
        ...(start === undefined ? {} : { start }),
      })
      const { results, killed, stopped } = await reapWith(scratchDir, {
        alive: new Set([999_023]),
        startTimes: new Map(now === undefined ? [] : [[999_023, now]]),
      })
      expect({ results, killed, stopped }).toEqual({
        results: [Reaped.Declined({ id, pid: 999_023 })],
        killed: [],
        stopped: [`sandboxed-${execId} ${execId}`],
      })
    },
  )
})

const detachedStray = (scratchDir: string, id: TrakId, execId: string): void =>
  seedRun(scratchDir, id, {
    holder: { pid: 999_003, startedAt: 0 },
    turn: { step: 2, sessionId: sid, agentPid: 999_031, execId, detached: true },
  })

/**
 * One turn recorded and spawned detached, then its scope and the trak's closed — with the
 * engine leaving, staying, or staying with the command kept for the trak's Resume.
 */
const ranDetached = async (leaving: boolean | "kept", id: TrakId) => {
  const scratchDir = newScratch()
  const layer = FileRunsLayer(scratchDir).pipe(
    Layer.provide(
      Layer.merge(
        scriptedProcess({ alive: new Set([process.pid]), startTimes: new Map() }, []),
        Layer.succeed(Leaving, {
          now: Effect.succeed(leaving === true),
          leaves: () => Effect.succeed(leaving === true),
          leave: Effect.void,
          letGo: () => Effect.void,
          regain: () => Effect.void,
          keep: () => Effect.void,
          rejoined: () => Effect.void,
          keeps: (execId) =>
            Effect.succeed(leaving === true || (leaving === "kept" && execId === "exec-8")),
        }),
      ),
    ),
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      const runs = yield* Runs
      yield* runs.adopt(id)
      yield* runs.turn(id, {
        step: 1,
        sessionId: sid,
        agentPid: undefined,
        agentStart: undefined,
        usage: undefined,
        estimate: undefined,
      })
      yield* runs.spawned(id, 999_032, "exec-8", true)
    }).pipe(Effect.scoped, Effect.provide(layer)),
  )
  const record: unknown = JSON.parse(readFileSync(runJson(scratchDir, id), "utf8"))
  return record
}

/** A turn recorded over a detached command a dead engine left, rejoining it or not. */
const recordedOver = async (rejoin: string | undefined) => {
  const scratchDir = newScratch()
  const id = TrakId.make("detached-over")
  detachedStray(scratchDir, id, "exec-9")
  const stopped: string[] = []
  const layer = FileRunsLayer(scratchDir).pipe(
    Layer.provide(
      scriptedProcess({ alive: new Set([process.pid]), startTimes: new Map() }, [], stopped),
    ),
  )
  const during = await Effect.runPromise(
    Effect.gen(function* () {
      const runs = yield* Runs
      yield* runs.turn(id, {
        step: 2,
        sessionId: sid,
        agentPid: undefined,
        agentStart: undefined,
        usage: undefined,
        estimate: undefined,
        ...(rejoin === undefined ? {} : { rejoin }),
      })
      return yield* runs.inFlight(id)
    }).pipe(Effect.scoped, Effect.provide(layer)),
  )
  return { stopped, during }
}

describe("Runs contract: file — a detached turn", () => {
  it("leaves a detached command running and names it for rejoining, where an attached one is stopped", async () => {
    const scratchDir = newScratch()
    const id = TrakId.make("detached-gone")
    detachedStray(scratchDir, id, "exec-7")
    const { results, killed, stopped } = await reapWith(scratchDir, {
      alive: new Set(),
      startTimes: new Map(),
    })
    expect({ results, killed, stopped }).toEqual({
      results: [
        Reaped.AlreadyGone({ id, pid: 999_031 }),
        Reaped.Rejoining({ id, execId: "exec-7" }),
      ],
      killed: [],
      stopped: [],
    })
    // The turn stays for the drive that rejoins it, and reads back as a command to rejoin.
    const turn = await Effect.runPromise(
      Effect.flatMap(Runs, (runs) => runs.inFlight(id)).pipe(
        Effect.provide(
          FileRunsLayer(scratchDir).pipe(
            Layer.provide(scriptedProcess({ alive: new Set(), startTimes: new Map() }, [])),
          ),
        ),
      ),
    )
    expect(turn).toMatchObject({ step: 2, rejoin: "exec-7" })
  })

  it("keeps the record of a detached turn when the engine is leaving, holder and all", async () => {
    expect(await ranDetached(true, TrakId.make("detached-left"))).toMatchObject({
      holder: { pid: process.pid },
      turn: { step: 1, agentPid: 999_032, execId: "exec-8", detached: true },
    })
  })

  it("keeps the turn of a command left running for Resume, and clears the holder", async () => {
    expect(await ranDetached("kept", TrakId.make("detached-kept"))).toEqual({
      turn: {
        step: 1,
        sessionId: sid,
        agentPid: 999_032,
        execId: "exec-8",
        detached: true,
      },
    })
  })

  it("clears the record of a detached turn when the engine is not leaving", async () => {
    expect(await ranDetached(false, TrakId.make("detached-stopped"))).toEqual({})
  })

  it("stops a detached command the record names before a turn that does not rejoin it", async () => {
    expect(await recordedOver(undefined)).toMatchObject({
      stopped: ["detached-over exec-9"],
      during: { step: 2 },
    })
  })

  it("keeps the command a rejoining turn names on its record, and stops nothing", async () => {
    expect(await recordedOver("exec-9")).toMatchObject({
      stopped: [],
      during: { step: 2, rejoin: "exec-9" },
    })
  })
})

/** `run.json` as it stands on disk. */
const readRecordJson = (scratchDir: string, id: TrakId): unknown => {
  const record: unknown = JSON.parse(readFileSync(runJson(scratchDir, id), "utf8"))
  return record
}

describe("Runs contract: file — a holder whose pid was given to another process", () => {
  const LATER = "Thu Sep 17 10:15:00 2026"

  /** A detached turn's record as a shutdown leaves it, its holder's pid now `alive`. */
  const reapedOver = async (start: string | undefined, now: string | undefined) => {
    const scratchDir = newScratch()
    const id = TrakId.make("holder-reissued")
    seedRun(scratchDir, id, {
      holder: { pid: 999_040, startedAt: 0, ...(start === undefined ? {} : { start }) },
      turn: { step: 2, sessionId: sid, agentPid: 999_041, execId: "exec-10", detached: true },
    })
    const proc = {
      alive: new Set([999_040]),
      startTimes: new Map(now === undefined ? [] : [[999_040, now]]),
    }
    const held = await Effect.runPromise(
      Effect.flatMap(Runs, (runs) => runs.holder(id)).pipe(
        Effect.provide(FileRunsLayer(scratchDir).pipe(Layer.provide(scriptedProcess(proc, [])))),
      ),
    )
    return { held, ...(await reapWith(scratchDir, proc)), id }
  }

  // A start that cannot be read now is what `ps` answers for a thread id, which `kill`
  // passes: the likely reissue after a container restart.
  it.each([
    ["started at another time", LATER],
    ["cannot be read now", undefined],
  ])(
    "reads a live pid whose start %s as dead, and rejoins its detached turn",
    async (_label, now) => {
      const { held, results, id } = await reapedOver(STARTED, now)
      expect(held).toBeUndefined()
      expect(results).toEqual([
        Reaped.AlreadyGone({ id, pid: 999_041 }),
        Reaped.Rejoining({ id, execId: "exec-10" }),
      ])
    },
  )

  it.each([
    ["matches", STARTED, STARTED],
    ["was never recorded", undefined, LATER],
  ])("keeps a holder whose start %s", async (_label, start, now) => {
    const { held, results } = await reapedOver(start, now)
    expect({ held: held?.pid, results }).toEqual({ held: 999_040, results: [] })
  })

  it("keeps its own holder when its start cannot be read later", async () => {
    const scratchDir = newScratch()
    const id = TrakId.make("holder-own")
    // `ps` answers once, for the adopt, and then refuses.
    const startTimes = new Map([[process.pid, STARTED]])
    const proc = { alive: new Set([process.pid]), startTimes }
    const outcome = Effect.flatMap(Runs, (runs) =>
      Effect.gen(function* () {
        yield* runs.adopt(id)
        startTimes.clear()
        return { held: (yield* runs.holder(id))?.pid, results: yield* runs.reap() }
      }),
    ).pipe(
      Effect.scoped,
      Effect.provide(FileRunsLayer(scratchDir).pipe(Layer.provide(scriptedProcess(proc, [])))),
    )
    expect(await Effect.runPromise(outcome)).toEqual({ held: process.pid, results: [] })
  })

  it("records the holder's start as the process reads it", async () => {
    const scratchDir = newScratch()
    const id = TrakId.make("holder-start")
    const proc = { alive: new Set([process.pid]), startTimes: new Map([[process.pid, STARTED]]) }
    const adopted = Effect.flatMap(Runs, (runs) => runs.adopt(id)).pipe(
      Effect.zipRight(Effect.sync(() => readRecordJson(scratchDir, id))),
      Effect.scoped,
      Effect.provide(FileRunsLayer(scratchDir).pipe(Layer.provide(scriptedProcess(proc, [])))),
    )
    expect(await Effect.runPromise(adopted)).toMatchObject({
      holder: { pid: process.pid, start: STARTED },
    })
  })
})
