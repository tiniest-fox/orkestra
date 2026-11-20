// `needs:` through the supervisor: a process starts after what it needs is running,
// whichever is started first, and goes down with it — on a stop, a restart or an exit.
//
// Over a fake Process port whose servers listen in this process when the test says so,
// so every ordering is decided by the test rather than by how fast `node` boots. The
// probe and the state machine are the shipped ones.

import { Clock, Deferred, Effect, Layer, Schedule } from "effect"
import { describe, expect, it } from "vitest"
import type { HostedProcess } from "../../src/library/types/process.js"
import { Lib } from "../../src/library/ports/library.js"
import { ShellHostedProcessesLayer } from "../../src/workflow/adapters/processes-shell.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { HostedProcesses, type HostedRun } from "../../src/workflow/ports/hosted-processes.js"
import { fakeServers, type Listens, processFrames } from "../support/fake-servers.js"
import { library } from "../support/library.js"
import { inheritedEnvironment } from "../support/scripted-environment.js"

const TRAK = TrakId.make("needs-trak")
const CWD = "/checkout"

const declare = (name: string, needs: readonly string[] = [], readySeconds = 5): HostedProcess => ({
  name,
  description: `the ${name} process`,
  page: true,
  readySeconds,
  needs,
  path: `/scripts/${name}.sh`,
})

/** `gallery` renders on `web`, the harbor shape. */
const WEB = declare("web")
const GALLERY = declare("gallery", ["web"])

/**
 * Run `body` against a supervisor holding `declared`, whose servers listen as `listens`
 * says, and hand it the fake and the frames published.
 */
const supervising = <A>(
  declared: readonly HostedProcess[],
  listens: Readonly<Record<string, Listens>>,
  body: (
    servers: ReturnType<typeof fakeServers>,
    frames: readonly string[],
  ) => Effect.Effect<A, unknown, HostedProcesses>,
): Promise<A> => {
  const servers = fakeServers(listens)
  const feed = processFrames()
  const lib = library({ processes: new Map(declared.map((p) => [p.name, p])) })
  const layer = ShellHostedProcessesLayer({ record: undefined }).pipe(
    Layer.provide(
      Layer.mergeAll(servers.layer, inheritedEnvironment, feed.layer, Layer.succeed(Lib, lib)),
    ),
  )
  return Effect.runPromise(body(servers, feed.lines).pipe(Effect.provide(layer), Effect.orDie))
}

const hosted = HostedProcesses

const named = (runs: readonly HostedRun[], name: string): HostedRun | undefined =>
  runs.find((r) => r.name === name)

const runOf = (name: string) =>
  Effect.flatMap(hosted, (h) => Effect.map(h.list(TRAK, CWD), (runs) => named(runs, name)))

const stateOf = (name: string) => Effect.map(runOf(name), (run) => run?.state._tag)

const tagOf = (run: HostedRun): string => run.state._tag

/** Wait until `name` is in `state`. */
const until = (name: string, state: HostedRun["state"]["_tag"]) =>
  stateOf(name).pipe(
    Effect.repeat({ until: (s) => s === state, schedule: Schedule.spaced("20 millis") }),
    Effect.timeout("10 seconds"),
    Effect.orDie,
  )

const reasonOf = (run: HostedRun): string =>
  run.state._tag === "DidNotComeUp" ? run.state.reason : `not refused: ${run.state._tag}`

/** Each started process comes up in order: what it needs first, then itself. */
const IN_ORDER = [
  "web Preparing",
  "web Starting",
  "web Running",
  "gallery Preparing",
  "gallery Starting",
  "gallery Running",
]

