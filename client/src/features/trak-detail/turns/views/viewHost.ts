/**
 * The host's half of the conversation with a view — what an MCP tool's HTML is told and
 * what it may ask for, as a pure function of one message.
 *
 * A view is a document in a sandboxed frame, and everything it can do goes through
 * messages to the page that holds it: JSON-RPC, one object per message. This file
 * decides the answer and performs none of it — `useViewHost` posts, calls and resizes —
 * so the whole of what a view is allowed is readable here and testable with no frame.
 *
 * **Two things a view may ask for, and no more**: a tool on its own server, and a link
 * opened. A message to the model, a change to the model's context and a read of another
 * resource are each refused in the protocol's own words, so a view that asks finds out
 * rather than waiting.
 */

import type { ViewDto, ViewResultDto } from "../../../../api/types"

/** The version of the view protocol this host speaks. */
const PROTOCOL = "2026-01-26"

type RpcId = string | number

/** What one message from a view asks the host to do. */
export type HostAct =
  | { readonly kind: "post"; readonly message: unknown }
  | { readonly kind: "call"; readonly id: RpcId; readonly tool: string; readonly args: unknown }
  | { readonly kind: "open"; readonly id: RpcId; readonly url: string }
  | { readonly kind: "size"; readonly height: number }

const fieldsOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {}

export const rpcResult = (id: RpcId, result: unknown): unknown => ({ jsonrpc: "2.0", id, result })

export const rpcError = (id: RpcId, message: string, code = -32000): unknown => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
})

const notify = (method: string, params: unknown): unknown => ({ jsonrpc: "2.0", method, params })

/**
 * A tool's result as the view's protocol spells it. The wire names the server's
 * `structuredContent` and `_meta` in this codebase's own words, and a view reads the
 * protocol's.
 */
export const toolResult = (result: ViewResultDto): Record<string, unknown> => ({
  content: result.content,
  ...(result.structured === undefined ? {} : { structuredContent: result.structured }),
  ...(result.meta === undefined ? {} : { ["_meta"]: result.meta }),
  ...(result.isError ? { isError: true } : {}),
})

/** A link a view may have opened: the web, and nothing that runs or reads a file. */
const webAddress = (url: unknown): string | undefined => {
  if (typeof url !== "string" || !URL.canParse(url)) return undefined
  const { protocol } = new URL(url)
  return protocol === "https:" || protocol === "http:" ? url : undefined
}

const asked = (
  id: RpcId,
  method: string,
  params: Record<string, unknown>,
  theme: "light" | "dark",
): readonly HostAct[] => {
  switch (method) {
    case "ui/initialize":
      return [
        {
          kind: "post",
          message: rpcResult(id, {
            protocolVersion: PROTOCOL,
            hostInfo: { name: "orkestra", version: "0" },
            hostCapabilities: { serverTools: {}, openLinks: {} },
            hostContext: { theme, displayMode: "inline", availableDisplayModes: ["inline"] },
          }),
        },
      ]
    case "ping":
      return [{ kind: "post", message: rpcResult(id, {}) }]
    case "ui/request-display-mode":
      return [{ kind: "post", message: rpcResult(id, { mode: "inline" }) }]
    case "tools/call": {
      const tool = params["name"]
      return typeof tool === "string"
        ? [{ kind: "call", id, tool, args: params["arguments"] ?? {} }]
        : [{ kind: "post", message: rpcError(id, "tools/call names no tool", -32602) }]
    }
    case "ui/open-link": {
      const url = webAddress(params["url"])
      return url === undefined
        ? [{ kind: "post", message: rpcError(id, "only a web link can be opened", -32602) }]
        : [{ kind: "open", id, url }]
    }
    default:
      return [
        { kind: "post", message: rpcError(id, `${method} is not offered by this host`, -32601) },
      ]
  }
}

/**
 * What the host does about one message from a view.
 *
 * `ui/notifications/initialized` is the view saying it is ready, and is answered with
 * the call it is a view of: the arguments the model passed, then the result — both kept
 * by the engine when the call completed, so a view draws with no CLI running and the
 * tool is never called again to redraw.
 *
 * A message that is not a request or a notification this host knows earns nothing: a
 * view's reply to something the host never asked, or a frame that is not a view at all.
 */
export const hostActs = (
  message: unknown,
  view: ViewDto,
  theme: "light" | "dark",
): readonly HostAct[] => {
  const all = fieldsOf(message)
  const method = all["method"]
  if (all["jsonrpc"] !== "2.0" || typeof method !== "string") return []
  const id = all["id"]
  const params = fieldsOf(all["params"])
  if (typeof id === "string" || typeof id === "number") return asked(id, method, params, theme)
  if (method === "ui/notifications/initialized") {
    return [
      {
        kind: "post",
        message: notify("ui/notifications/tool-input", { arguments: view.arguments ?? {} }),
      },
      { kind: "post", message: notify("ui/notifications/tool-result", toolResult(view.result)) },
    ]
  }
  if (method === "ui/notifications/size-changed") {
    const height = params["height"]
    return typeof height === "number" && Number.isFinite(height) && height > 0
      ? [{ kind: "size", height: Math.ceil(height) }]
      : []
  }
  return []
}

/**
 * The calls whose view is open before anybody has pressed a header: the newest one in
 * each turn. A turn with several views would otherwise stack every one of them at full
 * height above the answer they led to.
 *
 * A turn starts at a `Spawned` line — one CLI, one turn.
 */
export const newestViews = (
  transcript: readonly { readonly _tag: string; readonly call?: string | undefined }[],
): ReadonlySet<string> => {
  const newest = new Set<string>()
  let last: string | undefined
  for (const entry of transcript) {
    if (entry._tag === "Spawned") {
      if (last !== undefined) newest.add(last)
      last = undefined
    }
    if (entry._tag === "View" && entry.call !== undefined) last = entry.call
  }
  if (last !== undefined) newest.add(last)
  return newest
}
