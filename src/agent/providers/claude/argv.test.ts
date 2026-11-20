// Unit tests for override point 1. Three of these encode failures that shipped once —
// a missing --permission-mode, a non-UUID session id, and a spec's read-only list that
// reached the prompt but not the flag — and would silently regress without them.

import { describe, expect, it } from "vitest"
import { CLI_EFFORTS } from "../../types/effort.js"
import { McpServer, SessionId } from "../../types/session.js"
import {
  CLAUDE_READ_ONLY_TOOLS,
  claudeArgv,
  claudeMcpConfigFile,
  claudePromptLine,
  claudeSessionFile,
  claudeSetupHold,
  claudeSetupSettings,
  claudeStopTaskLine,
} from "./argv.js"
import { claudeSpec } from "./index.js"

const req = (over: Partial<Parameters<typeof claudeArgv>[0]> = {}) => ({
  prompt: "do the thing",
  cwd: "/tmp",
  model: "haiku",
  sessionId: SessionId.make("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
  toolAccess: "write" as const,
  permission: "read" as const,
  resumeFrom: undefined,
  inherited: false,
  effort: undefined,
  brief: undefined,
  env: {},
  ...over,
})

/** Called the way cli-provider.ts calls it: the tool list comes from the spec. */
const argv = (
  over: Partial<Parameters<typeof claudeArgv>[0]> = {},
  tools: readonly string[] = CLAUDE_READ_ONLY_TOOLS,
) => claudeArgv(req(over), tools, undefined)

const STDIO = { command: "/bin/orkestra", args: ["goal-tools"], env: { ORK_GOAL_ID: "g" } }
const SERVER = McpServer.Stdio(STDIO)

describe("claudeArgv", () => {
  it("always asks for non-interactive stream-json", () => {
    const a = argv()
    expect(a).toContain("--print")
    expect(a.join(" ")).toContain("--output-format stream-json")
  })

  it("asks for streaming input, so the turn ends at its result frame rather than at EOF", () => {
    expect(argv().join(" ")).toContain("--input-format stream-json")
  })

  it("asks for user messages back, which is the only report that a steered one was read", () => {
    expect(argv()).toContain("--replay-user-messages")
  })

  it("claims a fresh session by id", () => {
    const a = argv()
    expect(a.join(" ")).toContain("--session-id aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    expect(a).not.toContain("--resume")
  })

  it("resumes an existing session instead of claiming one", () => {
    const a = argv({ resumeFrom: SessionId.make("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") })
    expect(a.join(" ")).toContain("--resume bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    expect(a).not.toContain("--session-id")
  })

  it("never puts the prompt in argv — it travels on stdin", () => {
    expect(argv().join(" ")).not.toContain("do the thing")
  })

  it("keeps the variadic --disallowedTools LAST so it cannot eat an argument", () => {
    const a = argv({ toolAccess: "read-only" })
    expect(a.indexOf("--disallowedTools")).toBe(a.length - CLAUDE_READ_ONLY_TOOLS.length - 1)
    expect(a.slice(-CLAUDE_READ_ONLY_TOOLS.length)).toEqual([...CLAUDE_READ_ONLY_TOOLS])
  })

  it("passes tools as separate args, not a comma-joined string", () => {
    expect(argv({ toolAccess: "read-only" })).not.toContain(CLAUDE_READ_ONLY_TOOLS.join(","))
  })

  it("denies the edit tools, and only those — Bash is how a read-only turn runs the tests", () => {
    const a = argv({ toolAccess: "read-only" })
    expect(a).toContain("Edit")
    expect(a).not.toContain("Bash")
  })

  // The regression: `pnpm real:trak` spreads the claude spec with a wider list, and
  // for a while argv closed over the module constant instead — so the demo printed a
  // clamp on Bash and Task that was never on the command line.
  it("passes a resolved effort as --effort, and nothing at all where none resolved", () => {
    expect(argv({ effort: "high" }).join(" ")).toContain("--effort high")
    expect(argv()).not.toContain("--effort")
  })

  it("takes every level the loader accepts for this CLI, unchecked — the check is at load", () => {
    // `claude --effort bogus` warns on stderr and runs at exit 0, so a level that reaches
    // here is already the loader's word. The key the loader validates under is the name
    // the spec registers as; this is the one place the two are held together.
    const levels = CLI_EFFORTS.get(claudeSpec.name) ?? []
    expect(levels).toEqual(["low", "medium", "high", "xhigh", "max"])
    for (const level of levels)
      expect(argv({ effort: level }).join(" ")).toContain(`--effort ${level}`)
  })

  it("denies whatever list the spec carries, not a list of its own", () => {
    const a = argv({ toolAccess: "read-only" }, ["Edit", "Bash", "Task"])
    expect(a.slice(-3)).toEqual(["Edit", "Bash", "Task"])
    expect(a).not.toContain("NotebookEdit")
  })

  it("omits the flag entirely for a turn that is meant to write", () => {
    expect(argv({ toolAccess: "write" })).not.toContain("--disallowedTools")
  })
})

describe("the two stdin lines", () => {
  it("wraps a prompt as one user-message frame, whole", () => {
    expect(JSON.parse(claudePromptLine('say "hi"\nthen stop'))).toEqual({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: 'say "hi"\nthen stop' }] },
    })
  })

  it("carries each picture as an image block of its bytes, ahead of the text", () => {
    const image = {
      path: "/w/.orkestra/.attachments/a-shot.png",
      mediaType: "image/png",
      data: "iVBO",
    }
    expect(JSON.parse(claudePromptLine("see this", [image]))).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBO" } },
          { type: "text", text: "see this" },
        ],
      },
    })
  })

  it("writes the stop control as claude's control_request frame", () => {
    expect(JSON.parse(claudeStopTaskLine("task-9", "ork-1"))).toEqual({
      type: "control_request",
      request_id: "ork-1",
      request: { subtype: "stop_task", task_id: "task-9" },
    })
  })
})

