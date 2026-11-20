// How a session reaches the engine serving it: the `orkestra` shim its tool servers run
// on, the HTTP routes a session in a sandbox dials instead, and the daemon's hosted
// processes, with where the pid record lives.
//
// **The shim is written at boot.** What runs `ork` differs by layout — `tsx` over
// `src/ork.ts` in the checkout, `node` over `ork.js` in the bundle, Electron's own Node in
// the desktop app — and the engine is already running under whichever it is, so the shim
// replays this process's own runtime and flags against `ORK_ENTRY`. A file rather than a
// command line in the MCP configuration, because the CLI starts the server and Codex runs
// it through a login shell of its own.

import { chmod, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Duration, Effect, Either, Layer, Ref } from "effect"
import { orkestraDir } from "../library/adapters/library-fs.js"
import { ShellHostedProcessesLayer } from "../workflow/adapters/processes-shell.js"
import { McpServer } from "../agent/types/session.js"
import type { GoalId, TrakId } from "../workflow/domain/trak.js"
import { PROJECT_SANDBOX } from "../vcs/logic/paths.js"
import { Sandboxes, type SandboxesShape } from "../vcs/ports/sandboxes.js"
import type { GoalServers, ReachedTools } from "../workflow/ports/turn-tools.js"
import { goalToken, trakToken } from "./guard.js"
import { ORK_ENTRY } from "./packaged.js"

/** How a turn reaches the engine serving it: its address, and the boot's token. */
export interface Hosting {
  readonly engine: string
  readonly token: string
}

/** One word for `sh`, whatever it holds. */
const quoted = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`

/**
 * The shim's text. `ELECTRON_RUN_AS_NODE` is set again here because every child loses
 * it — `spawnEnv` strips it — and without it Electron's binary boots the app instead.
 */
const shimText = (): string => {
  const runtime = [process.execPath, ...process.execArgv, ORK_ENTRY].map(quoted).join(" ")
  const electron = process.versions["electron"] === undefined ? "" : "ELECTRON_RUN_AS_NODE=1 "
  return `#!/bin/sh\nexec env ${electron}${runtime} "$@"\n`
}

const writeShim = (bin: string): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(bin, { recursive: true })
      const path = join(bin, "orkestra")
      await writeFile(path, shimText())
      await chmod(path, 0o755)
    },
    catch: (cause) =>
      new Error(`could not write the orkestra command into ${bin}: ${String(cause)}`),
  })

/** Where the shim is written: `.database/bin/` beside `daemon.json`. */
const binOf = (cwd: string) => Effect.map(orkestraDir(cwd), (dir) => join(dir, ".database", "bin"))

/**
 * The servers a goal composer's session may be handed. On this machine, the same shim as
 * `orkestra goal-tools`, told which engine to forward each call to, which goal it serves
 * and the credential for that goal's tool routes. In the project's sandbox, where the shim
 * is not, the routes `trak-mcp.ts` serves for the goal at the engine's loopback address,
 * with the engine's port held open there for the turn as a trak's is (`reachedTools`).
 * `undefined` where no engine is listening, since a tool call would have nowhere to go.
 */
export const goalToolsServer = (cwd: string, hosting: Hosting | undefined) =>
  Effect.zipWith(
    binOf(cwd),
    Sandboxes,
    (bin, sandboxes): ((goal: GoalId) => GoalServers) | undefined =>
      hosting === undefined
        ? undefined
        : (goal) => ({
            here: McpServer.Stdio({
              command: join(bin, "orkestra"),
              args: ["goal-tools"],
              env: {
                ORK_GOAL_ENGINE: hosting.engine,
                ORK_GOAL_TOKEN: goalToken(hosting.token, goal),
                ORK_GOAL_ID: goal,
              },
            }),
            reached: {
              tools: McpServer.Http({
                url: `${hosting.engine}/api/goals/${encodeURIComponent(goal)}/mcp`,
                headers: { authorization: `Bearer ${goalToken(hosting.token, goal)}` },
              }),
              reach: (say) =>
                heldUntilAnswered(
                  sandboxes,
                  PROJECT_SANDBOX,
                  Number(new URL(hosting.engine).port),
                  REACH_WAIT,
                  say,
                ),
            },
          }),
  )

/**
 * The server a step's session is handed for the engine's tools — its checks, its declared
 * processes and the engine tools: the same shim as `orkestra trak-tools`, told the engine,
 * the trak and the credential for that trak's tool routes. `undefined` where no engine is
 * listening.
 *
 * **No timeout a check can reach.** A call waits for its check — behind another trak's
 * in the exclusive queue, then for as long as it runs — and both CLIs cut a tool call
 * off well short of that unless told otherwise.
 */
export const trakToolsServer = (cwd: string, hosting: Hosting | undefined) =>
  Effect.map(binOf(cwd), (bin): ((trak: TrakId) => McpServer) | undefined =>
    hosting === undefined
      ? undefined
      : (trak) =>
          McpServer.Stdio({
            command: join(bin, "orkestra"),
            args: ["trak-tools"],
            env: {
              ORK_TRAK_ENGINE: hosting.engine,
              ORK_TRAK_TOKEN: trakToken(hosting.token, trak),
              ORK_TRAK_ID: trak,
            },
            timeoutSeconds: TOOL_CALL_CEILING,
          }),
  )

/** The bearer a trak's tool routes admit, as an HTTP server's headers. */
const trakBearer = (hosting: Hosting, trak: TrakId) => ({
  authorization: `Bearer ${trakToken(hosting.token, trak)}`,
})

