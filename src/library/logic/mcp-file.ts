// logic: the text of `.orkestra/mcp.yaml` -> the servers it declares, and what was wrong.
//
// The one `.orkestra/` file that cannot fail a load. A server it gets wrong is left out
// alone, with a line saying why; a file that is not YAML, or has no `servers:` map, adds
// no server and says so once. Either way the project loads and every turn runs — what a
// mistake here costs is a tool, and the line is how a person learns which.

import { Either, Schema } from "effect"
import { reservedVariable } from "@orkestra/shared/variables"
import { DeclaredServer, type McpFile, NO_MCP } from "../types/mcp.js"
import { parseYaml } from "./yaml.js"

/**
 * A server's name is a dotted key under Codex (`mcp_servers.<name>`) and part of every
 * tool name under Claude, so it holds no dot, no space and nothing either would quote.
 */
const NAME = /^[A-Za-z0-9_-]+$/

/** The engine's own tool servers' names: a declared one taking it would hide them. */
const RESERVED = "orkestra-"

/** `${NAME}` — the whole of the reference syntax. Anything else holding `${` is a mistake. */
export const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

const STDIO_KEYS: readonly string[] = ["command", "args", "env"]
const HTTP_KEYS: readonly string[] = ["url", "headers", "connection"]

const Strings = Schema.Array(Schema.String)
const StringMap = Schema.Record({ key: Schema.String, value: Schema.String })

const isMap = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Every `${` in `text` is part of a whole `${NAME}`. */
const referencesWellFormed = (text: string): boolean => !text.replace(REFERENCE, "").includes("${")

/**
 * The names `text` references that no secret may be. A reference is filled from the engine's
 * whole environment, so one naming a variable the engine sets for itself, its passphrase or
 * its key to a host among them, would send that value to a server the file chose.
 */
const reservedReferences = (text: string): readonly string[] =>
  [...text.matchAll(REFERENCE)].map((m) => m[1] ?? "").filter(reservedVariable)

/** A string map, or the reason it is not one. */
const stringMap = (
  key: string,
  value: unknown,
): Either.Either<Readonly<Record<string, string>>, string> =>
  value === undefined
    ? Either.right({})
    : Either.mapLeft(
        Schema.decodeUnknownEither(StringMap)(value),
        () => `\`${key}:\` has to map names to strings — quote a number or a boolean`,
      )

/** The name a `connection:` binds, held to the rule the host holds a binding to. */
const connection = (value: unknown): Either.Either<string, string> => {
  if (typeof value !== "string" || !NAME.test(value)) {
    return Either.left("`connection:` is a server name — letters, digits, `-` and `_`")
  }
  if (value.startsWith(RESERVED)) {
    return Either.left(
      `\`connection:\` names starting \`${RESERVED}\` are the engine's own servers`,
    )
  }
  return Either.right(value)
}

/** One entry under `servers:`, or the reason it was left out. */
const declared = (name: string, entry: unknown): Either.Either<DeclaredServer, string> =>
  Either.gen(function* () {
    if (!NAME.test(name)) {
      return yield* Either.left("a server's name may hold only letters, digits, `-` and `_`")
    }
    if (name.startsWith(RESERVED)) {
      return yield* Either.left(`names starting \`${RESERVED}\` are the engine's own servers`)
    }
    if (!isMap(entry)) return yield* Either.left("a server is a map of its settings")
    const stdio = "command" in entry
    if (stdio === "url" in entry) {
      return yield* Either.left("a server has `command:` (stdio) or `url:` (http), and not both")
    }
    const allowed = stdio ? STDIO_KEYS : HTTP_KEYS
    const unknown = Object.keys(entry).filter((k) => !allowed.includes(k))
    if (unknown.length > 0) {
      return yield* Either.left(
        `${unknown.map((k) => `\`${k}:\``).join(", ")} is not a key of ${stdio ? "a stdio" : "an http"} server (${allowed.join(", ")})`,
      )
    }
    const values = stdio ? entry["env"] : entry["headers"]
    const settings = yield* stringMap(stdio ? "env" : "headers", values)
    if (!Object.values(settings).every(referencesWellFormed)) {
      return yield* Either.left("a secret is named as `${NAME}` — letters, digits and `_`")
    }
    const reserved = [...new Set(Object.values(settings).flatMap(reservedReferences))]
    if (reserved.length > 0) {
      return yield* Either.left(
        `a reference may not name ${reserved.map((n) => `\`${n}\``).join(", ")} — the host and the engines it starts set it themselves, and it is never a secret`,
      )
    }
    // Claude expands `${VAR}` in its own server config and Codex does not, so a
    // reference anywhere else would behave differently per CLI.
    const outside = "a secret may be named only in `env` or `headers`"
    if (stdio) {
      const command = entry["command"]
      if (typeof command !== "string" || command === "") {
        return yield* Either.left("`command:` has to be a non-empty string")
      }
      const args = yield* Either.mapLeft(
        Schema.decodeUnknownEither(Strings)(entry["args"] ?? []),
        () => "`args:` has to be a list of strings",
      )
      if ([command, ...args].some((s) => s.includes("${"))) return yield* Either.left(outside)
      return DeclaredServer.Stdio({ name, command, args, env: settings })
    }
    const url = entry["url"]
    if (typeof url !== "string" || url === "") {
      return yield* Either.left("`url:` has to be a non-empty string")
    }
    if (url.includes("${")) return yield* Either.left(outside)
    if (!("connection" in entry)) return DeclaredServer.Http({ name, url, headers: settings })
    if ("headers" in entry) {
      return yield* Either.left("`connection:` is used in place of `headers:`, not beside it")
    }
    return DeclaredServer.Connection({
      name,
      url,
      connection: yield* connection(entry["connection"]),
    })
  })

/**
 * `text` is the file's content, or `undefined` where the project has none — which is
 * the ordinary case and says nothing. `shown` is the path a person would open.
 */
export const parseMcpFile = (shown: string, text: string | undefined): McpFile => {
  if (text === undefined) return NO_MCP
  const whole = (reason: string): McpFile => ({
    servers: [],
    problems: [`\`${shown}\` was not read, so no server it declares was added: ${reason}.`],
  })
  const parsed = parseYaml(shown, text)
  if (Either.isLeft(parsed)) return whole(parsed.left.reason)
  const file = parsed.right
  if (!isMap(file) || !isMap(file["servers"])) {
    return whole("it has no `servers:` map — servers are listed under `servers:`, by name")
  }
  const servers: DeclaredServer[] = []
  const problems: string[] = []
  for (const [name, entry] of Object.entries(file["servers"])) {
    Either.match(declared(name, entry), {
      onLeft: (reason) =>
        problems.push(`MCP server \`${name}\` in \`${shown}\` was left out: ${reason}.`),
      onRight: (server) => servers.push(server),
    })
  }
  return { servers, problems }
}
