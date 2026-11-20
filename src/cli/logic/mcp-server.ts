// logic: the engine tool servers' half of MCP — a JSON-RPC line in, the line to answer it with.
//
// Three methods carry the protocol: `initialize`, `tools/list` and `tools/call`, plus
// `ping`. Everything a tool does is the engine's, reached over HTTP by the command that
// uses this, or called in-process by the engine's own MCP route; what is here is only how
// MCP frames a question and an answer, so it is tested without a CLI, a daemon or a pipe.

type Fields = Readonly<Record<string, unknown>>

const fieldsOf = (value: unknown): Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {}

/** A JSON-RPC id: a number or a string, as the client chose it. */
export type RpcId = number | string

/** One line from the CLI, as far as this server reads it. */
export type Incoming =
  | { readonly kind: "initialize"; readonly id: RpcId; readonly version: unknown }
  | { readonly kind: "list"; readonly id: RpcId }
  | {
      readonly kind: "call"
      readonly id: RpcId
      readonly name: string
      readonly arguments: unknown
      /** The CLI's own id for the call, where it sent one. */
      readonly call: string | undefined
    }
  | { readonly kind: "ping"; readonly id: RpcId }
  | { readonly kind: "unknown"; readonly id: RpcId; readonly method: string }
  /** A notification, or a line that is not a request: owed no answer. */
  | { readonly kind: "ignored" }

const idOf = (value: unknown): RpcId | undefined =>
  typeof value === "number" || typeof value === "string" ? value : undefined

/**
 * The id Claude Code puts on a call's `_meta` — the `tool_use` block's own, which is what
 * its transcript line carries and what a surface joins the goal's event to. Absent from a
 * CLI that sends none, and the call is then filed under an id of the engine's.
 */
const callIdOf = (params: Fields): string | undefined => {
  const meta = fieldsOf(params["_meta"])
  const id = meta["claudecode/toolUseId"]
  return typeof id === "string" && id !== "" ? id : undefined
}

export const readIncoming = (line: string): Incoming => {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return { kind: "ignored" }
  }
  return readMessage(parsed)
}

/** One message already parsed — an HTTP body's, or one of a batch. */
export const readMessage = (parsed: unknown): Incoming => {
  const frame = fieldsOf(parsed)
  const id = idOf(frame["id"])
  const method = typeof frame["method"] === "string" ? frame["method"] : undefined
  if (id === undefined || method === undefined) return { kind: "ignored" }
  const params = fieldsOf(frame["params"])
  switch (method) {
    case "initialize":
      return { kind: "initialize", id, version: params["protocolVersion"] }
    case "tools/list":
      return { kind: "list", id }
    case "tools/call":
      return {
        kind: "call",
        id,
        name: typeof params["name"] === "string" ? params["name"] : "",
        arguments: params["arguments"] ?? {},
        call: callIdOf(params),
      }
    case "ping":
      return { kind: "ping", id }
    default:
      return { kind: "unknown", id, method }
  }
}

/** The answer to a request, as one line. */
export const result = (id: RpcId, value: unknown): string =>
  JSON.stringify({ jsonrpc: "2.0", id, result: value })

/** A request this server cannot answer, as one line — JSON-RPC's own error. */
export const rpcError = (id: RpcId, code: number, message: string): string =>
  JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })

/** `-32601`: the method is not one this server has. */
export const NO_METHOD = -32601
/** `-32603`: the server could not answer — here, the engine could not be reached. */
export const INTERNAL = -32603

/**
 * The `initialize` answer: the client's own protocol version echoed — this server
 * speaks the three methods every version has — and tools as its one capability. `name` is
 * the one the session's configuration lists it under.
 */
export const initialized = (version: unknown, name: string, serverVersion: string): unknown => ({
  protocolVersion: typeof version === "string" ? version : "2025-06-18",
  capabilities: { tools: {} },
  serverInfo: { name, version: serverVersion },
})

/** A tool's answer in MCP's shape: one text block, and `isError` for a refused call. */
export const toolResult = (text: string, isError: boolean): unknown => ({
  content: [{ type: "text", text }],
  isError,
})
