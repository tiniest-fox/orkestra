// The engine's tools for a step's turn, as routes: what `orkestra trak-tools` lists and
// forwards. `run_check`, for every step where the project has a check that keeps a pass,
// whose work is `runCheckForTurn`'s; the process tools, for every turn, over the trak's
// `HostedProcesses`; the read tools, for every turn, which `read-tools.ts` answers; and
// `open_goal`, for the agent `offersEngineTools` names. This file reads the call and words
// the answer.
//
// **Every answer leaves with each secret value the engine holds taken out**, whichever
// tool made it: a check's output, a process's log and a transcript can each quote one.
//
//   GET  /api/traks/:id/tools        the tools as MCP lists them, for the turn in flight
//   POST /api/traks/:id/tools/:name  one call. A check answers once it has run: a run of
//                                    minutes holds the request open that long, and the
//                                    shim's own request has no timeout for that reason
//
// `trak-mcp.ts` serves the same list and the same calls as one MCP endpoint, for a session
// in a sandbox. The one route family a turn's own token reaches.

import { randomUUID } from "node:crypto"
import { Effect, Schema } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import { McpToolCallDto, type McpToolListDto } from "@orkestra/shared/dto/goals"
import type { SpawnStage } from "../agent/types/spawn-stage.js"
import { Lib } from "../library/ports/library.js"
import { render, type TemplateName } from "../prompts/index.js"
import { Prompts } from "../prompts/ports/prompts.js"
import { stripAnsi } from "../workflow/domain/check-progress.js"
import { GoalEvents } from "../workflow/domain/goal.js"
import { replayHistory } from "../workflow/domain/replay.js"
import { type Trak, TrakId } from "../workflow/domain/trak.js"
import {
  HostedProcesses,
  type HostedRun,
  UnknownProcess,
} from "../workflow/ports/hosted-processes.js"
import { Store } from "../workflow/ports/store.js"
import { TurnTools } from "../workflow/ports/turn-tools.js"
import {
  CheckCall,
  offeredChecks,
  offersEngineTools,
  RUN_CHECK,
  runCheckForTurn,
  turnAgent,
  workdir,
} from "./drive.js"
import { goalOpenedBy, startGoal } from "./goals.js"
import { isReadTool, READ_TOOLS, readCall, type ReadTool, readToolNames } from "./read-tools.js"
import { type Answer, did, hidingAnswers, inputSchemaOf, refused, withArgs } from "./tool-answer.js"

const pathTrak = Effect.gen(function* () {
  const raw = (yield* Router.params)["id"]
  if (raw === undefined) return yield* Effect.fail(ServerResponse.empty({ status: 400 }))
  return TrakId.make(raw)
})

/**
 * The turn in flight at this trak — the trak, its agent, and the names `run_check` takes
 * for it — or `undefined` where none is. Every listing and every call reads it, so what a
 * session is offered is decided by the agent taking the turn.
 */
const turnNow = (id: TrakId) =>
  Effect.gen(function* () {
    const turn = yield* (yield* TurnTools).current(id)
    if (turn === undefined) return undefined
    const trak = replayHistory(id, yield* (yield* Store).events(id))
    const lib = yield* Lib
    const agent = yield* turnAgent(lib, trak, turn.step)
    return { trak, agent, offered: offeredChecks(lib, trak, agent).map((c) => c.name) }
  })

/** The arguments, with `name` narrowed to what is offered where there is anything to offer. */
const argumentsFor = (offered: readonly string[]) =>
  Schema.Struct({
    name: offered.length === 0 ? Schema.String : Schema.Literal(...offered),
  })

/**
 * Each acting engine tool's arguments, offered to `generic` alone. The name is the tool's as
 * the agent calls it; its description is the template `trak/tool-<name>`, so the words live
 * where every other prompt does. A tool added here is one entry, one template and one move
 * in `ENGINE_MOVES`; a tool that only reads goes in `READ_TOOLS` instead, for every turn.
 */