describe("claudeArgv — the standing brief", () => {
  const brief = { core: "be terse", contract: "end with JSON" }

  it("appends both halves rather than replacing, so claude keeps its own", () => {
    const a = argv({ brief })
    expect(a[a.indexOf("--append-system-prompt") + 1]).toBe("be terse\n\nend with JSON")
    expect(a).not.toContain("--system-prompt")
  })

  it("sends the whole brief on a resume too — the flag is the session's, not the turn's", () => {
    const a = argv({ brief, resumeFrom: SessionId.make("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") })
    expect(a[a.indexOf("--append-system-prompt") + 1]).toBe("be terse\n\nend with JSON")
  })

  it("omits the flag when there is none, so its absence is observable", () => {
    expect(argv()).not.toContain("--append-system-prompt")
  })

  it("stays ahead of the variadic --disallowedTools", () => {
    const a = argv({ brief, toolAccess: "read-only" })
    expect(a.indexOf("--append-system-prompt")).toBeLessThan(a.indexOf("--disallowedTools"))
  })
})

describe("claudeArgv — permission mode", () => {
  it.each([
    ["read", "plan"],
    ["edit", "acceptEdits"],
    ["auto", "auto"],
    ["full", "bypassPermissions"],
  ] as const)("maps %s to --permission-mode %s", (permission, flag) => {
    const a = argv({ permission })
    expect(a[a.indexOf("--permission-mode") + 1]).toBe(flag)
  })

  it("always passes the flag — omitting it makes claude deny edits but exit success", () => {
    expect(argv({})).toContain("--permission-mode")
  })
})

describe("claudeArgv MCP servers", () => {
  const PATH = "/tmp/orkestra-mcp-x/mcp.json"

  it("names the file the harness wrote, added to the CLI's own servers", () => {
    const a = claudeArgv(req({ mcpServers: { "orkestra-goal": SERVER } }), [], PATH)
    expect(a[a.indexOf("--mcp-config") + 1]).toBe(PATH)
    expect(a).not.toContain("--strict-mcp-config")
  })

  it("names no MCP configuration for a session handed none", () => {
    expect(argv()).not.toContain("--mcp-config")
  })

  it("keeps --mcp-config ahead of the variadic --disallowedTools", () => {
    const a = claudeArgv(req({ toolAccess: "read-only" }), CLAUDE_READ_ONLY_TOOLS, PATH)
    expect(a.indexOf("--mcp-config")).toBeLessThan(a.indexOf("--disallowedTools"))
  })

  it("puts no credential a server carries on the command line", () => {
    const servers = {
      remote: McpServer.Http({
        url: "https://x.io/mcp",
        headers: { Authorization: "Bearer lin_secret" },
      }),
      "orkestra-goal": McpServer.Stdio({
        ...STDIO,
        env: { ORK_GOAL_TOKEN: "goal-token-456" },
      }),
      linear: McpServer.Stdio({
        command: "/usr/bin/node",
        args: ["/opt/orkestra/mcp-proxy.js", "linear", "https://mcp.linear.app/mcp"],
        env: { ORK_MCP_KEY: "engine-key-123", ORK_MCP_HOST: "http://127.0.0.1:7000" },
      }),
    }
    const line = claudeArgv(req({ mcpServers: servers }), [], PATH).join(" ")
    for (const secret of ["lin_secret", "goal-token-456", "engine-key-123", "127.0.0.1:7000"]) {
      expect(line).not.toContain(secret)
    }
  })
})

