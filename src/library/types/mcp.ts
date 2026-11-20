// types: the MCP servers a project declares in `.orkestra/mcp.yaml`, for every session
// the engine starts in it.
//
// Declared, not resolved: a value in `env` or `headers` may still hold `${NAME}`, which
// names a secret the engine fills from its own environment when a session starts. The
// file itself never holds a credential.

import { Data } from "effect"

/**
 * One server as the file declares it, under the name its tools are called by. A
 * `Stdio` server is one the CLI starts; an `Http` one is already running and dialed
 * over streamable HTTP. Which one is inferred from `command` or `url`.
 *
 * A `Connection` is an http server signed in to by the host rather than through
 * `headers`: `connection` is the server name a person binds to a sign-in in Host
 * settings, and the session dials `url` through the engine's proxy, which asks the host
 * for the token.
 */
export type DeclaredServer = Data.TaggedEnum<{
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
  Connection: {
    readonly name: string
    readonly url: string
    readonly connection: string
  }
}>
export const DeclaredServer = Data.taggedEnum<DeclaredServer>()

/**
 * What `mcp.yaml` declared, and what was wrong with it — one line per server left out,
 * or one for a file that could not be read at all.
 *
 * **Never a load failure.** A file this is wrong about removes tools from a session; it
 * must not stop a project from loading, so every problem rides here and each session
 * writes them to its own transcript, where a person sees why a turn lacks a tool.
 */
export interface McpFile {
  readonly servers: readonly DeclaredServer[]
  readonly problems: readonly string[]
}

export const NO_MCP: McpFile = { servers: [], problems: [] }