const ENGINE_TOOLS = {
  open_goal: Schema.Struct({ asked: Schema.NonEmptyTrimmedString }),
} as const

type EngineTool = keyof typeof ENGINE_TOOLS

const isEngineTool = (name: string): name is EngineTool => Object.hasOwn(ENGINE_TOOLS, name)

const engineToolNames = (): readonly EngineTool[] => Object.keys(ENGINE_TOOLS).filter(isEngineTool)

/**
 * The process tools' arguments, offered at every turn: a session is handed the server
 * where the trak declares a process, and one handed it for a check can declare a process
 * mid-turn and start it. Each description is its template, as an engine tool's is.
 */
const ONE_PROCESS = Schema.Struct({ name: Schema.NonEmptyTrimmedString })

const PROCESS_TOOLS = {
  process_status: Schema.Struct({ name: Schema.optional(Schema.NonEmptyTrimmedString) }),
  start_process: ONE_PROCESS,
  restart_process: ONE_PROCESS,
  stop_process: ONE_PROCESS,
  process_logs: ONE_PROCESS,
} as const

type ProcessTool = keyof typeof PROCESS_TOOLS

const isProcessTool = (name: string): name is ProcessTool => Object.hasOwn(PROCESS_TOOLS, name)

const processToolNames = (): readonly ProcessTool[] =>
  Object.keys(PROCESS_TOOLS).filter(isProcessTool)

type ToolName = EngineTool | ProcessTool | ReadTool | typeof RUN_CHECK

const descriptionOf = (name: ToolName): TemplateName => `trak/tool-${name}`

/**
 * The tools a trak's session is offered now, decided by the turn in flight — none where
 * no turn is. What `orkestra trak-tools` lists over its route and the MCP route lists itself.
 */
export const trakToolList = (id: TrakId) =>
  Effect.gen(function* () {
    const now = yield* turnNow(id)
    const prompts = yield* Prompts
    const tool = (name: ToolName, schema: Schema.Schema.AnyNoContext) => ({
      name,
      description: render(prompts, descriptionOf(name), {}),
      inputSchema: inputSchemaOf(schema),
    })
    const checks: McpToolListDto["tools"] =
      now === undefined || now.offered.length === 0
        ? []
        : [tool(RUN_CHECK, argumentsFor(now.offered))]
    const engine: McpToolListDto["tools"] =
      now !== undefined && offersEngineTools(now.agent)
        ? engineToolNames().map((name) => tool(name, ENGINE_TOOLS[name]))
        : []
    const processes: McpToolListDto["tools"] =
      now === undefined ? [] : processToolNames().map((name) => tool(name, PROCESS_TOOLS[name]))
    const reads: McpToolListDto["tools"] =
      now === undefined ? [] : readToolNames().map((name) => tool(name, READ_TOOLS[name]))
    const list: McpToolListDto = { tools: [...checks, ...processes, ...reads, ...engine] }
    return list
  })

const listRoute = Router.get(
  "/api/traks/:id/tools",
  Effect.flatMap(pathTrak, (id) => Effect.flatMap(trakToolList(id), ServerResponse.json)),
)

const said = (name: string, call: CheckCall): Answer =>
  CheckCall.$match(call, {
    NoTurn: () => refused({ noTurn: true }),
    NotOffered: ({ offered }) =>
      refused(
        offered.length === 0
          ? { noneOffered: true }
          : { notOffered: offered.map((n) => `\`${n}\``).join(", ") },
      ),
    Reused: () => did({ reused: true, name }),
    Passed: ({ output, recorded }) =>
      did({ [recorded ? "passed" : "unrecorded"]: true, name, output: stripAnsi(output) }),
    // Not refused: the call did what it was asked, and the check is what said no.
    Failed: ({ output, exitCode }) =>
      did({
        failed: true,
        name,
        output: stripAnsi(output),
        ...(exitCode === undefined ? {} : { exitCode: String(exitCode) }),
      }),
    Ended: () => refused({ ended: true, name }),
  })