describe("the setup hook", () => {
  const gate = { statusFile: "/w/.orkestra/.setup/status", waitSeconds: 660 }

  it("is one PreToolUse hook on Bash, waiting as long as the gate says", () => {
    expect(JSON.parse(claudeSetupSettings(gate))).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: claudeSetupHold(gate.statusFile), timeout: 660 }],
          },
        ],
      },
    })
  })

  it("is the settings file the spec writes for a turn handed a gate, and none otherwise", () => {
    const delivery = claudeSpec.setupGate
    expect(delivery._tag === "SettingsFile" ? delivery.text(gate) : undefined).toBe(
      claudeSetupSettings(gate),
    )
    expect(claudeArgv(req(), CLAUDE_READ_ONLY_TOOLS, undefined, "/tmp/s.json").join(" ")).toContain(
      "--settings /tmp/s.json",
    )
    expect(argv()).not.toContain("--settings")
  })

  it("waits while the file says running, refuses with what follows a failure, and reads the path as one word", () => {
    const hold = claudeSetupHold("/w/it's here/status")
    expect(hold).toContain(`'/w/it'\\''s here/status'`)
    expect(hold).toContain("= running ]; do sleep 1; done")
    expect(hold).toContain("= failed ]; then tail -n +2")
    expect(hold).toContain(">&2; exit 2; fi")
  })
})

describe("claudeMcpConfigFile", () => {
  const config = (servers: Record<string, McpServer>): unknown =>
    JSON.parse(claudeMcpConfigFile(req({ mcpServers: servers })) ?? "")

  it("is nothing for a session handed no server", () => {
    expect(claudeSpec.mcpConfigFile(req())).toBeUndefined()
  })

  it("is the configuration file's own JSON for a stdio server", () => {
    expect(config({ "orkestra-goal": SERVER })).toEqual({
      mcpServers: { "orkestra-goal": { type: "stdio", ...STDIO } },
    })
  })

  it("gives a server's tool calls its own timeout, in milliseconds", () => {
    expect(config({ s: McpServer.Stdio({ ...STDIO, timeoutSeconds: 900 }) })).toEqual({
      mcpServers: { s: { type: "stdio", ...STDIO, timeout: 900_000 } },
    })
  })

  it("hands a streamable-HTTP server as type http, with its headers", () => {
    const headers = { Authorization: "Bearer t" }
    expect(config({ remote: McpServer.Http({ url: "https://x.io/mcp", headers }) })).toEqual({
      mcpServers: { remote: { type: "http", url: "https://x.io/mcp", headers } },
    })
  })

  it("names no headers on an HTTP server handed none", () => {
    expect(config({ remote: McpServer.Http({ url: "https://x.io/mcp" }) })).toEqual({
      mcpServers: { remote: { type: "http", url: "https://x.io/mcp" } },
    })
  })

  it("hands HTTP and stdio servers side by side in one configuration", () => {
    expect(
      config({
        "orkestra-goal": SERVER,
        remote: McpServer.Http({ url: "https://x.io/mcp", timeoutSeconds: 30 }),
      }),
    ).toEqual({
      mcpServers: {
        "orkestra-goal": { type: "stdio", ...STDIO },
        remote: { type: "http", url: "https://x.io/mcp", timeout: 30_000 },
      },
    })
  })

  it("hands a filled secret as it is, `${` included — the engine fills a reference once", () => {
    const headers = { Authorization: "Bearer a${HOME}b" }
    const env = { TOKEN: "x${Y}" }
    expect(
      config({
        remote: McpServer.Http({ url: "https://x.io/mcp", headers }),
        local: McpServer.Stdio({ command: "srv", args: [], env }),
      }),
    ).toEqual({
      mcpServers: {
        remote: { type: "http", url: "https://x.io/mcp", headers },
        local: { type: "stdio", command: "srv", args: [], env },
      },
    })
  })
})

describe("where Claude Code files a session", () => {
  it("is under its home's projects, in a directory named for the cwd with every other character a dash", () => {
    expect(
      claudeSessionFile(
        "/home/u/projects/octocat/orkestra/.orkestra/.worktrees/yabbering-tomato-camel",
        SessionId.make("abc"),
      ),
    ).toBe(
      ".claude/projects/-home-u-projects-octocat-orkestra--orkestra--worktrees-yabbering-tomato-camel/abc.jsonl",
    )
  })
})
