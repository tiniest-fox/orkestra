// The Codex provider's MCP half, against lines captured from `codex app-server` 0.154.0
// with a scratch MCP server behind it.

import { describe, expect, it } from "vitest"
import { McpRequest } from "../../types/mcp.js"
import { SessionId, type SessionRequest } from "../../types/session.js"
import { codexAttending, codexDialogue, codexMcpRequest } from "./argv.js"
import { codexMcpAnswer, codexMcpReply, codexNormalizer } from "./normalize.js"

const THREAD = SessionId.make("01a13179-c4e8-7ab0-a1f1-67933bc162f7")

const req: SessionRequest = {
  prompt: "go",
  cwd: "/repo",
  model: "gpt",
  effort: undefined,
  sessionId: SessionId.make("minted"),
  toolAccess: "read-only",
  permission: "read",
  resumeFrom: undefined,
  inherited: false,
  brief: undefined,
  env: {},
}

const call = McpRequest.CallTool({
  server: "scratch",
  tool: "press",
  callName: "press",
  arguments: { by: 1 },
})

describe("codexMcpRequest", () => {
  it("numbers its requests clear of the dialogue's own", () => {
    expect(JSON.parse(codexMcpRequest(McpRequest.ListTools(), 1, undefined) ?? "")).toEqual({
      method: "mcpServerStatus/list",
      id: 1_000_001,
      params: {},
    })
  })

  it("names the announced thread on a call, and has no line to write before there is one", () => {
    expect(codexMcpRequest(call, 2, undefined)).toBeUndefined()
    expect(JSON.parse(codexMcpRequest(call, 2, THREAD) ?? "")).toEqual({
      method: "mcpServer/tool/call",
      id: 1_000_002,
      params: { server: "scratch", threadId: THREAD, tool: "press", arguments: { by: 1 } },
    })
  })
})

describe("codexMcpReply", () => {
  it("reads an answer in its own id range, and a refusal's sentence", () => {
    expect(
      codexMcpReply('{"id":1000014,"result":{"content":[{"type":"text","text":"count is 1"}]}}'),
    ).toEqual({
      n: 14,
      body: { content: [{ type: "text", text: "count is 1" }] },
      error: undefined,
    })
    expect(
      codexMcpReply(
        '{"error":{"code":-32600,"message":"Invalid request: missing field `threadId`"},"id":1000003}',
      ),
    ).toEqual({ n: 3, body: undefined, error: "Invalid request: missing field `threadId`" })
  })

  it("is nothing for the dialogue's own answers, and for a notification", () => {
    expect(codexMcpReply('{"id":2,"result":{"thread":{"id":"t"}}}')).toBeUndefined()
    expect(codexMcpReply('{"method":"turn/completed","params":{}}')).toBeUndefined()
  })
})

describe("an MCP answer on a turn's stream", () => {
  it("is nothing to the dialogue and earns no event", () => {
    const dialogue = codexDialogue(req, "go")
    const answer = '{"id":1000014,"result":{"content":[]}}'
    expect(dialogue.replyTo(answer)).toEqual([])
    expect(codexNormalizer()(answer)).toEqual([])
    // A refused one must not fail the turn it was asked during.
    expect(codexNormalizer()('{"id":1000015,"error":{"message":"no"}}')).toEqual([])
  })
})

describe("codexMcpAnswer", () => {
  it("lists each server's tools, keyed by name, with the view each declares", () => {
    const status = {
      data: [
        {
          name: "probe",
          tools: {
            show_card: {
              name: "show_card",
              _meta: {
                ui: { resourceUri: "ui://probe/card.html" },
                "ui/resourceUri": "ui://probe/card.html",
              },
            },
          },
        },
      ],
    }
    expect(codexMcpAnswer(McpRequest.ListTools(), status)).toEqual({
      _tag: "Tools",
      tools: [
        {
          server: "probe",
          name: "show_card",
          callName: "show_card",
          view: "ui://probe/card.html",
          openToViews: true,
        },
      ],
    })
  })
})

describe("codexAttending", () => {
  it("asks for a thread after the handshake and never starts a turn", () => {
    const opening = codexAttending(req)
    expect(JSON.parse(opening.opening)).toMatchObject({ method: "initialize", id: 1 })
    const next = opening.replyTo('{"id":1,"result":{}}').map((l): unknown => JSON.parse(l))
    expect(next).toMatchObject([
      { method: "initialized" },
      { method: "thread/start", id: 2, params: { cwd: "/repo", approvalPolicy: "never" } },
    ])
    expect(opening.settled()).toBe(false)
    expect(opening.replyTo('{"id":2,"result":{"thread":{"id":"t"}}}')).toEqual([])
    expect(opening.settled()).toBe(true)
  })
})

describe("codexNormalizer", () => {
  it("reports an MCP call's arguments and whole result where the item completes", () => {
    const normalize = codexNormalizer()
    normalize('{"id":2,"result":{"thread":{"id":"th"}}}')
    normalize('{"id":3,"result":{"turn":{"id":"tu"}}}')
    const completed = JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "th",
        turnId: "tu",
        item: {
          type: "mcpToolCall",
          id: "exec-1",
          server: "probe",
          tool: "show_card",
          status: "completed",
          arguments: {},
          mcpAppResourceUri: "ui://probe/card.html",
          result: {
            content: [{ type: "text", text: "PROBE" }],
            structuredContent: { marker: "s" },
            _meta: { marker: "m" },
          },
        },
      },
    })
    expect(normalize(completed)).toEqual([
      { _tag: "ToolResult", ok: true, call: "exec-1", parent: undefined },
      {
        _tag: "McpReturned",
        call: "exec-1",
        server: "probe",
        tool: "show_card",
        arguments: {},
        result: {
          content: [{ type: "text", text: "PROBE" }],
          structured: { marker: "s" },
          meta: { marker: "m" },
          isError: false,
        },
      },
    ])
  })
})
