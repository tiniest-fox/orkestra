// An Environment fake, answering what a flow test says the project's env script
// left exported — or failing the way one that broke does — what the engine's own
// process environment holds, and which MCP servers the host lists and signs in to.
//
// Same argument as the checks fake: a flow is about what the engine does with the
// answer, not about `bash` or the host. Whether a script is actually sourced, and what
// the host is asked, is the shell adapter's contract under `test/contract`.

import { Deferred, Effect, Either, Layer, Ref } from "effect"
import { McpServer } from "../../src/agent/types/session.js"
import type { SpawnStage } from "../../src/agent/types/spawn-stage.js"
import { NO_CONNECTIONS } from "../../src/workflow/adapters/environment-shell.js"
import type { DeclaredServer } from "../../src/workflow/domain/mcp-servers.js"
import {
  Environment,
  EnvironmentFailed,
  type EnvironmentShape,
  type GivenCredential,
  type TurnCredential,
} from "../../src/workflow/ports/environment.js"

/** The proxy a fake hands a session: what it was told, and nothing of a real runtime. */
export const fakeProxy = ({
  connection,
  url,
  key,
  host,
}: {
  readonly connection: string
  readonly url: string
  readonly key: string
  readonly host: string
}): McpServer =>
  McpServer.Stdio({
    command: "mcp-proxy",
    args: [connection, url],
    env: { ORK_MCP_KEY: key, ORK_MCP_HOST: host },
  })

/** What an engine no host started lists and signs in to: nothing. */
const noHost = NO_CONNECTIONS

/** An engine no host started: every spawn runs on what it inherited, and nobody is told of a refusal. */
const inherits = {
  secretNames: Effect.succeed([]),
  credential: () => Effect.succeed(Either.right({})),
  credentialRefused: () => Effect.void,
} satisfies Pick<EnvironmentShape, "secretNames" | "credential" | "credentialRefused">

/** The token `hostListing`'s host hands for every sign-in. */
export const HOST_TOKEN = "host-token"

/**
 * An engine a host started with `engine` set, whose host lists `servers` — or cannot be
 * asked for them, for a `Left` — and signs in to every `Connection` it lists, handing
 * `fakeProxy` for a session's server and `HOST_TOKEN` for a request.
 */
export const hostListing = (
  servers: Either.Either<readonly DeclaredServer[], string>,
  engine: Readonly<Record<string, string>> = {},
): Layer.Layer<Environment> =>
  Layer.succeed(Environment, {
    capture: () => Effect.succeed({}),
    engine: Effect.succeed(engine),
    connection: {
      servers: Effect.succeed(servers),
      server: (name, url) =>
        Effect.succeed(Either.right(fakeProxy({ connection: name, url, key: "k", host: "h" }))),
      token: () => Effect.succeed(HOST_TOKEN),
    },
    ...inherits,
  })

/** What a project with no env script gets: every spawn inherits, and nothing is captured. */
export const inheritedEnvironment: Layer.Layer<Environment> = Layer.succeed(Environment, {
  capture: () => Effect.succeed({}),
  engine: Effect.succeed({}),
  connection: noHost,
  ...inherits,
})

/** A script that left these exported, whatever directory it was sourced in. */
export const environmentOf = (vars: Readonly<Record<string, string>>): Layer.Layer<Environment> =>
  Layer.succeed(Environment, {
    capture: () => Effect.succeed(vars),
    engine: Effect.succeed({}),
    connection: noHost,
    ...inherits,
  })

/** A script that exits non-zero every time, with this on its stderr. */
export const environmentFailing = (reason: string): Layer.Layer<Environment> =>
  Layer.succeed(Environment, {
    capture: () => Effect.fail(new EnvironmentFailed({ reason })),
    engine: Effect.succeed({}),
    connection: noHost,
    ...inherits,
  })

/** What a host heard from the engine: each spawn it was asked about, and each refusal it was told of. */
export interface HostHeard {
  readonly asked: Parameters<EnvironmentShape["credential"]>[0][]
  readonly refused: GivenCredential[]
}

/**
 * An engine a host started, whose host answers each spawn with what `answer` says for the
 * ask — read at the ask, so a test can change it between turns — and writes what it heard
 * into `heard`.
 */
export const hostCredentials = (
  answer: Ref.Ref<(ask: HostHeard["asked"][number]) => Either.Either<TurnCredential, string>>,
  heard: Ref.Ref<HostHeard>,
): Layer.Layer<Environment> =>
  Layer.succeed(Environment, {
    capture: () => Effect.succeed({}),
    engine: Effect.succeed({}),
    secretNames: Effect.succeed([]),
    connection: noHost,
    credential: (ask) =>
      Effect.zipRight(
        Ref.update(heard, (h) => ({ ...h, asked: [...h.asked, ask] })),
        Effect.map(Ref.get(answer), (f) => f(ask)),
      ),
    credentialRefused: (given) =>
      Ref.update(heard, (h) => ({ ...h, refused: [...h.refused, given] })),
  })

/**
 * No env script's variables. A capture that hears stages — a process start's — tells its
 * caller `stage` and then waits for `until`, so a start is held preparing for as long as a
 * test needs to look at it; every other capture, a turn's, answers at once.
 */
export const environmentHeldAt = (
  stage: SpawnStage,
  until: Deferred.Deferred<void>,
): Layer.Layer<Environment> =>
  Layer.succeed(Environment, {
    capture: (_cwd, onStage) =>
      onStage === undefined
        ? Effect.succeed({})
        : Effect.as(Effect.zipRight(onStage(stage), Deferred.await(until)), {}),
    engine: Effect.succeed({}),
    connection: noHost,
    ...inherits,
  })
