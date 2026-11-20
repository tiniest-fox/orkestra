// Unit tests for override point 1 of the Codex provider. `codex app-server` takes
// nothing on its command line, so what these pin is the dialogue: which request
// answers which line, and what each one carries.

import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { CLI_EFFORTS } from "../../types/effort.js"
import { McpServer, SessionId } from "../../types/session.js"
import { codexArgv, codexDialogue } from "./argv.js"
import { codexSpec } from "./index.js"

const req = (over: Partial<Parameters<typeof codexDialogue>[0]> = {}) => ({
  prompt: "do the thing",
  cwd: "/tmp/work",
  model: "gpt-5.6-sol",
  sessionId: SessionId.make("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
  toolAccess: "write" as const,
  permission: "full" as const,
  resumeFrom: undefined,
  inherited: false,
  effort: undefined,
  brief: undefined,
  env: {},
  ...over,
})

// The two answers the dialogue acts on, in the shape the captured runs hold them.
const INITIALIZED = '{"id":1,"result":{"userAgent":"orkestra/0.154.0"}}'
const THREAD_OPENED =
  '{"id":2,"result":{"thread":{"id":"01a0afa1-c237-7380-9bad-2c0a466452f2","turns":[]}}}'

const Request = Schema.Struct({
  method: Schema.String,
  id: Schema.optional(Schema.Number),
  params: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
type Request = Schema.Schema.Type<typeof Request>
const decoded = Schema.decodeUnknownSync(Schema.parseJson(Request))
// One argument, so it can be handed to `map` — the decoder's second is its options.
const parsed = (line: string): Request => decoded(line)

/** The thread request a dialogue writes once `initialize` is answered. */
const threadRequest = (over: Parameters<typeof req>[0] = {}): Request =>
  parsed(codexDialogue(req(over), "do the thing").replyTo(INITIALIZED)[1] ?? "{}")

describe("codexArgv", () => {
  it("runs the app server and puts nothing else on the command line", () => {
    expect(codexArgv()).toEqual(["app-server"])
  })
})

describe("codexDialogue", () => {
  it("opens with initialize, and nothing of the turn", () => {
    const opening = codexDialogue(req(), "do the thing").opening
    expect(parsed(opening)).toMatchObject({ method: "initialize", id: 1 })
    expect(opening).not.toContain("do the thing")
    expect(opening).not.toContain("\n")
  })

  it("answers initialize with the initialized notice and then a thread request", () => {
    const replies = codexDialogue(req(), "do the thing").replyTo(INITIALIZED).map(parsed)
    expect(replies.map((r) => r.method)).toEqual(["initialized", "thread/start"])
    expect(replies[0]?.id).toBeUndefined()
  })

  it("names the bare model, the checkout and an open sandbox on the thread", () => {
    expect(threadRequest().params).toMatchObject({
      model: "gpt-5.6-sol",
      cwd: "/tmp/work",
      sandbox: "danger-full-access",
    })
  })

  it("rules out approval requests, which nothing would answer", () => {
    for (const r of [threadRequest(), threadRequest({ resumeFrom: SessionId.make("x") })]) {
      expect(r.params?.["approvalPolicy"]).toBe("never")
    }
  })

  it("claims no session id on a fresh thread — Codex announces its own", () => {
    const d = codexDialogue(req(), "do the thing")
    const written = [d.opening, ...d.replyTo(INITIALIZED), ...d.replyTo(THREAD_OPENED)].join("\n")
    expect(written).not.toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
  })

  it("resumes by the announced id, without asking for the thread's history back", () => {
    const r = threadRequest({ resumeFrom: SessionId.make("01a0afa1-c237-7380-9bad-2c0a466452f2") })
    expect(r.method).toBe("thread/resume")
    expect(r.params).toMatchObject({
      threadId: "01a0afa1-c237-7380-9bad-2c0a466452f2",
      excludeTurns: true,
      model: "gpt-5.6-sol",
    })
  })

  it("asks for the reasoning summary, on a fresh thread and a resume alike", () => {
    // Without the key Codex spends the reasoning tokens and the item completes empty,
    // so a step draws no pause at all.
    for (const r of [threadRequest(), threadRequest({ resumeFrom: SessionId.make("x") })]) {
      expect(r.params?.["config"]).toMatchObject({ model_reasoning_summary: "detailed" })
    }
  })

  it("passes a resolved effort in the thread's config, on a fresh thread and a resume alike", () => {
    for (const r of [
      threadRequest({ effort: "high" }),
      threadRequest({ effort: "high", resumeFrom: SessionId.make("x") }),
    ]) {
      expect(r.params?.["config"]).toMatchObject({ model_reasoning_effort: "high" })
    }
  })

  it("sets no effort where none resolved, so the model runs at its catalog's default", () => {
    expect(threadRequest().params?.["config"]).toEqual({ model_reasoning_summary: "detailed" })
  })

  it("takes every level the loader accepts for this CLI, which is the CLI's set and not one model's", () => {
    const levels = CLI_EFFORTS.get(codexSpec.name) ?? []
    expect(levels).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
      "persistent",
    ])
    for (const level of levels) {
      expect(threadRequest({ effort: level }).params?.["config"]).toMatchObject({
        model_reasoning_effort: level,
      })
    }
  })
})

describe("codexDialogue — the turn", () => {
  it("starts the turn on the thread the server named, carrying the prompt it was handed", () => {
    // The second argument and not `req.prompt`: the harness has written the brief and
    // the restriction around it by then.
    const replies = codexDialogue(req(), "BRIEF\n\ndo the thing").replyTo(THREAD_OPENED)
    expect(replies.map(parsed)).toEqual([
      {
        method: "turn/start",
        id: 3,
        params: {
          threadId: "01a0afa1-c237-7380-9bad-2c0a466452f2",
          input: [{ type: "text", text: "BRIEF\n\ndo the thing", text_elements: [] }],
        },
      },
    ])
  })

  it("carries each picture as a local image, by the path the checkout holds it at", () => {
    const image = {
      path: "/w/.orkestra/.attachments/a-shot.png",
      mediaType: "image/png",
      data: "iVBO",
    }
    const replies = codexDialogue(req({ images: [image] }), "see this").replyTo(THREAD_OPENED)
    expect(replies.map(parsed)[0]?.params?.["input"]).toEqual([
      { type: "text", text: "see this", text_elements: [] },
      { type: "localImage", path: "/w/.orkestra/.attachments/a-shot.png" },
    ])
  })

  it("writes each request as one line, whatever the prompt holds", () => {
    const replies = codexDialogue(req(), "line one\nline two").replyTo(THREAD_OPENED)
    expect(replies.every((line) => !line.includes("\n"))).toBe(true)
  })

  it("carries no brief on the thread — it goes in the prompt body", () => {
    const r = threadRequest({ brief: { core: "be terse", contract: "end with JSON" } })
    expect(JSON.stringify(r)).not.toContain("be terse")
    expect(r.params).not.toHaveProperty("developerInstructions")
  })

  it.each([
    ["a notification", '{"method":"turn/started","params":{"turn":{"id":"t"}}}'],
    ["the turn request's own answer", '{"id":3,"result":{"turn":{"id":"t"}}}'],
    ["a refused thread request", '{"id":2,"error":{"code":-32600,"message":"no rollout found"}}'],
    ["a request of the server's own", '{"id":2,"method":"item/tool/call","params":{}}'],
    ["a line that is not JSON", "not json"],
  ])("writes nothing in reply to %s", (_label, line) => {
    expect(codexDialogue(req(), "do the thing").replyTo(line)).toEqual([])
  })
})

// What a steered message's cases share: the thread the dialogue was told, the answer
// that names its turn, and the two lines that end a steer's wait.
const STEERED_THREAD = "01a0afa1-c237-7380-9bad-2c0a466452f2"
const TURN_STARTED = '{"id":3,"result":{"turn":{"id":"turn-1"}}}'
const refused = (id: number): string =>
  JSON.stringify({ id, error: { code: -32_600, message: "no active turn to steer" } })
const ended = (turn: string, threadId = STEERED_THREAD): string =>
  JSON.stringify({ method: "turn/completed", params: { threadId, turn: { id: turn } } })
const first = { key: "key-1", text: "also say TANGERINE" }
const second = { key: "key-2", text: "and QUINCE" }

/** A dialogue whose turn has been named, which is the first point a steer can be written. */
const running = () => {
  const d = codexDialogue(req(), "do the thing")
  d.replyTo(INITIALIZED)
  d.replyTo(THREAD_OPENED)
  d.replyTo(TURN_STARTED)
  return d
}

describe("codexDialogue — a message for the running turn", () => {
  it("steers the turn the server named, under the message's key", () => {
    expect(running().steer(first).map(parsed)).toEqual([
      {
        method: "turn/steer",
        id: 4,
        params: {
          threadId: STEERED_THREAD,
          expectedTurnId: "turn-1",
          clientUserMessageId: "key-1",
          input: [{ type: "text", text: "also say TANGERINE", text_elements: [] }],
        },
      },
    ])
  })

  it("steers a message's pictures in beside it, as local images", () => {
    const image = {
      path: "/w/.orkestra/.attachments/b-bug.png",
      mediaType: "image/png",
      data: "iVBO",
    }
    expect(
      running()
        .steer({ ...first, images: [image] })
        .map(parsed)[0]?.params?.["input"],
    ).toEqual([
      { type: "text", text: "also say TANGERINE", text_elements: [] },
      { type: "localImage", path: "/w/.orkestra/.attachments/b-bug.png" },
    ])
  })

  it("holds a message that arrives before the turn is named, and steers it when it is", () => {
    // The runtime hands over every waiting message the moment the process exists,
    // which is before `initialize` is answered.
    const d = codexDialogue(req(), "do the thing")
    expect(d.steer(first)).toEqual([])
    expect(d.replyTo(INITIALIZED).map((line) => parsed(line).method)).not.toContain("turn/steer")
    d.replyTo(THREAD_OPENED)
    expect(d.replyTo(TURN_STARTED).map(parsed)).toMatchObject([
      { method: "turn/steer", params: { expectedTurnId: "turn-1", clientUserMessageId: "key-1" } },
    ])
  })

  it("starts a refused message as a turn of its own, once the turn before it has ended", () => {
    const d = running()
    d.steer(first)
    // The refusal can be read before the ending: nothing starts beside a running turn.
    expect(d.replyTo(refused(4))).toEqual([])
    expect(d.replyTo(ended("turn-1")).map(parsed)).toEqual([
      {
        method: "turn/start",
        id: 5,
        params: {
          threadId: STEERED_THREAD,
          clientUserMessageId: "key-1",
          input: [{ type: "text", text: "also say TANGERINE", text_elements: [] }],
        },
      },
    ])
  })

  it("starts it at the refusal where the ending was read first", () => {
    const d = running()
    d.steer(first)
    expect(d.replyTo(ended("turn-1"))).toEqual([])
    expect(d.replyTo(refused(4)).map((line) => parsed(line).method)).toEqual(["turn/start"])
  })

  it("starts one follow-on turn, and steers a second refused message into it", () => {
    const d = running()
    d.steer(first)
    d.steer(second)
    d.replyTo(ended("turn-1"))
    expect(d.replyTo(refused(4)).map((line) => parsed(line).method)).toEqual(["turn/start"])
    expect(d.replyTo(refused(5))).toEqual([])
    expect(d.replyTo('{"id":6,"result":{"turn":{"id":"turn-2"}}}').map(parsed)).toMatchObject([
      { method: "turn/steer", params: { expectedTurnId: "turn-2", clientUserMessageId: "key-2" } },
    ])
  })

  it("does not end the turn on a subagent's ending, which names another thread", () => {
    const d = running()
    d.replyTo(ended("turn-9", "thread-of-the-subagent"))
    expect(d.steer(first).map((line) => parsed(line).method)).toEqual(["turn/steer"])
  })
})

describe("codexDialogue — when the pipe may close", () => {
  it("is settled only once nothing it wrote is owed an answer and no turn is running", () => {
    const d = running()
    expect(d.settled()).toBe(false)
    d.steer(first)
    d.replyTo(ended("turn-1"))
    // The steer is unanswered: closing the pipe now would take the message with it.
    expect(d.settled()).toBe(false)
    d.replyTo(refused(4))
    d.replyTo('{"id":5,"result":{"turn":{"id":"turn-2"}}}')
    expect(d.settled()).toBe(false)
    d.replyTo(ended("turn-2"))
    expect(d.settled()).toBe(true)
  })

  it("is settled at the turn's ending where the steer was taken", () => {
    const d = running()
    d.steer(first)
    d.replyTo('{"id":4,"result":{"turnId":"turn-1"}}')
    expect(d.replyTo(ended("turn-1"))).toEqual([])
    expect(d.settled()).toBe(true)
  })

  it("is settled where a follow-on turn is refused, and asks for that message once", () => {
    const d = running()
    d.steer(first)
    d.replyTo(ended("turn-1"))
    d.replyTo(refused(4))
    expect(d.replyTo(refused(5))).toEqual([])
    expect(d.settled()).toBe(true)
  })

  it("starts nothing in place of the step's own turn where Codex refuses it", () => {
    const d = codexDialogue(req(), "do the thing")
    d.steer(first)
    d.replyTo(INITIALIZED)
    d.replyTo(THREAD_OPENED)
    expect(d.replyTo(refused(3))).toEqual([])
  })
})

describe("codexDialogue MCP servers", () => {
  it("puts each MCP server under its own dotted key, on a fresh thread and a resume alike", () => {
    const fields = { command: "/bin/orkestra", args: ["goal-tools"], env: { ORK_GOAL_ID: "g" } }
    const server = McpServer.Stdio(fields)
    for (const r of [
      threadRequest({ mcpServers: { "orkestra-goal": server } }),
      threadRequest({ mcpServers: { "orkestra-goal": server }, resumeFrom: SessionId.make("x") }),
    ]) {
      expect(r.params?.["config"]).toMatchObject({ "mcp_servers.orkestra-goal": fields })
    }
  })

  it("raises a server's tool-call timeout where one is given", () => {
    const server = McpServer.Stdio({
      command: "/bin/orkestra",
      args: ["trak-tools"],
      env: {},
      timeoutSeconds: 900,
    })
    expect(threadRequest({ mcpServers: { t: server } }).params?.["config"]).toMatchObject({
      "mcp_servers.t": { command: "/bin/orkestra", args: ["trak-tools"], tool_timeout_sec: 900 },
    })
  })

  it("puts a streamable-HTTP server's headers under http_headers", () => {
    const headers = { Authorization: "Bearer t" }
    const r = threadRequest({
      mcpServers: { remote: McpServer.Http({ url: "https://x.io/mcp", headers }) },
    })
    expect(r.params?.["config"]).toEqual({
      model_reasoning_summary: "detailed",
      "mcp_servers.remote": { url: "https://x.io/mcp", http_headers: headers },
    })
  })

  it("names only the url of an HTTP server handed no headers", () => {
    const r = threadRequest({ mcpServers: { remote: McpServer.Http({ url: "https://x.io/mcp" }) } })
    expect(r.params?.["config"]).toEqual({
      model_reasoning_summary: "detailed",
      "mcp_servers.remote": { url: "https://x.io/mcp" },
    })
  })

  it("puts HTTP and stdio servers side by side, each under its own key", () => {
    const r = threadRequest({
      mcpServers: {
        t: McpServer.Stdio({ command: "/bin/orkestra", args: ["trak-tools"], env: {} }),
        remote: McpServer.Http({ url: "https://x.io/mcp", timeoutSeconds: 30 }),
      },
    })
    expect(r.params?.["config"]).toEqual({
      model_reasoning_summary: "detailed",
      "mcp_servers.t": { command: "/bin/orkestra", args: ["trak-tools"], env: {} },
      "mcp_servers.remote": { url: "https://x.io/mcp", tool_timeout_sec: 30 },
    })
  })

  it("hands a credential to its server's own env, down the pipe and never on argv", () => {
    const env = { ORK_MCP_KEY: "engine-key-123", ORK_MCP_HOST: "http://127.0.0.1:7000" }
    const proxy = McpServer.Stdio({
      command: "/usr/bin/node",
      args: ["/opt/orkestra/mcp-proxy.js", "linear", "https://mcp.linear.app/mcp"],
      env,
    })
    expect(codexArgv().join(" ")).not.toContain("engine-key-123")
    expect(codexSpec.mcpConfigFile(req({ mcpServers: { linear: proxy } }))).toBeUndefined()
    expect(threadRequest({ mcpServers: { linear: proxy } }).params?.["config"]).toMatchObject({
      "mcp_servers.linear": {
        command: "/usr/bin/node",
        args: ["/opt/orkestra/mcp-proxy.js", "linear", "https://mcp.linear.app/mcp"],
        env,
      },
    })
  })

  it("hands a filled secret as it is, `${` included — the engine fills a reference once", () => {
    const headers = { Authorization: "Bearer a${HOME}b" }
    const r = threadRequest({
      mcpServers: { remote: McpServer.Http({ url: "https://x.io/mcp", headers }) },
    })
    expect(r.params?.["config"]).toMatchObject({
      "mcp_servers.remote": { url: "https://x.io/mcp", http_headers: headers },
    })
  })
})
