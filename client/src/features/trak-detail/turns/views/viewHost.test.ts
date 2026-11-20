import { describe, expect, it } from "vitest"
import { makeView } from "../../../../fixtures"
import { hostActs, newestViews, toolResult } from "./viewHost"

const view = makeView({
  arguments: { range: "7d" },
  result: {
    content: [{ type: "text", text: "count is 2" }],
    structured: { count: 2 },
    meta: { from: "server" },
    isError: false,
  },
})

const request = (id: number, method: string, params?: unknown): unknown => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params === undefined ? {} : { params }),
})

const sized = (height: unknown): unknown => ({
  jsonrpc: "2.0",
  method: "ui/notifications/size-changed",
  params: { width: 600, height },
})

describe("hostActs", () => {
  it("answers the handshake as an inline host that offers tools and links", () => {
    expect(hostActs(request(0, "ui/initialize", {}), view, "dark")).toEqual([
      {
        kind: "post",
        message: {
          jsonrpc: "2.0",
          id: 0,
          result: {
            protocolVersion: "2026-01-26",
            hostInfo: { name: "orkestra", version: "0" },
            hostCapabilities: { serverTools: {}, openLinks: {} },
            hostContext: {
              theme: "dark",
              displayMode: "inline",
              availableDisplayModes: ["inline"],
            },
          },
        },
      },
    ])
  })

  it("hands a ready view the stored arguments and result, in the protocol's own names", () => {
    const ready = { jsonrpc: "2.0", method: "ui/notifications/initialized" }
    expect(hostActs(ready, view, "light")).toEqual([
      {
        kind: "post",
        message: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-input",
          params: { arguments: { range: "7d" } },
        },
      },
      {
        kind: "post",
        message: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: {
            content: [{ type: "text", text: "count is 2" }],
            structuredContent: { count: 2 },
            _meta: { from: "server" },
          },
        },
      },
    ])
  })

  it("turns a tool call into a call, by the bare name the view wrote", () => {
    const asked = request(4, "tools/call", { name: "press", arguments: { by: 1 } })
    expect(hostActs(asked, view, "light")).toEqual([
      { kind: "call", id: 4, tool: "press", args: { by: 1 } },
    ])
  })

  it("opens a web link and refuses any other address", () => {
    expect(
      hostActs(request(5, "ui/open-link", { url: "https://example.com/a" }), view, "light"),
    ).toEqual([{ kind: "open", id: 5, url: "https://example.com/a" }])
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "not a url"]) {
      expect(hostActs(request(6, "ui/open-link", { url }), view, "light")).toMatchObject([
        { kind: "post", message: { id: 6, error: { code: -32602 } } },
      ])
    }
  })

  it("refuses a message to the model, a context update and a resource read", () => {
    for (const method of ["ui/message", "ui/update-model-context", "resources/read"]) {
      expect(hostActs(request(7, method, {}), view, "light")).toMatchObject([
        { kind: "post", message: { id: 7, error: { code: -32601 } } },
      ])
    }
  })

  it("takes the height a view reports and ignores one that is not a size", () => {
    expect(hostActs(sized(240.4), view, "light")).toEqual([{ kind: "size", height: 241 }])
    expect(hostActs(sized(0), view, "light")).toEqual([])
    expect(hostActs(sized("tall"), view, "light")).toEqual([])
  })

  it("earns nothing for a message that is not the protocol's", () => {
    expect(hostActs("hello", view, "light")).toEqual([])
    expect(hostActs({ method: "tools/call", id: 1 }, view, "light")).toEqual([])
    expect(hostActs({ jsonrpc: "2.0", id: 1, result: {} }, view, "light")).toEqual([])
  })
})

describe("toolResult", () => {
  it("says a failure and leaves out what the server did not send", () => {
    expect(toolResult({ content: [], isError: true })).toEqual({ content: [], isError: true })
  })
})

describe("newestViews", () => {
  it("opens the last view of each turn and no earlier one", () => {
    const transcript = [
      { _tag: "Spawned" },
      { _tag: "View", call: "a" },
      { _tag: "Tool", call: "x" },
      { _tag: "View", call: "b" },
      { _tag: "Spawned" },
      { _tag: "View", call: "c" },
    ]
    expect([...newestViews(transcript)]).toEqual(["b", "c"])
  })
})