/**
 * What a turn in the trak's sandbox is handed to sign in to GitHub, beside its tools — where
 * an engine's host asks for each token itself. Left out, a turn there is handed nothing, and
 * the checkout's own helper reads the `GH_TOKEN` the runner's `pass:` hands.
 */
export type TurnGitHub = (hosting: Hosting, trak: TrakId) => Readonly<Record<string, string>>

/** What a turn's transcript says when the engine's port is not in the trak's sandbox. */
const unreachedNote = (said: string): string =>
  `The engine's port could not be brought into this trak's sandbox, so this turn may be without the engine's tools and every \`connection:\` server: ${said}`

/**
 * How long a sandboxed turn is held for the engine's health to answer through its port in
 * the sandbox before it starts anyway. Claude Code gives a server thirty seconds to
 * connect and never asks again, so a turn spawned while the reach is down runs its whole
 * length without the tools; twenty seconds covers a `reach` that is still coming up, and
 * its first few reopenings, while a reach that stays down costs a turn no more than that,
 * and a runner whose exec hangs fifteen seconds more (`HEALTH_MARGIN`).
 */
const REACH_WAIT = Duration.seconds(20)

/** What a turn's transcript says when the engine's health did not answer from the sandbox in time. */
const unansweredNote = (why: string, said: string | undefined, within: Duration.Duration) =>
  `The engine did not answer from this trak's sandbox within ${Duration.format(within)}, so this turn starts without the engine's tools and every \`connection:\` server: ${why}${said === undefined ? "" : `. The reach said: ${said}`}`

/**
 * Where a step's session reaches the engine from the trak's sandbox, under a runner file:
 * the routes `trak-mcp.ts` serves, at the engine's own loopback address — which the
 * `reach` tunnel makes the same address inside the sandbox — with the trak's token as the
 * bearer the shim would have sent. `undefined` with no runner file, for a trak placed on
 * this machine, or with no engine listening, and the session is handed the stdio servers
 * as on this machine. A turn there is handed `github`'s variables, where it is given.
 *
 * **The turn is held until the engine's health answers through the tunnel, for `within`
 * at most, and then starts whatever the answer.** The relay in the sandbox accepts a
 * connection as soon as it listens and holds it while nothing behind it answers, so the
 * CLI's connect times out with nothing said; this asks the way the CLI will, from inside
 * the sandbox, and a turn that starts without its tools says so in the engine's log and on
 * the trak, with the last thing the reach said.
 */
export const reachedTools = (
  hosting: Hosting | undefined,
  within: Duration.Duration = REACH_WAIT,
  github?: TurnGitHub,
) =>
  Effect.map(Sandboxes, (sandboxes) => (trak: TrakId): Effect.Effect<ReachedTools | undefined> => {
    if (hosting === undefined) return Effect.succeed(undefined)
    const routes = `${hosting.engine}/api/traks/${encodeURIComponent(trak)}/mcp`
    const port = Number(new URL(hosting.engine).port)
    const env = github?.(hosting, trak)
    return Effect.map(sandboxes.holds(trak), (inUse): ReachedTools | undefined =>
      inUse
        ? {
            ...(env === undefined ? {} : { env }),
            tools: McpServer.Http({
              url: routes,
              headers: trakBearer(hosting, trak),
              timeoutSeconds: TOOL_CALL_CEILING,
            }),
            connection: (name) =>
              McpServer.Http({
                url: `${routes}/${encodeURIComponent(name)}`,
                headers: trakBearer(hosting, trak),
              }),
            reach: (say) => heldUntilAnswered(sandboxes, trak, port, within, say),
          }
        : undefined,
    )
  })

/** `ReachedTools.reach`: the tunnel opened, then the turn held until the engine answers through it. */
const heldUntilAnswered = (
  sandboxes: SandboxesShape,
  trak: string,
  port: number,
  within: Duration.Duration,
  say: (text: string) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const ended = yield* Ref.make<string | undefined>(undefined)
    const opened = yield* sandboxes
      .reach(trak, port, (said) => Effect.zipRight(Ref.set(ended, said), say(unreachedNote(said))))
      .pipe(Effect.either)
    if (Either.isLeft(opened)) {
      yield* Effect.logWarning(
        `the engine's port could not be brought into ${trak}'s sandbox: ${opened.left.reason}`,
      )
      return yield* say(unreachedNote(opened.left.reason))
    }
    const answered = yield* Effect.either(sandboxes.healthThrough(trak, port, within))
    if (Either.isRight(answered)) return
    const said = yield* Ref.get(ended)
    yield* Effect.logWarning(
      `${trak}: the turn starts without its engine tools, since the engine's health did not answer through port ${String(port)} in its sandbox within ${Duration.format(within)}: ${answered.left.reason}${said === undefined ? "" : `; the reach said: ${said}`}`,
    )
    yield* say(unansweredNote(answered.left.reason, said, within))
  })

/** A day: past any check's own timeout and any wait for the exclusive turn. */
const TOOL_CALL_CEILING = 24 * 60 * 60

/**
 * The supervisor, with its record under `.database/` beside `daemon.json` — and, where an
 * HTTP engine is listening, the shim the tool servers run on, written before the first
 * session could need it.
 */
export const hostedProcessesLayer = (cwd: string, hosting: Hosting | undefined) =>
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const database = join(yield* orkestraDir(cwd), ".database")
      if (hosting !== undefined) yield* writeShim(yield* binOf(cwd))
      return ShellHostedProcessesLayer({ record: join(database, "processes.json") })
    }),
  )
