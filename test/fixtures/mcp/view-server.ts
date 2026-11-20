// An MCP server with one view, for `pnpm smoke`: stdio, one JSON-RPC object per line,
// and no import outside Node, so it starts from any directory the CLI is run in.
//
// It offers the view the way the MCP Apps extension tells a server to: only to a client
// whose `initialize` declares `io.modelcontextprotocol/ui`. A CLI spawned without that
// declaration is listed `show_counter` with no view, which is what makes the smoke check
// a check of the declaration as well as of the read.
//
// Three tools: `show_counter` carries the view, `press` is open to the model and to a
// view, and `reset` is the model's alone — a view's press on it is one the engine refuses.
//
// Erasable syntax only: `node` runs this file itself, with its types stripped.

import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

/** The name the smoke check dials this server under. */
export const VIEW_SERVER = "smoke"

/** How to start it: the same `node`, told to strip types on a release that still asks. */
export const VIEW_SERVER_COMMAND = {
  command: process.execPath,
  args: ["--experimental-strip-types", fileURLToPath(import.meta.url)],
}

/** Written into the view's HTML, so a read that returned another document is caught. */
export const VIEW_MARKER = "orkestra-smoke-view"

const UI = "io.modelcontextprotocol/ui"
const MIME = "text/html;profile=mcp-app"
const URI = "ui://smoke/counter.html"

const HTML = `<!DOCTYPE html><html><body data-marker="${VIEW_MARKER}" style="margin:0;padding:16px;font:13px system-ui">
<div>Count</div>
<div id="n" style="font-size:32px;font-weight:700;margin:4px 0">…</div>
<button id="b" style="padding:6px 12px">Add one</button>
<script>
  let id = 0
  const send = (m) => parent.postMessage({ jsonrpc: "2.0", ...m }, "*")
  const draw = (r) => { if (r && r.structuredContent) document.getElementById("n").textContent = r.structuredContent.count }
  addEventListener("message", (e) => {
    const m = e.data
    if (m.id === 0) {
      send({ method: "ui/notifications/initialized" })
      send({ method: "ui/notifications/size-changed", params: { width: innerWidth, height: document.body.scrollHeight } })
    }
    if (m.method === "ui/notifications/tool-result") draw(m.params)
    if (m.id > 0) draw(m.result)
  })
  document.getElementById("b").onclick = () => send({ id: ++id, method: "tools/call", params: { name: "press", arguments: { by: 1 } } })
  send({ id: 0, method: "ui/initialize", params: { protocolVersion: "2026-01-26", appInfo: { name: "smoke", version: "0" }, appCapabilities: {} } })
</script></body></html>`

type Fields = Readonly<Record<string, unknown>>

const fieldsOf = (value: unknown): Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {}

let views = false
let count = 0

const counted = (via: string): Fields => ({
  content: [{ type: "text", text: `count is ${count}` }],
  structuredContent: { count, via },
})

const noArguments = { type: "object", properties: {} }

const tools = (): readonly Fields[] => [
  {
    name: "show_counter",
    description: "Show the counter. Call it with no arguments.",
    inputSchema: noArguments,
    ...(views ? { ["_meta"]: { ui: { resourceUri: URI } } } : {}),
  },
  {
    name: "press",
    description: "Add to the counter.",
    inputSchema: { type: "object", properties: { by: { type: "number" } } },
  },
  {
    name: "reset",
    description: "Set the counter to zero.",
    inputSchema: noArguments,
    ["_meta"]: { ui: { visibility: ["model"] } },
  },
]

const called = (name: unknown, args: Fields): Fields => {
  switch (name) {
    case "show_counter":
      return counted("show_counter")
    case "press":
      count += typeof args["by"] === "number" ? args["by"] : 1
      return counted("press")
    case "reset":
      count = 0
      return counted("reset")
    default:
      return { content: [{ type: "text", text: `no tool ${String(name)}` }], isError: true }
  }
}

/** A request's result, or `undefined` for a method this server does not have. */
const answered = (method: unknown, params: Fields): Fields | undefined => {
  switch (method) {
    case "initialize": {
      const declared = fieldsOf(fieldsOf(fieldsOf(params["capabilities"])["extensions"])[UI])
      const mimeTypes = declared["mimeTypes"]
      views = Array.isArray(mimeTypes) && mimeTypes.includes(MIME)
      return {
        protocolVersion: params["protocolVersion"],
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: VIEW_SERVER, version: "0.0.1" },
      }
    }
    case "tools/list":
      return { tools: tools() }
    case "tools/call":
      return called(params["name"], fieldsOf(params["arguments"]))
    case "resources/list":
      return { resources: views ? [{ uri: URI, name: "counter", mimeType: MIME }] : [] }
    case "resources/templates/list":
      return { resourceTemplates: [] }
    case "resources/read":
      return { contents: [{ uri: params["uri"], mimeType: MIME, text: HTML }] }
    case "prompts/list":
      return { prompts: [] }
    case "ping":
      return {}
    default:
      return undefined
  }
}

const serve = (): void => {
  createInterface({ input: process.stdin }).on("line", (line) => {
    if (line.trim() === "") return
    const parsed: unknown = JSON.parse(line)
    const frame = fieldsOf(parsed)
    // A frame with no id is a notification, which is owed no answer.
    if (frame["id"] === undefined) return
    const result = answered(frame["method"], fieldsOf(frame["params"]))
    const answer =
      result === undefined
        ? { error: { code: -32601, message: `no ${String(frame["method"])}` } }
        : { result }
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: frame["id"], ...answer })}\n`)
  })
}

// Only as the program `node` was started on: the smoke check imports the names above.
if (process.argv[1] === fileURLToPath(import.meta.url)) serve()
