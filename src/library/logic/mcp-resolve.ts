// logic: the declared servers and the engine's environment -> what one session dials.
//
// Run when a session starts rather than at load, so a secret the host hands the engine
// reaches the next turn. Only the engine's own environment fills a reference — never what
// a project's env script exports, which a goal's composer and a view press never run.
// A backup file's `secrets:` never fill one: a server config reaches the agent's
// CLI, and a backup key there could delete every snapshot, a store key rewrite every log.
//
// A `connection:` server is dialed through the host's sign-in, so what it becomes is the
// host's answer rather than anything here: the caller asks before resolving, and hands
// in the server the session starts for it or the reason there is none.

import { Either } from "effect"
import { McpServer } from "../../agent/types/session.js"
import type { DeclaredServer, McpFile } from "../types/mcp.js"
import { REFERENCE } from "./mcp-file.js"

export interface ResolvedServers {
  /** By the name each server's tools are called under. */
  readonly servers: Readonly<Record<string, McpServer>>
  /** One line per server left out of the session, and every problem with the file. */
  readonly lines: readonly string[]
  /** The line for each server left out, for a missing secret or a sign-in, by its name. */
  readonly skipped: ReadonlyMap<string, string>
}

/** The names a server needed and could not be given, by why. */
interface Unfilled {
  readonly missing: Set<string>
  readonly withheld: Set<string>
}

/**
 * Every value with each `${NAME}` replaced, or the names it needed and `env` lacked. An
 * empty value counts as missing: a shell can export `X=`, and a server sent an empty
 * token fails to authenticate with nothing saying why. A name in `withheld` is never
 * filled, whatever `env` holds.
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

/** What the host said about each `connection:` server, by its name in the file. */
export type Dialed = ReadonlyMap<string, Either.Either<McpServer, string>>

/** The `connection:` servers a file declares — the ones a caller asks the host about. */
export const connectionsOf = (
  file: McpFile,
): readonly Extract<DeclaredServer, { _tag: "Connection" }>[] =>
  file.servers.flatMap((s) => (s._tag === "Connection" ? [s] : []))

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
  const unfilled: Unfilled = { missing: new Set(), withheld: new Set() }
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
  file: McpFile,
  env: Readonly<Record<string, string | undefined>>,
  dialed: Dialed,
  withheld: readonly string[],
): ResolvedServers => {
  const servers: Record<string, McpServer> = {}
  const skipped = new Map<string, string>()
  for (const server of file.servers) {
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
  return { servers, lines: [...file.problems, ...skipped.values()], skipped }
}