describe("a process that needs another", () => {
  it("started first, starts what it needs and spawns only once that is running", async () => {
    const result = await supervising([WEB, GALLERY], { gallery: 0 }, (servers, frames) =>
      Effect.gen(function* () {
        const h = yield* hosted
        const starting = yield* Effect.fork(h.start(TRAK, CWD, "gallery"))
        yield* until("web", "Starting")
        // Held there: web is not up, so gallery has not been spawned.
        yield* Effect.sleep("300 millis")
        expect(servers.spawned).toEqual(["web"])
        yield* servers.up("web")
        const gallery = yield* starting.await.pipe(Effect.flatten)
        return { gallery: gallery.state._tag, frames: [...frames], spawned: [...servers.spawned] }
      }),
    )
    expect(result).toEqual({ gallery: "Running", frames: IN_ORDER, spawned: ["web", "gallery"] })
  })

  it("started after what it needs is running, reuses that run", async () => {
    const result = await supervising([WEB, GALLERY], { web: 0, gallery: 0 }, (servers, frames) =>
      Effect.gen(function* () {
        const h = yield* hosted
        const web = yield* h.start(TRAK, CWD, "web")
        const gallery = yield* h.start(TRAK, CWD, "gallery")
        const again = yield* runOf("web")
        return {
          states: [web.state._tag, gallery.state._tag],
          webRun: again?.run === web.run,
          frames: [...frames],
          spawned: [...servers.spawned],
        }
      }),
    )
    expect(result).toEqual({
      states: ["Running", "Running"],
      webRun: true,
      frames: IN_ORDER,
      spawned: ["web", "gallery"],
    })
  })

  it("started at the same moment as what it needs, waits for it, and both spawn once", async () => {
    const result = await supervising([WEB, GALLERY], { web: 400, gallery: 0 }, (servers, frames) =>
      Effect.gen(function* () {
        const h = yield* hosted
        const runs = yield* Effect.all([h.start(TRAK, CWD, "gallery"), h.start(TRAK, CWD, "web")], {
          concurrency: "unbounded",
        })
        return {
          states: runs.map(tagOf),
          frames: [...frames],
          spawned: [...servers.spawned],
        }
      }),
    )
    expect(result).toEqual({
      states: ["Running", "Running"],
      frames: IN_ORDER,
      spawned: ["web", "gallery"],
    })
  })

  it("counts its ready_seconds from its own spawn, not from what it needs coming up", async () => {
    // web takes 0.6s; gallery has 0.5s and answers at its second probe, 0.25s after its
    // spawn. Counted from the press, it would be out of time before it was spawned.
    const quick = declare("gallery", ["web"], 0.5)
    const result = await supervising([WEB, quick], { web: 600, gallery: 150 }, () =>
      Effect.map(
        Effect.flatMap(hosted, (h) => h.start(TRAK, CWD, "gallery")),
        (run) => run.state._tag,
      ),
    )
    expect(result).toBe("Running")
  })
})

describe("a process whose needed process fails", () => {
  it("does not spawn when it never answers, and names it with its reason", async () => {
    const result = await supervising(
      [declare("web", [], 0.3), GALLERY],
      { gallery: 0 },
      (servers) =>
        Effect.gen(function* () {
          const gallery = yield* (yield* hosted).start(TRAK, CWD, "gallery")
          return { reason: reasonOf(gallery), spawned: [...servers.spawned] }
        }),
    )
    expect(result.spawned).toEqual(["web"])
    expect(result.reason).toMatch(
      /^It needs `web`, which did not come up: Nothing answered on port \d+ in 0.3s, so it was stopped\.$/,
    )
  })

  it("does not spawn when it exits before answering, and says how it exited", async () => {
    const result = await supervising([WEB, GALLERY], { gallery: 0 }, (servers) =>
      Effect.gen(function* () {
        const starting = yield* Effect.fork((yield* hosted).start(TRAK, CWD, "gallery"))
        yield* until("web", "Starting")
        yield* servers.exit("web", 3)
        const gallery = yield* starting.await.pipe(Effect.flatten)
        return { reason: reasonOf(gallery), spawned: [...servers.spawned] }
      }),
    )
    expect(result.spawned).toEqual(["web"])
    expect(result.reason).toMatch(
      /^It needs `web`, which did not come up: It exited with code 3 before anything answered on port \d+\.$/,
    )
  })

  it("does not spawn when what it needs is stopped while it waits", async () => {
    const result = await supervising([WEB, GALLERY], { gallery: 0 }, (servers) =>
      Effect.gen(function* () {
        const h = yield* hosted
        const starting = yield* Effect.fork(h.start(TRAK, CWD, "gallery"))
        yield* until("web", "Starting")
        yield* h.stop(TRAK, "web")
        const gallery = yield* starting.await.pipe(Effect.flatten)
        return { reason: reasonOf(gallery), spawned: [...servers.spawned] }
      }),
    )
    expect(result).toEqual({
      reason: "It needs `web`, which was stopped before this could start.",
      spawned: ["web"],
    })
  })
})

/**
 * A clock whose first read waits until `release`, saying so on `reached`, and which reads
 * the live time after. Provided around a stop alone, it holds the stop on its permit for
 * what it stops, before that moves: the stop's first read of the time is there.
 */
const heldRead = () =>
  Effect.gen(function* () {
    const reached = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const live = Clock.make()
    // Every member delegated by name: the live clock's methods are on its prototype, which
    // a spread would drop, leaving `sleep` undefined under the stop.
    const clock: Clock.Clock = {
      [Clock.ClockTypeId]: Clock.ClockTypeId,
      unsafeCurrentTimeMillis: () => live.unsafeCurrentTimeMillis(),
      unsafeCurrentTimeNanos: () => live.unsafeCurrentTimeNanos(),
      currentTimeNanos: live.currentTimeNanos,
      sleep: (duration) => live.sleep(duration),
      currentTimeMillis: Effect.zipRight(
        Effect.zipRight(Deferred.succeed(reached, undefined), Deferred.await(release)),
        live.currentTimeMillis,
      ),
    }
    return { clock, reached, release }
  })

