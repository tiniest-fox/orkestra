// A Process fake for the hosted-process supervisor: each spawn is a server in this test's
// own process, listening on the `$PORT` it was handed — when the test says so, or after a
// delay — so the supervisor's real probe decides when it is up. Nothing is spawned.
//
// The probe is real rather than faked because when a process counts as up is the
// supervisor's own decision, and the ordering `needs:` promises is ordering against it.

import { createServer, type Server } from "node:net"
import { basename } from "node:path"
import { Deferred, Effect, Layer, Stream } from "effect"
import { type Exited, Process } from "../../src/agent/ports/process.js"
import { Feed, type Frame } from "../../src/workflow/ports/feed.js"
import type { HostedState } from "../../src/workflow/ports/hosted-processes.js"

/** When a server starts listening: this many milliseconds after its spawn, or never on its own. */
export type Listens = number | "when-told"

interface Running {
  readonly server: Server
  readonly port: number
  readonly exit: Deferred.Deferred<Exited>
}

const listen = (run: Running): Effect.Effect<void> =>
  Effect.async<void>((resume) => {
    run.server.listen({ port: run.port, host: "127.0.0.1" }, () => {
      resume(Effect.void)
    })
  })

const end = (run: Running, exited: Exited): Effect.Effect<void> =>
  Effect.suspend(() => {
    run.server.close()
    return Effect.asVoid(Deferred.succeed(run.exit, exited))
  })

/**
 * Servers named by the script they were spawned for — `web.sh` is `web` — each listening
 * as `listens` says, `"when-told"` for a name it does not mention.
 */
export const fakeServers = (listens: Readonly<Record<string, Listens>>) => {
  const spawned: string[] = []
  const running = new Map<string, Running>()
  let pid = 1000
  const layer = Layer.succeed(Process, {
    spawn: (spec) =>
      Effect.gen(function* () {
        // A run in a sandbox is first asked, by a spawn of its own, whether it answers
        // there; it carries no `$PORT`, and the fake says that it does.
        if (spec.env["PORT"] === undefined) {
          return {
            pid: 1,
            lines: Stream.empty,
            exited: Effect.succeed({ code: 0, signal: undefined, stderr: "" }),
            send: () => Effect.void,
            endInput: Effect.void,
          }
        }
        const name = basename(spec.args[2] ?? "", ".sh")
        const run: Running = {
          server: createServer((socket) => socket.end()),
          port: Number(spec.env["PORT"]),
          exit: yield* Deferred.make<Exited>(),
        }
        spawned.push(name)
        running.set(name, run)
        yield* Effect.addFinalizer(() =>
          end(run, { code: undefined, signal: "SIGTERM", stderr: "" }),
        )
        const after = listens[name] ?? "when-told"
        if (after !== "when-told") yield* Effect.forkScoped(Effect.delay(listen(run), after))
        pid += 1
        return {
          pid,
          lines: Stream.empty,
          exited: Deferred.await(run.exit),
          send: () => Effect.void,
          endInput: Effect.void,
        }
      }),
    isAlive: () => Effect.succeed(false),
    kill: () => Effect.void,
    startTime: (at) => Effect.succeed(`started ${String(at)}`),
    killExec: () => Effect.void,
  })
  const latest = (name: string): Running => {
    const run = running.get(name)
    if (run === undefined) throw new Error(`nothing named ${name} was spawned`)
    return run
  }
  return {
    layer,
    /** Every spawn, by name, in order. */
    spawned,
    /** The latest run of `name` starts listening. */
    up: (name: string) => Effect.suspend(() => listen(latest(name))),
    /** The latest run of `name` ends on its own with `code`. */
    exit: (name: string, code: number) =>
      Effect.suspend(() => end(latest(name), { code, signal: undefined, stderr: "" })),
  }
}

/**
 * A Feed that keeps each process frame as `<name> <state>`, in the order it was published,
 * and each state whole in `states`.
 */
export const processFrames = () => {
  const lines: string[] = []
  const states: HostedState[] = []
  const record = (frame: Frame): void => {
    if (frame._tag !== "Process") return
    lines.push(`${frame.process.name} ${frame.process.state._tag}`)
    states.push(frame.process.state)
  }
  const layer = Layer.succeed(Feed, {
    publish: (frame) =>
      Effect.sync(() => {
        record(frame)
      }),
    since: () => Effect.die("this feed keeps what was published and replays none of it"),
  })
  return { layer, lines, states }
}
