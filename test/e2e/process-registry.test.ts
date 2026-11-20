// The process registry: `.orkestra/.processes.json` in a trak's checkout or the project's, rewritten by the
// supervisor on every transition and after the boot reap, and read by tools outside
// Orkestra — so what is asserted here is the file, read the way such a tool reads it.
//
// The transitions run over the fake Process port `process-needs.test.ts` uses, so each
// one happens when the test says. The stale-entry rule runs against a real `node` server,
// because the rule is about what `ps` says of a real pid. Nothing here spends.

import { execFileSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import type { Process } from "../../src/agent/ports/process.js"
import type { HostedProcess } from "../../src/library/types/process.js"
import { Lib } from "../../src/library/ports/library.js"
import { ShellHostedProcessesLayer } from "../../src/workflow/adapters/processes-shell.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { Feed, type Frame } from "../../src/workflow/ports/feed.js"
import { HostedProcesses } from "../../src/workflow/ports/hosted-processes.js"
import { fakeServers, type Listens } from "../support/fake-servers.js"
import { library } from "../support/library.js"
import { inheritedEnvironment } from "../support/scripted-environment.js"

const TRAK = TrakId.make("registry-trak")

const declare = (
  name: string,
  needs: readonly string[] = [],
  path = `/scripts/${name}.sh`,
  readySeconds = 5,
) =>
  ({
    name,
    description: `the ${name} process`,
    page: true,
    readySeconds,
    needs,
    path,
  }) satisfies HostedProcess

const WEB = declare("web")
const GALLERY = declare("gallery", ["web"])
/** `web` for the case that sits its ready time out: the rest need the margin of 5. */
const SILENT_WEB = declare("web", [], "/scripts/web.sh", 0.5)

const checkout = (): string => mkdtempSync(join(tmpdir(), "orkestra-registry-"))

const registryIn = (cwd: string): string => join(cwd, ".orkestra", ".processes.json")

/** The documented format, and nothing beside it. */
const Registry = Schema.Record({
  key: Schema.String,
  value: Schema.Struct({
    state: Schema.Literal("starting", "running"),
    pid: Schema.Number,
    started: Schema.optional(Schema.String),
    port: Schema.Number,
    url: Schema.optional(Schema.String),
  }),
})
type Registry = Schema.Schema.Type<typeof Registry>

/** The registry as a reader finds it, or `absent`. */
const readRegistry = (cwd: string): Registry | "absent" =>
  existsSync(registryIn(cwd))
    ? Schema.decodeUnknownSync(Schema.parseJson(Registry))(readFileSync(registryIn(cwd), "utf8"), {
        onExcessProperty: "error",
      })
    : "absent"

/**
 * A Feed that reads the registry each time a process frame goes out, so each transition
 * is paired with the file as it stood when a watcher was told of it.
 */
const registryAtEachFrame = (cwd: string) => {
  const seen: { readonly frame: string; readonly registry: Registry | "absent" }[] = []
  const record = (frame: Frame): void => {
    if (frame._tag !== "Process") return
    const { name, state } = frame.process
    const at = frame.id === undefined ? "project " : ""
    seen.push({ frame: `${at}${name} ${state._tag}`, registry: readRegistry(cwd) })
  }
  const layer = Layer.succeed(Feed, {
    publish: (frame) =>
      Effect.sync(() => {
        record(frame)
      }),
    since: () => Effect.die("this feed keeps what was published and replays none of it"),
  })
  return { layer, seen }
}

const supervisor = (
  declared: readonly HostedProcess[],
  record: string | undefined,
  feed: Layer.Layer<Feed>,
  proc: Layer.Layer<Process>,
) =>
  ShellHostedProcessesLayer({ record }).pipe(
    Layer.provide(
      Layer.mergeAll(
        proc,
        inheritedEnvironment,
        feed,
        Layer.succeed(Lib, library({ processes: new Map(declared.map((p) => [p.name, p])) })),
      ),
    ),
  )

/** Over the fake servers, with the registry read at every frame. */
const supervising = <A>(
  cwd: string,
  listens: Readonly<Record<string, Listens>>,
  body: (servers: ReturnType<typeof fakeServers>) => Effect.Effect<A, unknown, HostedProcesses>,
  declared: readonly HostedProcess[] = [WEB, GALLERY],
) => {
  const servers = fakeServers(listens)
  const feed = registryAtEachFrame(cwd)
  const layer = supervisor(declared, undefined, feed.layer, servers.layer)
  return Effect.runPromise(
    body(servers).pipe(
      Effect.map((result) => ({ result, seen: feed.seen })),
      Effect.provide(layer),
      Effect.orDie,
    ),
  )
}

/**
 * Each entry as one line — its name and state, and `at its port` where it carries the URL
 * of the port it holds. A start time that is not the one the fake reported for its pid
 * says so, as does a URL somewhere else.
 */
const summary = (registry: Registry | "absent"): readonly string[] | "absent" =>
  registry === "absent"
    ? registry
    : Object.entries(registry).map(([name, e]) => {
        const start = e.started === `started ${String(e.pid)}` ? "" : " with a wrong start time"
        const url =
          e.url === undefined
            ? ""
            : e.url === `http://127.0.0.1:${String(e.port)}/`
              ? " at its port"
              : ` at ${e.url}`
        return `${name} ${e.state}${start}${url}`
      })

describe("the process registry", () => {
  it("lists exactly the starting and running processes after every transition", async () => {
    const cwd = checkout()
    const { seen } = await supervising(cwd, { gallery: 0 }, (servers) =>
      Effect.gen(function* () {
        const h = yield* HostedProcesses
        const up = yield* Effect.fork(h.start(TRAK, cwd, "gallery"))
        yield* Effect.sleep("300 millis")
        yield* servers.up("web")
        yield* up.await
        yield* h.stop(TRAK, "web")
        const again = yield* Effect.fork(h.start(TRAK, cwd, "web"))
        yield* Effect.sleep("100 millis")
        yield* servers.up("web")
        yield* again.await
        yield* servers.exit("web", 3)
        yield* Effect.sleep("300 millis")
      }),
    )
    expect(seen.map(({ frame, registry }) => [frame, summary(registry)])).toEqual([
      ["web Preparing", []],
      ["web Starting", ["web starting"]],
      ["web Running", ["web running at its port"]],
      ["gallery Preparing", ["web running at its port"]],
      ["gallery Starting", ["web running at its port", "gallery starting"]],
      ["gallery Running", ["web running at its port", "gallery running at its port"]],
      ["gallery Stopped", ["web running at its port"]],
      ["web Stopped", []],
      ["web Preparing", []],
      ["web Starting", ["web starting"]],
      ["web Running", ["web running at its port"]],
      ["web Exited", []],
    ])
    // Written beside itself and renamed over: no temporary file is left.
    expect(readdirSync(join(cwd, ".orkestra"))).toEqual([".processes.json"])
  })

  it("is `{}` for a process that did not come up", async () => {
    const cwd = checkout()
    const { seen } = await supervising(
      cwd,
      {},
      () =>
        Effect.gen(function* () {
          const h = yield* HostedProcesses
          yield* h.start(TRAK, cwd, "web")
        }),
      [SILENT_WEB],
    )
    expect(seen.at(-1)).toEqual({ frame: "web DidNotComeUp", registry: {} })
  })

  it("is not written for a trak with no checkout of its own", async () => {
    const cwd = checkout()
    const { seen } = await supervising(cwd, { web: 0 }, () =>
      Effect.gen(function* () {
        const h = yield* HostedProcesses
        yield* h.start(TRAK, "", "web")
        yield* h.stop(TRAK, "web")
      }),
    )
    expect(seen.map(({ registry }) => registry)).toEqual(["absent", "absent", "absent", "absent"])
  })

  it("is written in the project checkout for the project's processes", async () => {
    const cwd = checkout()
    const { seen } = await supervising(cwd, { web: 0 }, () =>
      Effect.gen(function* () {
        const h = yield* HostedProcesses
        yield* h.start(undefined, cwd, "web")
        yield* h.stop(undefined, "web")
      }),
    )
    expect(seen.map(({ frame, registry }) => [frame, summary(registry)])).toEqual([
      ["project web Preparing", []],
      ["project web Starting", ["web starting"]],
      ["project web Running", ["web running at its port"]],
      ["project web Stopped", []],
    ])
  })
})

describe("the process registry after an engine restart", () => {
  it("lists only live processes once the reap has run", async () => {
    const cwd = checkout()
    const database = checkout()
    const record = join(database, "processes.json")
    // What a SIGKILLed engine leaves: the pid record, and a registry naming a process
    // whose pid the fake reports gone.
    writeFileSync(
      record,
      JSON.stringify([{ trak: TRAK, name: "web", pid: 4242, start: "started 4242", cwd }]),
    )
    mkdirSync(join(cwd, ".orkestra"))
    const stale = { web: { state: "running", pid: 4242, started: "started 4242", port: 22001 } }
    writeFileSync(registryIn(cwd), JSON.stringify(stale))

    const servers = fakeServers({})
    const feed = registryAtEachFrame(cwd)
    const reaped = await Effect.runPromise(
      Effect.flatMap(HostedProcesses, (h) => h.reap).pipe(
        Effect.provide(supervisor([WEB], record, feed.layer, servers.layer)),
      ),
    )
    expect(reaped).toEqual([{ trak: TRAK, name: "web", pid: 4242, outcome: "gone" }])
    expect(readRegistry(cwd)).toEqual({})
  })

  it("finds the project's processes, which the record names by no trak", async () => {
    const cwd = checkout()
    const record = join(checkout(), "processes.json")
    writeFileSync(record, JSON.stringify([{ name: "web", pid: 4242, start: "started 4242", cwd }]))
    mkdirSync(join(cwd, ".orkestra"))
    const stale = { web: { state: "running", pid: 4242, started: "started 4242", port: 22001 } }
    writeFileSync(registryIn(cwd), JSON.stringify(stale))

    const servers = fakeServers({})
    const feed = registryAtEachFrame(cwd)
    const { reaped, project, trak } = await Effect.runPromise(
      Effect.gen(function* () {
        const h = yield* HostedProcesses
        const found = yield* h.reap
        return {
          reaped: found,
          project: yield* h.list(undefined, ""),
          trak: yield* h.list(TRAK, ""),
        }
      }).pipe(Effect.provide(supervisor([WEB], record, feed.layer, servers.layer))),
    )
    expect(reaped).toEqual([{ trak: undefined, name: "web", pid: 4242, outcome: "gone" }])
    expect(readRegistry(cwd)).toEqual({})
    expect(project.map((run) => run.state._tag)).toEqual(["StoppedByRestart"])
    expect(trak.map((run) => run.state._tag)).toEqual(["NotStarted"])
  })
})

/**
 * The rule a reader applies, as documented beside the `processes/*.sh` header: live only
 * while the pid exists and `ps` reports the start time the entry carries.
 */
const isLive = (entry: Registry[string]): boolean => {
  if (entry.started === undefined) return false
  try {
    const lstart = execFileSync("ps", ["-p", String(entry.pid), "-o", "lstart="], {
      cwd: "/",
      encoding: "utf8",
    })
    return lstart.trim() === entry.started
  } catch {
    // `ps -p` exits non-zero for a pid that does not exist.
    return false
  }
}

const SERVE = `require("http").createServer((q, r) => r.end("hi")).listen(Number(process.env.PORT), "127.0.0.1")`

const realServer = (): HostedProcess => {
  const path = join(checkout(), "dev.sh")
  writeFileSync(path, `#!/bin/bash\nexec node -e '${SERVE}'\n`)
  chmodSync(path, 0o755)
  return declare("dev", [], path)
}

const entryOf = (cwd: string) => {
  const registry = readRegistry(cwd)
  const entry = registry === "absent" ? undefined : registry["dev"]
  if (entry === undefined) throw new Error("the registry has no entry for dev")
  return entry
}

describe("a stale registry entry", () => {
  it("is told from a live one by its pid and its start time", async () => {
    const cwd = checkout()
    const dev = realServer()
    const feed = registryAtEachFrame(cwd)
    const layer = supervisor([dev], undefined, feed.layer, NodeProcessLayer)
    const { entry, whileUp } = await Effect.runPromise(
      Effect.gen(function* () {
        const h = yield* HostedProcesses
        const run = yield* h.start(TRAK, cwd, "dev")
        expect(run.state._tag).toBe("Running")
        const read = entryOf(cwd)
        const live = isLive(read)
        yield* h.stop(TRAK, "dev")
        return { entry: read, whileUp: live }
      }).pipe(Effect.provide(layer), Effect.orDie),
    )
    expect(whileUp).toBe(true)
    // A different start time is a reused pid, and after the stop the pid is gone.
    expect(isLive({ ...entry, started: "Thu Jan  1 00:00:00 1970" })).toBe(false)
    expect(isLive(entry)).toBe(false)
  }, 20_000)
})