/** web and gallery both up, from one press on gallery. */
const bothUp = Effect.flatMap(hosted, (h) => h.start(TRAK, CWD, "gallery"))

describe("what a needed process does reaches what needs it", () => {
  it("a stop takes the dependent down first", async () => {
    const result = await supervising([WEB, GALLERY], { web: 0, gallery: 0 }, (_servers, frames) =>
      Effect.gen(function* () {
        yield* bothUp
        const web = yield* (yield* hosted).stop(TRAK, "web")
        return {
          web: web.state._tag,
          gallery: yield* stateOf("gallery"),
          frames: frames.slice(IN_ORDER.length),
        }
      }),
    )
    expect(result).toEqual({
      web: "Stopped",
      gallery: "Stopped",
      frames: ["gallery Stopped", "web Stopped"],
    })
  })

  it("a restart stops the dependent, then brings it back on a new run once it is running", async () => {
    const result = await supervising([WEB, GALLERY], { web: 0, gallery: 0 }, (servers, frames) =>
      Effect.gen(function* () {
        const h = yield* hosted
        const before = yield* bothUp
        const web = yield* h.restart(TRAK, CWD, "web")
        const gallery = yield* runOf("gallery")
        return {
          web: web.state._tag,
          gallery: gallery?.state._tag,
          newRun: (gallery?.run ?? 0) > before.run,
          frames: frames.slice(IN_ORDER.length),
          spawned: [...servers.spawned],
        }
      }),
    )
    expect(result).toEqual({
      web: "Running",
      gallery: "Running",
      newRun: true,
      frames: ["gallery Stopped", "web Stopped", ...IN_ORDER],
      spawned: ["web", "gallery", "web", "gallery"],
    })
  })

  it("an exit on its own stops the dependent, and nothing restarts it", async () => {
    const result = await supervising([WEB, GALLERY], { web: 0, gallery: 0 }, (servers, frames) =>
      Effect.gen(function* () {
        yield* bothUp
        yield* servers.exit("web", 1)
        yield* until("gallery", "Stopped")
        return { web: yield* stateOf("web"), frames: frames.slice(IN_ORDER.length) }
      }),
    )
    expect(result).toEqual({ web: "Exited", frames: ["web Exited", "gallery Stopped"] })
  })

  it("a stop of the dependent leaves what it needs running", async () => {
    const result = await supervising([WEB, GALLERY], { web: 0, gallery: 0 }, () =>
      Effect.gen(function* () {
        yield* bothUp
        yield* (yield* hosted).stop(TRAK, "gallery")
        return [yield* stateOf("web"), yield* stateOf("gallery")]
      }),
    )
    expect(result).toEqual(["Running", "Stopped"])
  })
})

describe("a stop of a needed process beside the dependent's start", () => {
  it("a dependent that read what it needs as running before a stop moved it is stopped after", async () => {
    // The stop's first cascade finds nothing to stop: gallery is still waiting on web to
    // come up. The stop is then held on its permit for web, before web moves. web comes up,
    // gallery reads it as running and launches, and only the cascade after web has moved
    // can catch it.
    const result = await supervising([WEB, GALLERY], { gallery: 0 }, (servers, frames) =>
      Effect.gen(function* () {
        const h = yield* hosted
        const starting = yield* Effect.fork(h.start(TRAK, CWD, "gallery"))
        yield* until("web", "Starting")
        const held = yield* heldRead()
        const stopping = yield* Effect.fork(Effect.withClock(h.stop(TRAK, "web"), held.clock))
        yield* Deferred.await(held.reached)
        yield* servers.up("web")
        yield* until("gallery", "Running")
        yield* Deferred.succeed(held.release, undefined)
        const web = yield* stopping.await.pipe(Effect.flatten)
        yield* starting.await
        return {
          web: web.state._tag,
          gallery: yield* stateOf("gallery"),
          frames: frames.slice(IN_ORDER.length),
          spawned: [...servers.spawned],
        }
      }),
    )
    expect(result).toEqual({
      web: "Stopped",
      gallery: "Stopped",
      frames: ["web Stopped", "gallery Stopped"],
      spawned: ["web", "gallery"],
    })
  })

  it("a dependent started after a stop has settled starts what it needs again", async () => {
    const result = await supervising([WEB, GALLERY], { web: 0, gallery: 0 }, (servers) =>
      Effect.gen(function* () {
        const h = yield* hosted
        yield* h.start(TRAK, CWD, "web")
        yield* h.stop(TRAK, "web")
        yield* h.start(TRAK, CWD, "gallery")
        return {
          states: [yield* stateOf("web"), yield* stateOf("gallery")],
          spawned: [...servers.spawned],
        }
      }),
    )
    expect(result).toEqual({ states: ["Running", "Running"], spawned: ["web", "web", "gallery"] })
  })
})
