// The MCP servers the host lists, end to end on a trak: what it lists reaches the composer
// and every step beside the engine's own servers, filled from the engine's environment,
// and a server that cannot be filled — or a host that cannot be asked — costs a tool and
// a line on the transcript, never the turn. A `.orkestra/mcp.yaml` left in a project adds
// nothing.
//
// The session request is the same for either CLI; how each renders the servers is the
// argv tests' half. A goal's composer and a view press are in their own themes.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import { McpServer, type SessionRequest } from "../../src/agent/types/session.js"
import type { TranscriptEntry } from "../../src/agent/types/transcript-entry.js"
import type { Check } from "../../src/library/types/check.js"
import type { Library } from "../../src/library/types/library.js"
import { claudeSpec } from "../../src/agent/providers/claude/index.js"
import { loadLibrary } from "../../src/library/adapters/library-fs.js"
import { SHIPPED_AGENTS } from "../../src/app/packaged.js"
import { DeclaredServer } from "../../src/workflow/domain/mcp-servers.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import { composer, composerRuns, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import { createAndStart, logTags, trakToolsServer } from "../support/scenario.js"
import { workDeclaring } from "../support/library.js"
import { reply } from "../support/scripted-agent.js"
import { hostListing } from "../support/scripted-environment.js"

const LISTED: readonly DeclaredServer[] = [
  DeclaredServer.Http({
    name: "linear",
    url: "https://mcp.linear.app/mcp",
    headers: { Authorization: "Bearer ${LINEAR_API_KEY}" },
  }),
  DeclaredServer.Stdio({ name: "files", command: "files-mcp", args: ["--root", "."], env: {} }),
]

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

const project: Library = workDeclaring(["verify"], { checks: new Map([["verify", VERIFY]]) })

const turns = [composer("work"), step(1, "work", reply.artifact("Added --json"))]

/** The notes the host's servers left, as `[position, text]` — every other note is the turn's own. */
const notesOf = (id: TrakId) =>
  Effect.map(
    Effect.flatMap(Store, (s) => s.transcript(id)),
    (entries: readonly TranscriptEntry[]) =>
      entries.flatMap((e) =>
        e._tag === "Note" && /MCP server/.test(e.text) ? [[e.position, e.text]] : [],
      ),
  )

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

describe("servers the host lists", () => {
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
      project,
      { verify: [] },
      undefined,
      undefined,
      hostListing(Either.right(LISTED), { LINEAR_API_KEY: "lin_123" }),
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
      project,
      { verify: [] },
      undefined,
      undefined,
      hostListing(Either.right(LISTED)),
    )
  })

  it("from a host that cannot be asked are none, said once a turn, and the turns run", async () => {
    await runFlowWithAgentLog(
      turns,
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const log = yield* agentLog
          // The composer has no server of the engine's, so it is handed none at all.
          expect(serversOf(composerRuns(log))).toEqual([undefined])
          expect(serversOf(stepRuns(log))).toEqual([{ "orkestra-trak": trakToolsServer(id) }])
          const line = "The host's MCP servers were left out of this turn: the host did not answer."
          expect(yield* notesOf(id)).toEqual([
            ["composer", line],
            [1, line],
          ])
          expect(yield* logTags(id)).toContain("AgentReturned")
        }),
      project,
      { verify: [] },
      undefined,
      undefined,
      hostListing(Either.left("the host did not answer")),
    )
  })
})

describe("a project's `.orkestra/mcp.yaml`", () => {
  it("adds no server and no line beside the host's list", async () => {
    const repo = mkdtempSync(join(tmpdir(), "orkestra-mcp-yaml-"))
    mkdirSync(join(repo, ".orkestra"))
    writeFileSync(
      join(repo, ".orkestra", "mcp.yaml"),
      "servers:\n  stale:\n    command: stale-mcp\n  broken: [unclosed\n",
    )
    const loaded = await Effect.runPromise(loadLibrary(repo, SHIPPED_AGENTS))
    const lib: Library = { ...loaded, agents: project.agents, checks: project.checks }
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
          expect(yield* notesOf(id)).toEqual([])
        }),
      lib,
      { verify: [] },
      undefined,
      undefined,
      hostListing(Either.right(LISTED.filter((s) => s.name === "files"))),
    )
  })
})
