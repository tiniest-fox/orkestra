import { describe, expect, it } from "vitest"
import { initialized, readIncoming, result, rpcError, toolResult } from "./mcp-server.js"

describe("readIncoming", () => {
  it("reads a tool call with the CLI's own id for it", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "open_trak",
        arguments: { title: "t" },
        _meta: { "claudecode/toolUseId": "toolu_01" },
      },
    })
    expect(readIncoming(line)).toEqual({
      kind: "call",
      id: 7,
      name: "open_trak",
      arguments: { title: "t" },
      call: "toolu_01",
    })
  })

  it("leaves the call id absent where the CLI sent none", () => {
    const line = JSON.stringify({ id: "a", method: "tools/call", params: { name: "replan" } })
    expect(readIncoming(line)).toMatchObject({ kind: "call", call: undefined, arguments: {} })
  })

  it("owes a notification and an unreadable line no answer", () => {
    expect(readIncoming(JSON.stringify({ method: "notifications/initialized" }))).toEqual({
      kind: "ignored",
    })
    expect(readIncoming("not json")).toEqual({ kind: "ignored" })
  })

  it("names a method it does not have, so it can be refused", () => {
    expect(readIncoming(JSON.stringify({ id: 1, method: "resources/list" }))).toEqual({
      kind: "unknown",
      id: 1,
      method: "resources/list",
    })
  })
})

describe("answers", () => {
  it("echoes the client's protocol version and offers tools alone", () => {
    expect(initialized("2025-06-18", "orkestra-goal", "1.0.0")).toEqual({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "orkestra-goal", version: "1.0.0" },
    })
  })

  it("frames a result, an error and a refused call", () => {
    expect(JSON.parse(result(1, toolResult("no", true)))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "no" }], isError: true },
    })
    expect(JSON.parse(rpcError(2, -32601, "no x"))).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32601, message: "no x" },
    })
  })
})