/**
 * A goal from the sentence, drafting its file at once, on the caller's run mode and naming
 * the caller. A call the CLI gave an id that already opened a goal answers with that goal.
 */
const openGoal = (caller: Trak, asked: string, call: string | undefined) =>
  Effect.gen(function* () {
    const already = call === undefined ? undefined : yield* goalOpenedBy(caller.id, call)
    if (already !== undefined) return did({ openedGoal: already.id, again: true })
    const first = GoalEvents.asked(
      asked,
      [caller.mode],
      {
        from: caller.id,
        // Random rather than timed, for the same reason as a check call's.
        call: call ?? `goal-${randomUUID()}`,
      },
      // The goal is the caller's owner's, as every trak it opens will be.
      caller.owner,
    )
    return did({ openedGoal: yield* startGoal("goal", first) })
  })

/** Each acting tool's move, by its name: a call's arguments decoded, then made. */
const ENGINE_MOVES = {
  open_goal: (caller: Trak, args: unknown, call: string | undefined) =>
    withArgs(ENGINE_TOOLS.open_goal, args, (a) => openGoal(caller, a.asked, call)),
} satisfies Record<EngineTool, unknown>

/** How many lines of a log a start that did not come up answers with, and `process_logs`. */
const FAILED_START_LINES = 20
const LOG_LINES = 200

const tail = (log: string, lines: number): string =>
  log.trimEnd().split("\n").slice(-lines).join("\n")

/** A preparing start's stage as `trak/tool-result` words it: one flag, and a copy's count. */
const stageRow = (stage: SpawnStage) => ({
  readying: stage._tag === "Readying",
  // Strings, so a count of 0 still renders: Mustache skips a section on `0`.
  copying:
    stage._tag === "Copying" ? { sent: String(stage.sent), total: String(stage.total) } : undefined,
  launching: stage._tag === "Launching",
})

/** One process as `trak/tool-result` words it: its name, and a flag for where it stands. */
const processRow = (run: HostedRun) => {
  const state = run.state
  return {
    name: run.name,
    notStarted: state._tag === "NotStarted",
    preparing: state._tag === "Preparing" ? stageRow(state.stage) : undefined,
    starting: state._tag === "Starting",
    url: state._tag === "Running" ? state.url : undefined,
    notUp: state._tag === "DidNotComeUp" ? state.reason : undefined,
    exited: state._tag === "Exited",
    // Strings, so a code of 0 still renders: Mustache skips a section on `0`.
    exitCode: state._tag === "Exited" && state.code !== undefined ? String(state.code) : undefined,
    exitSignal: state._tag === "Exited" ? state.signal : undefined,
    stopped: state._tag === "Stopped",
    stoppedByRestart: state._tag === "StoppedByRestart",
  }
}

/** What a name no declaration has is refused with, and why where a script exists. */
const unknownProcess = (e: UnknownProcess): Answer =>
  refused({
    unknownProcess: e.name,
    ...(e.reason === undefined ? {} : { unknownReason: e.reason }),
  })

/** Every declared process, or the one named, and every declaration left out and why. */
const processStatus = (trak: Trak, named: string | undefined) =>
  Effect.gen(function* () {
    const hosted = yield* HostedProcesses
    const { runs, unreadable } = yield* hosted.survey(trak.id, workdir(trak))
    if (named !== undefined) {
      const run = runs.find((r) => r.name === named)
      const broken = unreadable.find((u) => u.name === named)
      if (run === undefined)
        return unknownProcess(
          new UnknownProcess({
            name: named,
            ...(broken === undefined ? {} : { reason: `${broken.shown}: ${broken.reason}` }),
          }),
        )
      return did({ processes: [processRow(run)] })
    }
    if (runs.length === 0 && unreadable.length === 0) return did({ noProcesses: true })
    return did({ processes: runs.map(processRow), unreadable })
  })

/**
 * One start, restart or stop, answered once a start is decided. A start that did not
 * come up is the answer rather than a refusal, and carries the end of its log.
 */
