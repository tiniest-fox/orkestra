// The only Layer here: the project's env script, sourced by `bash` over the Process
// port and read back as the variables it left exported.
//
// **Sourced, never wrapped around the spawn.** A `bash -c 'source env.sh; exec claude'`
// would put whatever the script prints into claude's JSON event stream, and a binary the
// script failed to put on PATH would read as bash's exit 127 rather than as the script's
// own failure. So the script runs on its own, in the directory the spawn will run in,
// and the spawn gets its result as plain variables.
//
// The script's stdout goes to stderr while it is sourced, so the only things on stdout are
// `env -0` and the end marker after it — and anything the script had to say arrives with
// its failure. Positional
// parameters are cleared before it runs, so it does not see its own path as `$1`.
//
// An engine here has no host to ask: it lists no MCP server, signs in to none, and every spawn runs
// on what the engine inherited. A host may provide an adapter that wraps this one and asks
// the host.

import { Duration, Effect, Either, Layer, Stream } from "effect"
import { capturedEnv } from "../../agent/logic/spawn-env.js"
import { Process, type ProcessShape, type ProcessSpec } from "../../agent/ports/process.js"
import type { SpawnStage } from "../../agent/types/spawn-stage.js"
import type { Check } from "../../library/types/check.js"
import {
  ConnectionUnavailable,
  type Connections,
  Environment,
  EnvironmentFailed,
  type EnvironmentShape,
} from "../ports/environment.js"
import { libraryNow } from "../ports/project-files.js"

/**
 * Printed after the dump, and the only proof the dump happened. A sourced script that
 * ends with `exit 0` — or `exit`, or an `exec` — ends this shell before `env -0` runs,
 * with a clean exit and an empty stdout, and an empty stdout is what a project with no
 * variables to add would also produce. Judged by the exit code alone, that script would
 * fall back to the inherited environment without a word, which is the one outcome the
 * script exists to remove.
 */
const END = "__ORKESTRA_ENV_END__"

const SOURCE_THEN_DUMP = `__orkestra_env="$1"; set --; source "$__orkestra_env" 1>&2 && env -0 && printf '%s' ${END}`

const inherited: Readonly<Record<string, string>> = {}

const failed = (
  script: Check,
  said: string,
  runnersOnly?: string,
  carried?: string,
): EnvironmentFailed =>
  new EnvironmentFailed({
    reason: `env script \`${script.path}\` ${said}`,
    ...(runnersOnly === undefined ? {} : { runnersOnly }),
    ...(carried === undefined ? {} : { carried }),
  })

const capture = (
  proc: ProcessShape,
  script: Check,
  cwd: string,
  onStage: ((stage: SpawnStage) => Effect.Effect<void>) | undefined,
  placed: Pick<ProcessSpec, "inProject" | "passOnly">,
): Effect.Effect<Readonly<Record<string, string>>, EnvironmentFailed> =>
  Effect.gen(function* () {
    const spawned = yield* proc.spawn({
      command: "bash",
      args: ["-c", SOURCE_THEN_DUMP, "bash", script.path],
      cwd,
      env: inherited,
      stdin: undefined,
      holdStdin: false,
      ...(onStage === undefined ? {} : { onStage }),
      ...placed,
    })
    // Drained before awaiting exit, for the reason `checks-shell.ts` gives: a full
    // pipe blocks the child, which looks exactly like a hang. Rejoined on the
    // newline readline split on, so a record holding one comes back whole.
    const lines = yield* Stream.runCollect(spawned.lines)
    const exited = yield* spawned.exited
    if (exited.code !== 0) {
      return yield* failed(
        script,
        `exited ${exited.code ?? "?"}${exited.signal === undefined ? "" : ` (${exited.signal})`}:\n${exited.stderr.trim()}`,
      )
    }
    const dump = [...lines].join("\n")
    if (!dump.endsWith(END)) {
      return yield* failed(
        script,
        `ended the shell before its variables could be read. A sourced script ends with \`return\`, not \`exit\`.${exited.stderr.trim() === "" ? "" : `\n${exited.stderr.trim()}`}`,
      )
    }
    return capturedEnv(dump.slice(0, -END.length))
  }).pipe(
    // Scoped inside the timeout, so timing out closes the scope and kills the script —
    // the same order `checks-shell.ts` keeps, for the same reason.
    Effect.scoped,
    Effect.timeoutFail({
      duration: Duration.seconds(script.timeoutSeconds),
      onTimeout: () => failed(script, `timed out after ${script.timeoutSeconds}s.`),
    }),
    Effect.catchTag("ProcessFailed", (e) =>
      failed(script, `could not be run: ${e.reason}`, e.runnersOnly, e.carried),
    ),
  )

/** What an engine no host started says of a sign-in. */
const unhosted = (connection: string) =>
  `the engine was not started by a host, so it holds no key to ask for the \`${connection}\` sign-in`

/**
 * No server listed, and no server or token for any sign-in: there is no host to ask. A
 * session dials the engine's own servers and whatever its CLI reads from the checkout.
 */
export const NO_CONNECTIONS: Connections = {
  servers: Effect.succeed(Either.right([])),
  server: (connection) => Effect.succeed(Either.left(unhosted(connection))),
  token: (connection) =>
    Effect.fail(new ConnectionUnavailable({ reason: unhosted(connection), asked: false })),
}

/** `engine` is the engine's own environment, read on each ask — a test hands its own. */
export const ShellEnvironmentLayer = (
  engine: () => Readonly<Record<string, string | undefined>> = () => process.env,
) =>
  Layer.effect(
    Environment,
    Effect.gen(function* () {
      const proc = yield* Process
      // Read on each capture rather than here, so a reload's `env.sh` is the next spawn's.
      const library = yield* libraryNow
      const shape: EnvironmentShape = {
        // Nothing spawned for a project without the script: its spawns inherit exactly
        // what the engine has, which is what every project did before this existed.
        capture: (cwd, onStage, placed = {}) =>
          Effect.flatMap(library, ({ env }) =>
            env === undefined
              ? Effect.succeed(inherited)
              : capture(proc, env, cwd, onStage, placed),
          ),
        // Read on each ask, so a variable set after boot is the next session's.
        engine: Effect.sync(() => ({ ...engine() })),
        secretNames: Effect.succeed([]),
        connection: NO_CONNECTIONS,
        credential: () => Effect.succeed(Either.right({})),
        credentialRefused: () => Effect.void,
      }
      return shape
    }),
  )
