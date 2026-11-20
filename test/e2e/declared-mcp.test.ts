// A project's `.orkestra/mcp.yaml`, end to end on a trak: what it declares reaches the
// composer and every step beside the engine's own servers, filled from the engine's
// environment, and a server that cannot be filled — or a file that cannot be read —
// costs a tool and a line on the transcript, never the turn.
//
// The session request is the same for either CLI; how each renders the servers is the
// argv tests' half. A goal's composer and a view press are in their own themes.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { McpServer, type SessionRequest } from "../../src/agent/types/session.js"
import type { TranscriptEntry } from "../../src/agent/types/transcript-entry.js"
import type { Check } from "../../src/library/types/check.js"
import type { Library } from "../../src/library/types/library.js"
import { claudeSpec } from "../../src/agent/providers/claude/index.js"
import { parseMcpFile } from "../../src/library/logic/mcp-file.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import { composer, composerRuns, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import { createAndStart, logTags, trakToolsServer } from "../support/scenario.js"
import { workDeclaring } from "../support/library.js"
import { reply } from "../support/scripted-agent.js"
import { engineStartedWith } from "../support/scripted-environment.js"

const MCP_YAML = `servers:
  linear:
    url: https://mcp.linear.app/mcp
    headers:
      Authorization: "Bearer \${LINEAR_API_KEY}"
  files:
    command: files-mcp
    args: ["--root", "."]
`

const LINEAR = McpServer.Http({
  url: "https://mcp.linear.app/mcp",
  headers: { Authorization: "Bearer lin_123" },
})
const FILES = McpServer.Stdio({ command: "files-mcp", args: ["--root", "."], env: {} })

/** A check that keeps a pass, so `work` is handed the engine's own `orkestra-trak`. */
const VERIFY: Check = {
  name: "verify",
  description: "Runs verify.",
  timeoutSeconds: 60,
  askedEverySeconds: undefined,
  exclusive: false,
  cache: true,
  ignoresLinguistGenerated: false,
  units: undefined,
  cacheAcross: "platform" as const,
  path: "/repo/.orkestra/checks/verify.sh",
}

const declaring = (text: string): Library =>
  workDeclaring(["verify"], {
    checks: new Map([["verify", VERIFY]]),
    mcp: parseMcpFile(".orkestra/mcp.yaml", text),
  })

const turns = [composer("work"), step(1, "work", reply.artifact("Added --json"))]

/** The notes `mcp.yaml` left, as `[position, text]` — every other note is the turn's own. */
const notesOf = (id: TrakId) =>
  Effect.map(
    Effect.flatMap(Store, (s) => s.transcript(id)),
    (entries: readonly TranscriptEntry[]) =>
      entries.flatMap((e) =>
        e._tag === "Note" && /^MCP server|^`\.orkestra\/mcp\.yaml`/.test(e.text)
          ? [[e.position, e.text]]
          : [],
      ),
  )

const positionOf = ([position]: readonly unknown[]): unknown => position

const serversOf = (runs: readonly SessionRequest[]) => runs.map((r) => r.mcpServers)

/**
 * Each run as `claude` would be spawned for it: its command line, and the configuration
 * file that line names. The credentials a server carries belong in the file alone.
 */
const claudeSpawnsOf = (runs: readonly SessionRequest[]) =>
  runs.map((r) => ({
    argv: claudeSpec.argv(r, claudeSpec.readOnlyTools, "/tmp/orkestra-mcp/mcp.json").join(" "),
    file: claudeSpec.mcpConfigFile(r) ?? "",
  }))

describe("servers a project declares in mcp.yaml", () => {
  it("reach the composer and every step, filled, beside the engine's own", async () => {
    await runFlowWithAgentLog(
      turns,
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const log = yield* agentLog
          expect(serversOf(composerRuns(log))).toEqual([{ linear: LINEAR, files: FILES }])
          expect(serversOf(stepRuns(log))).toEqual([
            { linear: LINEAR, files: FILES, "orkestra-trak": trakToolsServer(id) },
          ])
          for (const spawn of claudeSpawnsOf([...composerRuns(log), ...stepRuns(log)])) {
            expect(spawn.argv).not.toContain("lin_123")
            expect(spawn.file).toContain("Bearer lin_123")
          }
          expect(yield* notesOf(id)).toEqual([])
        }),
      declaring(MCP_YAML),
      { verify: [] },
      undefined,
      undefined,
      engineStartedWith({ LINEAR_API_KEY: "lin_123" }),
    )
  })

  it("leave out a server whose secret is unset, say so on every turn, and the turns run", async () => {
    await runFlowWithAgentLog(
      turns,
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const log = yield* agentLog
          expect(serversOf(composerRuns(log))).toEqual([{ files: FILES }])
          expect(serversOf(stepRuns(log))).toEqual([
            { files: FILES, "orkestra-trak": trakToolsServer(id) },
          ])
          const line =
            "MCP server `linear` was left out of this turn: the secret `LINEAR_API_KEY` is not set in the engine's environment."
          expect(yield* notesOf(id)).toEqual([
            ["composer", line],
            [1, line],
          ])
          expect(yield* logTags(id)).toContain("AgentReturned")
        }),
      declaring(MCP_YAML),
      { verify: [] },
      undefined,
      undefined,
      engineStartedWith({}),
    )
  })

  it("from a file that is not YAML add none, say so, and the turns run", async () => {
    await runFlowWithAgentLog(
      turns,
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const log = yield* agentLog
          // The composer has no server of the engine's, so it is handed none at all.
          expect(serversOf(composerRuns(log))).toEqual([undefined])
          expect(serversOf(stepRuns(log))).toEqual([{ "orkestra-trak": trakToolsServer(id) }])
          const notes = yield* notesOf(id)
          expect(notes.map(positionOf)).toEqual(["composer", 1])
          expect(notes[0]?.[1]).toMatch(/^`\.orkestra\/mcp\.yaml` was not read.*invalid YAML/)
          expect(yield* logTags(id)).toContain("AgentReturned")
        }),
      declaring("servers: [unclosed\n"),
      { verify: [] },
    )
  })

  it("from a server with both command and url leave that one out, and say why", async () => {
    await runFlowWithAgentLog(
      turns,
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          expect(serversOf(composerRuns(yield* agentLog))).toEqual([{ files: FILES }])
          expect(yield* notesOf(id)).toContainEqual([
            "composer",
            "MCP server `both` in `.orkestra/mcp.yaml` was left out: a server has `command:` (stdio) or `url:` (http), and not both.",
          ])
        }),
      declaring(
        `${MCP_YAML.replace(/ {2}linear:[\s\S]*?(?= {2}files:)/, "")}  both:\n    command: x\n    url: https://x.io\n`,
      ),
      { verify: [] },
    )
  })
})