const actOnProcess = (trak: Trak, verb: "start" | "restart" | "stop", name: string) =>
  Effect.gen(function* () {
    const hosted = yield* HostedProcesses
    const run =
      verb === "stop"
        ? hosted.stop(trak.id, name)
        : verb === "start"
          ? hosted.start(trak.id, workdir(trak), name)
          : hosted.restart(trak.id, workdir(trak), name)
    return yield* run.pipe(
      Effect.map((answered) => {
        const failed = verb !== "stop" && answered.state._tag !== "Running"
        const log = failed ? tail(answered.log, FAILED_START_LINES) : ""
        return did({ processes: [processRow(answered)], ...(log === "" ? {} : { log }) })
      }),
      Effect.catchTag("UnknownProcess", (e) => Effect.succeed(unknownProcess(e))),
    )
  })

/** The end of what the process's current run has printed. */
const processLogs = (trak: Trak, name: string) =>
  Effect.gen(function* () {
    const runs = yield* (yield* HostedProcesses).list(trak.id, workdir(trak))
    const run = runs.find((r) => r.name === name)
    if (run === undefined) return unknownProcess(new UnknownProcess({ name }))
    const log = tail(run.log, LOG_LINES)
    return did(
      log === "" ? { noLog: name } : { logOf: name, lines: String(LOG_LINES), printed: log },
    )
  })

const processCall = (caller: Trak, name: ProcessTool, args: unknown) => {
  switch (name) {
    case "process_status":
      return withArgs(PROCESS_TOOLS.process_status, args, (a) => processStatus(caller, a.name))
    case "start_process":
      return withArgs(ONE_PROCESS, args, (a) => actOnProcess(caller, "start", a.name))
    case "restart_process":
      return withArgs(ONE_PROCESS, args, (a) => actOnProcess(caller, "restart", a.name))
    case "stop_process":
      return withArgs(ONE_PROCESS, args, (a) => actOnProcess(caller, "stop", a.name))
    case "process_logs":
      return withArgs(ONE_PROCESS, args, (a) => processLogs(caller, a.name))
  }
}

/**
 * One call on a trak's tools, answered as `trak/tool-result` words it, or `undefined` for
 * a name that is no tool of the engine's. A check answers once it has run.
 */
export const trakToolCall = (id: TrakId, name: string, request: McpToolCallDto) =>
  Effect.gen(function* () {
    if (name !== RUN_CHECK && !isEngineTool(name) && !isProcessTool(name) && !isReadTool(name))
      return undefined
    const { hide, answer } = yield* hidingAnswers
    if (name === RUN_CHECK) {
      const args = Schema.decodeUnknownEither(argumentsFor([]))(request.arguments)
      if (args._tag === "Left") return answer(refused({ badArguments: "`name` names the check." }))
      // Random rather than timed: two calls with no id of the CLI's can land in one millisecond.
      const call = request.call ?? `check-${randomUUID()}`
      return answer(said(args.right.name, yield* runCheckForTurn(id, args.right.name, call)))
    }
    const now = yield* turnNow(id)
    if (now === undefined) return answer(refused({ noTurn: true }))
    if (isProcessTool(name)) return answer(yield* processCall(now.trak, name, request.arguments))
    if (isReadTool(name))
      return answer(
        yield* readCall({ kind: "trak", trak: now.trak }, name, request.arguments, hide),
      )
    if (!offersEngineTools(now.agent)) return answer(refused({ toolNotOffered: name }))
    return answer(yield* ENGINE_MOVES[name](now.trak, request.arguments, request.call))
  })

const callRoute = Router.post(
  "/api/traks/:id/tools/:name",
  Effect.gen(function* () {
    const id = yield* pathTrak
    const name = (yield* Router.params)["name"] ?? ""
    const request = yield* ServerRequest.schemaBodyJson(McpToolCallDto)
    const answered = yield* trakToolCall(id, name, request)
    return answered === undefined
      ? ServerResponse.empty({ status: 404 })
      : yield* ServerResponse.json(answered)
  }),
)

export const trakToolRoutes = Router.empty.pipe(listRoute, callRoute)
