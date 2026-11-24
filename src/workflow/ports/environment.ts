import { Context, Data, Effect, type Either } from "effect"
import type { ProcessSpec } from "../../agent/ports/process.js"
import type { McpServer, SignIn } from "../../agent/types/session.js"
import type { SpawnStage } from "../../agent/types/spawn-stage.js"
import {
  connectionsOf,
  type ResolvedServers,
  resolveServers,
} from "../../library/logic/mcp-resolve.js"
import type { Library } from "../../library/types/library.js"
import type { UserId } from "../domain/trak.js"
import { runnerFilesNow } from "../../vcs/ports/runners.js"

/**
 * The project's env script did not produce an environment: it exited non-zero, it
 * timed out, or it could not be spawned. `reason` names the script and carries its
 * stderr, because that is the only account of what went wrong.
 */
export class EnvironmentFailed extends Data.TaggedError("EnvironmentFailed")<{
  readonly reason: string
  /** The runners-only guard's refusal of the script's spawn — see `ProcessFailed`. */
  readonly runnersOnly?: string
  /** The ref holding the sandbox's uncommitted changes — see `ProcessFailed`. */
  readonly carried?: string
}> {}

/**
 * The environment a spawn in a worktree is given over what the engine inherited — see
 * `Library.env`. Here rather than on `Process`, because `Process` is also how the engine
 * runs `git` and `gh`, and those never run the script.
 *
 * **Fails, unlike `Checks`, and the caller decides what that means**: a check that could
 * not get its environment is a check that failed, and a turn that could not is
 * `TurnFailed` — the same two answers a script that cannot be spawned already gets.
 */
export interface EnvironmentShape {
  /**
   * Sources the script in `cwd` and answers what it left exported, already stripped of
   * the engine's own variables. Empty, and nothing spawned, for a project without one.
   * `onStage` hears how far the script's spawn has got — see `ProcessSpec.onStage`.
   * `placed` is laid on the script's spawn, so it runs where the spawn it serves will.
   */
  readonly capture: (
    cwd: string,
    onStage?: (stage: SpawnStage) => Effect.Effect<void>,
    placed?: Pick<ProcessSpec, "inProject" | "passOnly">,
  ) => Effect.Effect<Readonly<Record<string, string>>, EnvironmentFailed>
  /**
   * The engine's own process environment, read when asked, which is where the host
   * hands an engine its named secrets. What fills a `${NAME}` in `mcp.yaml` — never
   * `capture`'s result, which a goal's composer and a view press do not run.
   */
  readonly engine: Effect.Effect<Readonly<Record<string, string | undefined>>>
  /**
   * The variables of `engine` that whoever started the engine set from a secret, or handed
   * it as one, read when asked, whose values the engine tools take out of what they answer.
   * None on an engine nobody hosts; a host's adapter may name some.
   */
  readonly secretNames: Effect.Effect<readonly string[]>
  /** What the engine has for an `mcp.yaml` server with `connection:` — see `Connections`. */
  readonly connection: Connections
  /**
   * What an agent spawn for a turn `owner` owns signs in with, asked of the host before
   * every spawn; or why the turn may not run, which parks it. An engine no host started asks
   * nothing and runs every spawn on what it inherited. `cli` is the CLI the turn runs,
   * `signInFile` whether it signs in through a file rather than a variable, and `server`
   * whether the turn runs on the engine's machine rather than in a sandbox — which, from two
   * users, only the first user's credential may.
   */
  readonly credential: (ask: {
    readonly owner: UserId | undefined
    readonly cli: string
    readonly signInFile: boolean
    readonly server: boolean
  }) => Effect.Effect<Either.Either<TurnCredential, string>>
  /** Tell the host the CLI failed a turn on authentication with `given`. Never fails. */
  readonly credentialRefused: (given: GivenCredential) => Effect.Effect<void>
}

/** A host user's credential a spawn ran on, by slot — what a refusal of it names. */
export interface GivenCredential {
  readonly user: string
  readonly name: string
  readonly setAt: number
}

/** What one spawn signs in with: nothing of its own where both are absent. */
export interface TurnCredential {
  readonly signIn?: SignIn
  readonly given?: GivenCredential
}

/**
 * Why the engine has no token for a `connection:` server. `asked` is false where it holds no
 * key to ask a host with, and true where the host was asked and gave none, or could not be
 * reached.
 */
export class ConnectionUnavailable extends Data.TaggedError("ConnectionUnavailable")<{
  readonly reason: string
  readonly asked: boolean
}> {}

/**
 * The two ways a `connection:` server is reached: by the stdio server a session's CLI starts
 * on this machine, and by the engine's own route, which forwards each request from a
 * session in a sandbox.
 */
export interface Connections {
  /**
   * The server a session starts for `connection`, or why it has none: the engine holds no
   * key from a host, or the host will not hand it a token for `connection`. Asked at every
   * session start, so a binding made in Settings reaches the next turn.
   */
  readonly server: (
    connection: string,
    url: string,
  ) => Effect.Effect<Either.Either<McpServer, string>>
  /** A token to send to `url` for one request, fetched at each ask. */
  readonly token: (connection: string, url: string) => Effect.Effect<string, ConnectionUnavailable>
}

/**
 * What one session dials of the servers `mcp.yaml` declares: each `connection:` server
 * asked of the host, then every server resolved against the engine's environment, with
 * the backup file's `secrets:` withheld from it.
 */
export const declaredServers = (
  environment: EnvironmentShape,
  library: Pick<Library, "mcp">,
): Effect.Effect<ResolvedServers> =>
  Effect.gen(function* () {
    const { backup } = yield* runnerFilesNow
    const dialed = yield* Effect.forEach(
      connectionsOf(library.mcp),
      (server) =>
        Effect.map(
          environment.connection.server(server.connection, server.url),
          (answer): [string, Either.Either<McpServer, string>] => [server.name, answer],
        ),
      { concurrency: "unbounded" },
    )
    return resolveServers(
      library.mcp,
      yield* environment.engine,
      new Map(dialed),
      backup?.secrets ?? [],
    )
  })

export class Environment extends Context.Tag("workflow/Environment")<
  Environment,
  EnvironmentShape
>() {}
