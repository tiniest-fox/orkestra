// The MCP servers the host lists for every session, and what one session dials of them.
//
// Declared, not resolved: a value in `env` or `headers` may still hold `${NAME}`, which
// names a secret the engine fills from its own environment when a session starts. The
// list itself never holds a credential.
//
// Resolved when a session starts rather than once, so a server added in Settings, or a
// secret the host hands the engine, reaches the next turn. Only the engine's own
// environment fills a reference — never what a project's env script exports, which a
// goal's composer and a view press never run. A backup file's `secrets:` never fill one:
// a server config reaches the agent's CLI, and a backup key there could delete every
// snapshot, a store key rewrite every log.
//
// A `Connection` is dialed through the host's sign-in, so what it becomes is the host's
// answer rather than anything here: the caller asks before resolving, and hands in the
// server the session starts for it or the reason there is none.

import { Data, Either } from "effect"
import { reservedVariable } from "@orkestra/shared/variables"
import { McpServer } from "../../agent/types/session.js"

/**
 * One server as the host lists it, under the name its tools are called by. A `Stdio`
 * server is one the CLI starts; an `Http` one is already running and dialed over
 * streamable HTTP.
 *
 * A `Connection` is an http server signed in to through the host rather than through
 * `headers`: `name` is also the name the sign-in is stored by, and the session dials `url`
 * through the engine's proxy, which asks the host for the token.
 *
 * The tags and fields are the wire shape of the host's answer, which a host decodes into
 * this type directly — renaming one breaks every host.
 */
export type DeclaredServer = Data.TaggedEnum<{
  Connection: { readonly name: string; readonly url: string }
  Stdio: {
    readonly name: string
    readonly command: string
    readonly args: readonly string[]
    readonly env: Readonly<Record<string, string>>
  }
  Http: {
    readonly name: string
    readonly url: string
    readonly headers: Readonly<Record<string, string>>
  }
}>
export const DeclaredServer = Data.taggedEnum<DeclaredServer>()

/** A listed server the host signs in to. */
export type ConnectionServer = Extract<DeclaredServer, { _tag: "Connection" }>

/** `${NAME}` — the whole of the reference syntax. */
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

export interface ResolvedServers {
  /** By the name each server's tools are called under. */
  readonly servers: Readonly<Record<string, McpServer>>
  /** One line per server left out of the session, or one for a host that was not asked. */
  readonly lines: readonly string[]
  /** The line for each server left out, for a missing secret or a sign-in, by its name. */
  readonly skipped: ReadonlyMap<string, string>
  /** The `Connection` servers the list held, dialed or not. */
  readonly connections: readonly ConnectionServer[]
}

/** The names a server needed and could not be given, by why. */
interface Unfilled {
  readonly missing: Set<string>
  readonly withheld: Set<string>
  readonly reserved: Set<string>
}

/**
 * Every value with each `${NAME}` replaced, or the names it needed and `env` lacked. An
 * empty value counts as missing: a shell can export `X=`, and a server sent an empty
 * token fails to authenticate with nothing saying why. A name in `withheld` is never
 * filled, whatever `env` holds, and neither is a variable the engine sets for itself —
 * its key to the host among them — which would hand that value to a server the list chose.
 */
const filled = (
  values: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string | undefined>>,
  withheld: readonly string[],
  unfilled: Unfilled,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value.replace(REFERENCE, (_whole, name: string) => {
        if (reservedVariable(name)) {
          unfilled.reserved.add(name)
          return ""
        }
        if (withheld.includes(name)) {
          unfilled.withheld.add(name)
          return ""
        }
        const secret = env[name]
        if (secret === undefined || secret === "") unfilled.missing.add(name)
        return secret ?? ""
      }),
    ]),
  )

/** `the secret \`A\` is` or `the secrets \`A\`, \`B\` are`. */
const secretsPhrase = (names: ReadonlySet<string>): string => {
  const listed = [...names].map((n) => `\`${n}\``).join(", ")
  return names.size === 1 ? `the secret ${listed} is` : `the secrets ${listed} are`
}

/** What the host said about each `Connection` server, by its name. */
export type Dialed = ReadonlyMap<string, Either.Either<McpServer, string>>

/** The `Connection` servers a list holds — the ones a caller asks the host about. */
export const connectionsOf = (servers: readonly DeclaredServer[]): readonly ConnectionServer[] =>
  servers.flatMap((s) => (s._tag === "Connection" ? [s] : []))

/** One server filled from `env`, or why it is left out. */
const resolved = (
  server: DeclaredServer,
  env: Readonly<Record<string, string | undefined>>,
  dialed: Dialed,
  withheld: readonly string[],
): Either.Either<McpServer, string> => {
  if (server._tag === "Connection") {
    return dialed.get(server.name) ?? Either.left("the host was not asked for its sign-in")
  }
  const unfilled: Unfilled = { missing: new Set(), withheld: new Set(), reserved: new Set() }
  const filledServer =
    server._tag === "Stdio"
      ? McpServer.Stdio({
          command: server.command,
          args: server.args,
          env: filled(server.env, env, withheld, unfilled),
        })
      : McpServer.Http({
          url: server.url,
          headers: filled(server.headers, env, withheld, unfilled),
        })
  if (unfilled.reserved.size > 0) {
    return Either.left(
      `${secretsPhrase(unfilled.reserved)} one the engine sets for itself, which no session is handed`,
    )
  }
  if (unfilled.withheld.size > 0) {
    return Either.left(
      `${secretsPhrase(unfilled.withheld)} a backup file's, which no session is handed`,
    )
  }
  if (unfilled.missing.size === 0) return Either.right(filledServer)
  return Either.left(`${secretsPhrase(unfilled.missing)} not set in the engine's environment`)
}

/**
 * Resolved once: a filled value is never read for references again. `withheld` are the
 * backup file's `secrets:`, which leave out any server that names one.
 */
export const resolveServers = (
  list: readonly DeclaredServer[],
  env: Readonly<Record<string, string | undefined>>,
  dialed: Dialed,
  withheld: readonly string[],
): ResolvedServers => {
  const servers: Record<string, McpServer> = {}
  const skipped = new Map<string, string>()
  for (const server of list) {
    Either.match(resolved(server, env, dialed, withheld), {
      onLeft: (reason) =>
        skipped.set(
          server.name,
          `MCP server \`${server.name}\` was left out of this turn: ${reason}.`,
        ),
      onRight: (session) => {
        servers[server.name] = session
      },
    })
  }
  return { servers, lines: [...skipped.values()], skipped, connections: connectionsOf(list) }
}

/** What a session dials when the host could not be asked: none of its servers, and why. */
export const hostUnasked = (reason: string): ResolvedServers => ({
  servers: {},
  lines: [`The host's MCP servers were left out of this turn: ${reason}.`],
  skipped: new Map(),
  connections: [],
})
