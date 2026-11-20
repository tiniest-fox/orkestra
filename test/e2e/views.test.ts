// An MCP tool's view, from the call that left it to a press on it: kept beside the
// transcript when the call completes, served whole with its network policy written in,
// and pressed through a CLI with no turn — within what the view's own server opens.
//
// The agent is scripted, so the server behind the view is the fake's. What is under
// test is the engine's half: what it keeps, what it serves, and what it refuses.

import { Effect, Schedule, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { RefusalDto } from "@orkestra/shared/dto/common"
import { ViewDto, ViewResultDto } from "@orkestra/shared/dto/trak"
import { McpServer, type SessionRequest } from "../../src/agent/types/session.js"
import type { TranscriptEntry } from "../../src/agent/types/transcript-entry.js"
import { Views } from "../../src/app/views.js"
import { parseMcpFile } from "../../src/library/logic/mcp-file.js"
import { Store } from "../../src/workflow/ports/store.js"
import { composer, runFlow, runFlowWithAgentLog, step } from "../support/flow.js"
import { mount } from "../support/http.js"
import { viewRoutes } from "../../src/app/routes/views.js"
import { act, create, human } from "../support/scenario.js"
import { library } from "../support/library.js"
import { reply, type ScriptedView, type Turn } from "../support/scripted-agent.js"

const { get, post } = mount(viewRoutes)

const CALL = "toolu_view01"

const VIEW: ScriptedView = {
  call: CALL,
  server: "metrics",
  tool: "show_dashboard",
  uri: "ui://metrics/dashboard.html",
  html: "<!DOCTYPE html><html><body><button>Press</button></body></html>",
  open: ["press"],
  modelOnly: ["reset_everything"],
}

/** A plan of two steps, the first of which calls the tool with a view. */
const turns: readonly Turn[] = [
  composer("plan", "work"),
  { ...step(1, "plan", reply.artifact("the dashboard is up")), view: VIEW },
  step(2, "work", reply.artifact("done")),
]

const jsonOf = (response: HttpServerResponse): Effect.Effect<unknown> =>
  Effect.promise(async (): Promise<unknown> => {
    const parsed: unknown = JSON.parse(await toWeb(response).text())
    return parsed
  })

const isView = (entry: TranscriptEntry): boolean => entry._tag === "View"
const isPayload = (entry: TranscriptEntry): boolean =>
  entry._tag === "Note" && entry.text.startsWith("McpReturned")

const press = (id: string, call: string, tool: string) =>
  post(id, `views/${call}/call`, { tool, arguments: { by: 1 } })

describe("a view an MCP tool's call left", () => {
  it("is kept when the call completes, named on the transcript, and served with nothing allowed on the network", async () => {
    await runFlow(turns, (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* act(id, 0, human.approve())

        const transcript = yield* (yield* Store).transcript(id)
        expect(transcript.filter(isView)).toMatchObject([
          { call: CALL, server: "metrics", tool: "show_dashboard", uri: VIEW.uri },
        ])
        // The payload event is the store's alone: no line of the transcript holds it.
        expect(transcript.some(isPayload)).toBe(false)

        // Read with no CLI running — everything a view draws from was stored.
        const response = yield* get(`/${id}/views/${CALL}`)
        expect(response.status).toBe(200)
        const view = Schema.decodeUnknownSync(ViewDto)(yield* jsonOf(response))
        expect(view).toMatchObject({
          server: "metrics",
          tool: "show_dashboard",
          arguments: { shown: "show_dashboard" },
          result: { content: [{ type: "text", text: "count is 0" }], isError: false },
          answers: true,
        })
        // The engine's own document, policy first, with the server's HTML carried
        // inside it rather than served bare.
        expect(view.html).toMatch(
          /^<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*connect-src 'none'; frame-src 'none';/,
        )
        expect(view.html).toContain(String.raw`\u003cbutton>Press\u003c/button>`)
        expect(view.html).not.toContain("<button>")
      }),
    )
  })

  it("answers 404 for a call that left none", async () => {
    await runFlow(turns, (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        expect((yield* get(`/${id}/views/toolu_nothing`)).status).toBe(404)
        expect((yield* press(id, "toolu_nothing", "press")).status).toBe(404)
      }),
    )
  })
})

describe("a press on a view", () => {
  it("calls a tool the view's server opens to views, with no turn, and holds the CLI it started", async () => {
    await runFlow(turns, (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* act(id, 0, human.approve())
        const views = yield* Views
        expect(yield* views.attending(id)).toBe(false)

        const response = yield* press(id, CALL, "press")
        expect(response.status).toBe(200)
        expect(Schema.decodeUnknownSync(ViewResultDto)(yield* jsonOf(response))).toEqual({
          content: [{ type: "text", text: "press called" }],
          structured: { tool: "press", arguments: { by: 1 } },
          isError: false,
        })
        expect(yield* views.attending(id)).toBe(true)

        // The trak starting a turn ends the CLI a press started.
        yield* act(id, 1, human.approve())
        yield* Effect.repeat(views.attending(id), {
          until: (held) => !held,
          schedule: Schedule.spaced("10 millis"),
        })
      }),
    )
  })

  it("is refused for a tool marked for the model only, and for one no tool of its server has", async () => {
    await runFlow(turns, (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* act(id, 0, human.approve())
        for (const tool of ["reset_everything", "other_server_tool", "mcp__other__press"]) {
          const response = yield* press(id, CALL, tool)
          expect(response.status).toBe(403)
          expect(Schema.decodeUnknownSync(RefusalDto)(yield* jsonOf(response))).toEqual({
            _tag: "ToolNotOpen",
          })
        }
        // Refused before anything was started.
        expect(yield* (yield* Views).attending(id)).toBe(false)
      }),
    )
  })
})

/** A project whose `mcp.yaml` declares the view's own server, as `entry` says. */
const declaring = (entry: string) =>
  library({ mcp: parseMcpFile(".orkestra/mcp.yaml", `servers:\n  metrics:\n${entry}`) })

const dialed = (r: SessionRequest) => r.mcpServers

describe("a press in a project that declares the view's server in mcp.yaml", () => {
  it("starts the CLI with the declared servers, as a turn's are", async () => {
    await runFlowWithAgentLog(
      turns,
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          yield* act(id, 0, human.approve())
          expect((yield* press(id, CALL, "press")).status).toBe(200)
          expect((yield* agentLog).attended.map(dialed)).toEqual([
            { metrics: McpServer.Stdio({ command: "metrics-mcp", args: [], env: {} }) },
          ])
        }),
      declaring("    command: metrics-mcp\n"),
    )
  })

  it("is refused, naming the secret, when that server's secret is unset — and starts nothing", async () => {
    await runFlowWithAgentLog(
      turns,
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          yield* act(id, 0, human.approve())
          const response = yield* press(id, CALL, "press")
          expect(response.status).toBe(503)
          expect(Schema.decodeUnknownSync(RefusalDto)(yield* jsonOf(response))).toMatchObject({
            _tag: "CliNotStarted",
            reason:
              "MCP server `metrics` was left out of this turn: the secret `METRICS_TOKEN` is not set in the engine's environment.",
          })
          expect((yield* agentLog).attended).toEqual([])
          expect(yield* (yield* Views).attending(id)).toBe(false)
        }),
      declaring(
        '    url: https://metrics.example/mcp\n    headers:\n      Authorization: "Bearer ${METRICS_TOKEN}"\n',
      ),
    )
  })
})
