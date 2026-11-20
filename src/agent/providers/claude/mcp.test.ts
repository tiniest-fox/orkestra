// The Claude provider's MCP half, against lines captured from `claude` 2.1.296 with a
// scratch MCP server behind it — the shapes are the CLI's, cut where a line was long.

import { describe, expect, it } from "vitest"
import { McpRequest } from "../../types/mcp.js"
import { claudeAttending, claudeMcpRequest } from "./argv.js"
import { claudeMcpAnswer, claudeMcpReply, claudeNormalizer } from "./normalize.js"

describe("claudeMcpRequest", () => {
  it("frames each request as a control line under the harness's count", () => {
    expect(JSON.parse(claudeMcpRequest(McpRequest.ListTools(), 3))).toEqual({
      type: "control_request",
      request_id: "ork-mcp-3",
      request: { subtype: "mcp_status" },
    })
    expect(
      JSON.parse(
        claudeMcpRequest(McpRequest.ReadResource({ server: "scratch", uri: "ui://s/c" }), 4),
      ),
    ).toMatchObject({
      request: { subtype: "mcp_read_resource", serverName: "scratch", uri: "ui://s/c" },
    })
  })

  it("calls a tool by its qualified name, which is the only name claude takes", () => {
    const call = McpRequest.CallTool({
      server: "scratch",
      tool: "press",
      callName: "mcp__scratch__press",
      arguments: { by: 1 },
    })
    expect(JSON.parse(claudeMcpRequest(call, 5))).toMatchObject({
      request: { subtype: "mcp_call", tool: "mcp__scratch__press", arguments: { by: 1 } },
    })
  })
})

describe("claudeMcpReply", () => {
  it("reads the count back off the answer to one of its own requests", () => {
    const line =
      '{"type":"control_response","response":{"subtype":"success","request_id":"ork-mcp-7","response":{"content":"{\\"count\\":1,\\"via\\":\\"press\\"}","structuredContent":{"count":1,"via":"press"}}}}'
    expect(claudeMcpReply(line)).toEqual({
      n: 7,
      body: { content: '{"count":1,"via":"press"}', structuredContent: { count: 1, via: "press" } },
      error: undefined,
    })
  })

  it("carries a refusal's own sentence", () => {
    const line =
      '{"type":"control_response","response":{"subtype":"error","request_id":"ork-mcp-2","error":"Server not found: nope"}}'
    expect(claudeMcpReply(line)).toEqual({ n: 2, body: undefined, error: "Server not found: nope" })
  })

  it("is nothing for the stop's acknowledgement, or a line of the turn", () => {
    expect(
      claudeMcpReply(
        '{"type":"control_response","response":{"subtype":"success","request_id":"ork-1"}}',
      ),
    ).toBeUndefined()
    expect(claudeMcpReply('{"type":"assistant","message":{"content":[]}}')).toBeUndefined()
  })
})

describe("claudeMcpAnswer", () => {
  it("lists each server's tools with the view each declares and who may call it", () => {
    const status = {
      mcpServers: [
        {
          name: "scratch",
          status: "connected",
          tools: [
            { name: "press", annotations: {} },
            {
              name: "press_app_only",
              annotations: {},
              _meta: { ui: { resourceUri: "ui://scratch/counter.html", visibility: ["app"] } },
            },
            {
              name: "show_counter",
              annotations: {},
              _meta: {
                ui: { resourceUri: "ui://scratch/counter.html" },
                "ui/resourceUri": "ui://scratch/counter.html",
              },
            },
          ],
        },
      ],
    }
    expect(claudeMcpAnswer(McpRequest.ListTools(), status)).toEqual({
      _tag: "Tools",
      tools: [
        {
          server: "scratch",
          name: "press",
          callName: "mcp__scratch__press",
          view: undefined,
          openToViews: true,
        },
        {
          server: "scratch",
          name: "press_app_only",
          callName: "mcp__scratch__press_app_only",
          view: "ui://scratch/counter.html",
          openToViews: true,
        },
        {
          server: "scratch",
          name: "show_counter",
          callName: "mcp__scratch__show_counter",
          view: "ui://scratch/counter.html",
          openToViews: true,
        },
      ],
    })
  })

  it("spells a server's name the way a qualified tool name does", () => {
    const answer = claudeMcpAnswer(McpRequest.ListTools(), {
      mcpServers: [{ name: "my server.io", tools: [{ name: "do" }] }],
    })
    expect(answer).toMatchObject({ tools: [{ callName: "mcp__my_server_io__do" }] })
  })
})

describe("claudeAttending", () => {
  it("is ready once its one control request is answered, and writes nothing else", () => {
    const opening = claudeAttending()
    expect(JSON.parse(opening.opening)).toMatchObject({ request: { subtype: "initialize" } })
    expect(opening.settled()).toBe(false)
    expect(opening.replyTo('{"type":"system","subtype":"init","session_id":"x"}')).toEqual([])
    expect(opening.settled()).toBe(false)
    expect(
      opening.replyTo(
        '{"type":"control_response","response":{"subtype":"success","request_id":"ork-attend","response":{}}}',
      ),
    ).toEqual([])
    expect(opening.settled()).toBe(true)
  })
})

const USE =
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_01","name":"mcp__probe__show_card","input":{"q":1}}]},"parent_tool_use_id":null}'
const RESULT =
  '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01","type":"tool_result","content":[{"type":"text","text":"x"}]}]},"parent_tool_use_id":null,"tool_use_result":{"content":[{"type":"text","text":"x"}],"_meta":{"marker":"m"},"structuredContent":{"marker":"s"}}}'

describe("claudeNormalizer", () => {
  it("reports an MCP call's arguments and whole result where its result line lands", () => {
    const normalize = claudeNormalizer()
    expect(normalize(USE).map((e) => e._tag)).toEqual(["ToolUse"])
    expect(normalize(RESULT)).toEqual([
      { _tag: "ToolResult", ok: true, call: "toolu_01", parent: undefined },
      {
        _tag: "McpReturned",
        call: "toolu_01",
        server: undefined,
        tool: "mcp__probe__show_card",
        arguments: { q: 1 },
        result: {
          content: [{ type: "text", text: "x" }],
          structured: { marker: "s" },
          meta: { marker: "m" },
          isError: false,
        },
      },
    ])
  })

  it("reports nothing for a built-in tool's result, or a result nothing was called for", () => {
    const normalize = claudeNormalizer()
    normalize(USE.replace("mcp__probe__show_card", "Read"))
    expect(normalize(RESULT).map((e) => e._tag)).toEqual(["ToolResult"])
  })

  it("reports nothing for a call made inside a delegation", () => {
    const normalize = claudeNormalizer()
    normalize(USE.replace('"parent_tool_use_id":null', '"parent_tool_use_id":"toolu_parent"'))
    expect(normalize(RESULT).map((e) => e._tag)).toEqual(["ToolResult"])
  })

  it("keeps one spawn's calls out of the next", () => {
    claudeNormalizer()(USE)
    expect(claudeNormalizer()(RESULT).map((e) => e._tag)).toEqual(["ToolResult"])
  })
})
