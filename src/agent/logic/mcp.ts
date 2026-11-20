// logic: the MCP shapes both CLIs hand back as the server sent them, read once here,
// and the questions asked of a tool list and of a call's id.

import type { McpResource, McpResult, McpTool, McpViewPolicy } from "../types/mcp.js"

/**
 * The listed tool a call named. `server` is absent where the provider's call names the
 * tool by a qualified name, and that name alone is then the join.
 */
export const calledTool = (
  tools: readonly McpTool[],
  server: string | undefined,
  tool: string,
): McpTool | undefined =>
  tools.find((t) => t.callName === tool && (server === undefined || t.server === server))

/** The tools on `server` a view may call — see `McpTool.openToViews`. */
export const openToViews = (tools: readonly McpTool[], server: string): readonly McpTool[] =>
  tools.filter((t) => t.server === server && t.openToViews)

/**
 * Whether a call's id may name a file. A provider's ids are opaque, and one that is not
 * plainly a name is a view that is not kept rather than a path built from a stream's
 * text.
 */
export const isViewKey = (call: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(call)

/** An unknown value's own keys, and none for anything that is not an object. */
export const fieldsOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {}

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []

/**
 * What a tool's `_meta` says about a view: the address under `ui.resourceUri`, or under
 * the flat `ui/resourceUri` key older servers write, and whether a view may call the
 * tool — `ui.visibility` naming `app`, or naming nothing at all.
 */
export const toolView = (
  meta: unknown,
): { readonly view: string | undefined; readonly openToViews: boolean } => {
  const all = fieldsOf(meta)
  const ui = fieldsOf(all["ui"])
  const address = ui["resourceUri"] ?? all["ui/resourceUri"]
  const visibility = ui["visibility"]
  return {
    view: typeof address === "string" && address.startsWith("ui://") ? address : undefined,
    openToViews: !Array.isArray(visibility) || visibility.includes("app"),
  }
}

const policyOf = (meta: unknown): McpViewPolicy | undefined => {
  const csp = fieldsOf(fieldsOf(meta)["ui"])["csp"]
  if (csp === undefined) return undefined
  const declared = fieldsOf(csp)
  return {
    connect: strings(declared["connectDomains"]),
    resource: strings(declared["resourceDomains"]),
    frame: strings(declared["frameDomains"]),
    baseUri: strings(declared["baseUriDomains"]),
  }
}

/**
 * A `resources/read` answer as a view's document: the first content's text, and the
 * network policy its `_meta` declares. `undefined` where the answer holds no text.
 */
export const resourceOf = (body: unknown): McpResource | undefined => {
  const contents = fieldsOf(body)["contents"]
  const first = fieldsOf(Array.isArray(contents) ? contents[0] : undefined)
  const text = first["text"]
  return typeof text === "string" ? { text, policy: policyOf(first["_meta"]) } : undefined
}

/**
 * A `tools/call` result as one shape. `content` arrives as one string from a CLI that
 * rewrote it, and the view's own protocol wants an array of blocks, so a string is
 * wrapped as the one text block it stands for.
 */
export const resultOf = (body: unknown, failed: boolean): McpResult => {
  const all = fieldsOf(body)
  const content = typeof body === "string" ? body : all["content"]
  return {
    content: Array.isArray(content)
      ? content
      : typeof content === "string"
        ? [{ type: "text", text: content }]
        : [],
    ...(all["structuredContent"] === undefined ? {} : { structured: all["structuredContent"] }),
    ...(all["_meta"] === undefined ? {} : { meta: all["_meta"] }),
    isError: failed || all["isError"] === true,
  }
}
