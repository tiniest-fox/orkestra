// types: what the harness asks a CLI about the MCP servers it dialed, what it hears
// back, and the view a tool's call leaves behind.
//
// The CLI is the only thing that talks to an MCP server: it holds the server's
// configuration and its sign-in. So every shape here is the CLI's answer already
// reduced to one vocabulary, the way `ProviderEvent` reduces its stream.

import { Data, Schema } from "effect"

/**
 * One tool a server offers, as far as a view is concerned.
 *
 * `callName` is the name the provider's own call events and call requests use for it —
 * `mcp__<server>__<tool>` under Claude, the bare name under Codex. It is the only safe
 * join from a call back to its server: splitting a qualified name at its separator
 * guesses wrong for a server whose own name holds one.
 *
 * `view` is the address of the HTML the tool declares, absent for a tool with none.
 * `openToViews` is whether a view may call the tool — the server's `visibility` naming
 * `app`, or naming nothing.
 */
export interface McpTool {
  readonly server: string
  readonly name: string
  readonly callName: string
  readonly view: string | undefined
  readonly openToViews: boolean
}

/**
 * The hosts a view's server says the view needs, by what each may be used for. Absent
 * on a resource that declares none, which allows no network at all.
 */
export const McpViewPolicy = Schema.Struct({
  connect: Schema.Array(Schema.String),
  resource: Schema.Array(Schema.String),
  frame: Schema.Array(Schema.String),
  baseUri: Schema.Array(Schema.String),
})
export type McpViewPolicy = Schema.Schema.Type<typeof McpViewPolicy>

export interface McpResource {
  readonly text: string
  readonly policy: McpViewPolicy | undefined
}

/**
 * What a tool call returned, whole. `content` is always an array: a CLI that hands it
 * back as one string has it wrapped by that provider's reader, so nothing downstream
 * checks. `structured` and `meta` are the server's own and are carried unread.
 */
export const McpResult = Schema.Struct({
  content: Schema.Array(Schema.Unknown),
  structured: Schema.optional(Schema.Unknown),
  meta: Schema.optional(Schema.Unknown),
  isError: Schema.Boolean,
})
export type McpResult = Schema.Schema.Type<typeof McpResult>

/** The three things a harness asks, each answered on the pipe it was written down. */
export type McpRequest = Data.TaggedEnum<{
  ListTools: {}
  ReadResource: { readonly server: string; readonly uri: string }
  CallTool: {
    readonly server: string
    readonly tool: string
    readonly callName: string
    readonly arguments: unknown
  }
}>
export const McpRequest = Data.taggedEnum<McpRequest>()

export type McpAnswer = Data.TaggedEnum<{
  Tools: { readonly tools: readonly McpTool[] }
  Resource: { readonly resource: McpResource }
  Result: { readonly result: McpResult }
}>
export const McpAnswer = Data.taggedEnum<McpAnswer>()

/**
 * One line recognised as the answer to a request the harness wrote: `n` is the count
 * the request was framed with, and `error` is the CLI's own sentence where it refused.
 */
export interface McpReply {
  readonly n: number
  readonly body: unknown
  readonly error: string | undefined
}

/**
 * Everything a view needs to draw again with no CLI running, kept when its call
 * completes. `html` is the server's document as it was read; the network policy is
 * written into it where it is served, never here.
 *
 * `callable` is the tools on the view's own server that a view may call, as the tool
 * list stood when the call completed — the whole of what a press is checked against.
 * `model` is the name the turn ran on, which is what picks the CLI a press starts once
 * that turn is over.
 */
export const McpView = Schema.Struct({
  server: Schema.String,
  tool: Schema.String,
  uri: Schema.String,
  html: Schema.String,
  policy: Schema.optional(McpViewPolicy),
  arguments: Schema.Unknown,
  result: McpResult,
  callable: Schema.Array(Schema.Struct({ name: Schema.String, callName: Schema.String })),
  model: Schema.String,
})
export type McpView = Schema.Schema.Type<typeof McpView>
