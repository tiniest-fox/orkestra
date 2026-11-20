// The engine tools a turn is offered, called through the route its `orkestra trak-tools`
// server forwards to: the read tools, which every agent's turn is offered, and `open_goal`,
// which a `generic` turn alone is, and every other agent's is refused. Every answer is
// redacted of the secret values the engine holds, and reads only what `People.readable` allows.
//
// The turn is held open with `onPromptAfter`, as `check-tool.test.ts` holds it: a call
// belongs to the turn in flight, and the tools refuse one at any other time. A second
// trak, created first and parked at its plan, is what the reads find.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { toWeb } from "@effect/platform/HttpServerResponse"
import { CreatedDto } from "@orkestra/shared/dto/actions"
import { McpToolListDto, McpToolResultDto } from "@orkestra/shared/dto/goals"
import { Deferred, Effect, Schedule, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { NoteEntry } from "../../src/agent/types/transcript-entry.js"
import { startGoal } from "../../src/app/goals.js"
import { Events } from "../../src/workflow/domain/event.js"
import { GoalEvents, replayGoal, type Goal } from "../../src/workflow/domain/goal.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import { GoalId, TrakId, UserId } from "../../src/workflow/domain/trak.js"
import { Environment } from "../../src/workflow/ports/environment.js"
import { GoalStore } from "../../src/workflow/ports/goal-store.js"
import { MintedSecrets } from "../../src/workflow/ports/minted-secrets.js"
import { Store } from "../../src/workflow/ports/store.js"
import { type LiveTurn, TurnTools } from "../../src/workflow/ports/turn-tools.js"
import { MintedSecretsLayer } from "../../src/workflow/adapters/minted-secrets.js"
import { Lib } from "../../src/library/ports/library.js"
import { runners } from "../support/library.js"
import { composer, type FlowDeps, onGit } from "../support/flow.js"
import { seedLog } from "../support/seed.js"
import { mount } from "../support/http.js"
import { actionRoutes } from "../../src/app/routes/actions.js"
import { trakToolRoutes } from "../../src/app/trak-tools.js"
import { trakMcpRoutes } from "../../src/app/trak-mcp.js"
import { goalRoutes } from "../../src/app/goals.js"
import { create, idle, READ_TOOL_NAMES, trakToolsServer } from "../support/scenario.js"
import {
  type AgentLog,
  hangsOn,
  onPromptAfter,
  reply,
  type Turn,
} from "../support/scripted-agent.js"

const { call, get, post } = mount(actionRoutes, trakToolRoutes, trakMcpRoutes, goalRoutes)

const GENERIC = "generic"
const OTHER = TrakId.make("other-trak")
const ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/

const DRAFTING = /weigh what the sentence leaves open/

/** Listed at every turn in flight, beside whatever else the turn is offered. */
const PROCESS_TOOLS = [
  "process_status",
  "start_process",
  "restart_process",
  "stop_process",
  "process_logs",
]

/**
 * The other trak's plan, then this trak's plan with `agent` on it, whose turn answers
 * only once `release` is done, and a goal composer turn that waits on `drafted`.
 */
const turns = (
  agent: string,
  release: Deferred.Deferred<void>,
  drafted: Deferred.Deferred<void>,
  heldTurn?: Turn,
): readonly Turn[] => [
  composer("work"),
  ...(agent === GENERIC ? [] : [composer(agent)]),
  heldTurn ??
    onPromptAfter(
      new RegExp(`artifact named \`\\d+-${agent}\``),
      Deferred.await(release),
      reply.artifact("v1"),
      `held ${agent}`,
    ),
  onPromptAfter(DRAFTING, Deferred.await(drafted), "Drafted."),
]

/**
 * Park the other trak at its plan, then open this turn — a chat on `generic` through New
 * Chat's route, or a plan with `agent` on it approved — and wait for the turn to open.
 */
const intoTurn = (id: TrakId, agent: string) =>
  Effect.gen(function* () {
    yield* create(OTHER, "Index the logs")
    const turn = agent === GENERIC ? yield* startChat : id
    if (agent !== GENERIC) {
      yield* create(id, "Add a --json flag")
      expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
    }
    yield* (yield* TurnTools)
      .current(turn)
      .pipe(Effect.repeat({ until: (t) => t !== undefined, schedule: Schedule.spaced("1 millis") }))
    return turn
  }).pipe(Effect.timeout("20 seconds"), Effect.orDie)

const OWNER = UserId.make("gh:583231")

const startChat = Effect.gen(function* () {
  const response = yield* call(
    new Request("http://localhost/api/traks", {
      method: "POST",
      // Pressed by a host user, as the host's proxy names one.
      headers: { "content-type": "application/json", "x-orkestra-user": OWNER },
      body: JSON.stringify({ description: "Add a --json flag", agent: GENERIC }),
    }),
  )
  if (response.status !== 202) return yield* Effect.die(`New Chat answered ${response.status}`)
  return TrakId.make(Schema.decodeUnknownSync(CreatedDto)(yield* jsonOf(response)).id)
})

const jsonOf = (response: Parameters<typeof toWeb>[0]) =>
  Effect.promise(async (): Promise<unknown> => {
    const parsed: unknown = JSON.parse(await toWeb(response).text())
    return parsed
  })

const listed = (id: TrakId) =>
  Effect.map(Effect.flatMap(get(`/${id}/tools`), jsonOf), (body) =>
    Schema.decodeUnknownSync(McpToolListDto)(body).tools.map((t) => t.name),
  )

/** One call, as `orkestra trak-tools` forwards it, and what the agent reads back. */
const tool = (id: TrakId, name: string, args: unknown, callId = "toolu_1") =>
  Effect.gen(function* () {
    const response = yield* post(id, `tools/${name}`, { call: callId, arguments: args })
    expect(response.status).toBe(200)
    return Schema.decodeUnknownSync(McpToolResultDto)(yield* jsonOf(response))
  })

/** One exchange with the trak's MCP route: the status, and the body parsed where there is one. */
const mcp = (
  id: string,
  init: { readonly method?: string; readonly body?: unknown },
  owner: "traks" | "goals" = "traks",
) =>
  Effect.gen(function* () {
    const response = yield* call(
      new Request(`http://localhost/api/${owner}/${id}/mcp`, {
        method: init.method ?? "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    )
    const text = yield* Effect.promise(() => toWeb(response).text())
    const body: unknown = text === "" ? undefined : JSON.parse(text)
    return { status: response.status, body }
  })

const rpc = (id: number, method: string, params: unknown = {}) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
})

/** What `tools/list` on the MCP route answers. */
const mcpTools = (id: TrakId) =>
  Effect.map(
    mcp(id, { body: rpc(2, "tools/list") }),
    (answered) =>
      Schema.decodeUnknownSync(Schema.Struct({ result: McpToolListDto }))(answered.body).result
        .tools,
  )

/** Hoisted, as `atGate` is: one callback too many inline. */
const nameOf = (offered: { readonly name: string }): string => offered.name

const goals = Effect.flatMap(GoalStore, (store) =>
  Effect.flatMap(store.list(), (ids) =>
    Effect.forEach(ids, (g) => Effect.map(store.events(g), (log) => replayGoal(g, log))),
  ),
)

/** Hoisted: a callback inline in a flow body is one too many for the nesting limit. */
const atGate = (goal: Goal): boolean => goal.state._tag === "AtGate"

const goalNow = (id: GoalId) =>
  Effect.flatMap(GoalStore, (store) => Effect.map(store.events(id), (log) => replayGoal(id, log)))

/** Wait until the goal satisfies `enough` — a composer turn runs on the worker, not this fiber. */
const goalWhere = (id: GoalId, enough: (goal: Goal) => boolean) =>
  goalNow(id).pipe(
    Effect.repeat({
      until: (g) => g !== undefined && enough(g),
      schedule: Schedule.spaced("1 millis"),
    }),
    Effect.andThen(goalNow(id)),
    Effect.timeout("20 seconds"),
    Effect.orDie,
  )

const draftGoal = (goal: string) =>
  call(
    new Request(`http://localhost/api/goals/${goal}/tools/draft_goal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        call: "toolu_d",
        arguments: {
          name: "json-everywhere",
          title: "JSON everywhere",
          line: "Every command speaks JSON",
          finished: "Every command takes --json.",
        },
      }),
    }),
  )

const flow = (
  agent: string,
  body: (
    id: TrakId,
    release: Deferred.Deferred<void>,
    drafted: Deferred.Deferred<void>,
    log: Effect.Effect<AgentLog>,
  ) => Effect.Effect<void, never, FlowDeps>,
  heldTurn?: Turn,
) =>
  Effect.runPromise(
    Effect.flatMap(
      Effect.all([Deferred.make<void>(), Deferred.make<void>()]),
      ([release, drafted]) =>
        Effect.promise(() =>
          // On git, with the library rooted in the repository: the goal's drafted file is
          // checked against that checkout.
          onGit.runFlowWithAgentLog(
            turns(agent, release, drafted, heldTurn),
            (id, log, _checks, repoDir) =>
              body(id, release, drafted, log).pipe(
                Effect.provideServiceEffect(
                  Lib,
                  Effect.map(Lib, (held) => ({ ...held, root: repoDir })),
                ),
              ),
          ),
        ),
    ),
  )

const finish = (id: TrakId, release: Deferred.Deferred<void>) =>
  Effect.andThen(Deferred.succeed(release, undefined), idle(id))

/** The held turn's request, as the agent was handed it. */
const heldRequest = (log: Effect.Effect<AgentLog>, agent: string) =>
  Effect.map(log, (l) =>
    l.requests.find((r) => new RegExp(`artifact named \`\\d+-${agent}\``).test(r.prompt)),
  )

describe("a generic turn's engine tools", () => {
  it("lists the read tools and open_goal, and hands the session the server", async () => {
    await flow(GENERIC, (flowId, release, _drafted, log) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, GENERIC)
        expect(yield* listed(id)).toEqual([...PROCESS_TOOLS, ...READ_TOOL_NAMES, "open_goal"])
        yield* finish(id, release)
        expect((yield* heldRequest(log, "generic"))?.mcpServers).toEqual({
          "orkestra-trak": trakToolsServer(id),
        })
      }).pipe(Effect.orDie),
    )
  })

  it("lists the other live traks with where each stands, names one's documents, and reads one", async () => {
    await flow(GENERIC, (flowId, release) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, GENERIC)
        const list = yield* tool(id, "list_traks", {})
        expect(list.isError).toBe(false)
        expect(list.text).toContain("`other-trak` — Add a --json flag")
        expect(list.text).toContain("state: AwaitingProposal")
        expect(list.text).not.toContain(`\`${id}\``)

        const read = yield* tool(id, "read_trak", { trak: OTHER })
        expect(read.isError).toBe(false)
        expect(read.text).toContain("Trak `other-trak`")
        expect(read.text).toContain("- `trak.md`")
        expect(read.text).not.toContain("Index the logs")

        for (const name of ["trak.md", "trak"]) {
          const artifact = yield* tool(id, "read_artifact", { trak: OTHER, name })
          expect(artifact.isError).toBe(false)
          expect(artifact.text).toContain("`trak.md` of trak `other-trak`:")
          expect(artifact.text).toContain("Index the logs")
        }
        const unknown = yield* tool(id, "read_artifact", { trak: OTHER, name: "9-nothing.md" })
        expect(unknown.isError).toBe(true)
        expect(unknown.text).toContain(
          "trak `other-trak` has filed no document `9-nothing.md`. `read_trak` lists the ones it has.",
        )
        const nowhere = yield* tool(id, "read_artifact", { trak: "nowhere", name: "trak.md" })
        expect(nowhere.isError).toBe(true)
        expect(nowhere.text).toContain("there is no trak `nowhere`")

        yield* putAway("old-parser", "Retire the old parser")
        const archived = yield* tool(id, "read_trak", { trak: "old-parser" })
        expect(archived.text).toContain("Trak `old-parser` — Retire the old parser")
        expect(archived.text).toContain("- `trak.md`")
        const archivedDoc = yield* tool(id, "read_artifact", {
          trak: "old-parser",
          name: "trak.md",
        })
        expect(archivedDoc.isError).toBe(false)
        expect(archivedDoc.text).toContain("Retire the old parser")

        const missing = yield* tool(id, "read_trak", { trak: "nowhere" })
        expect(missing.isError).toBe(true)
        expect(missing.text).toContain("there is no trak `nowhere`")
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })

  it("opens a goal that drafts its file and waits at the file gate, naming this trak", async () => {
    await flow(GENERIC, (flowId, release, drafted) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, GENERIC)
        const opened = yield* tool(id, "open_goal", { asked: "JSON on every command" })
        expect(opened.isError).toBe(false)
        const [goal] = yield* goals
        if (goal === undefined) return yield* Effect.die("open_goal started no goal")
        expect(opened.text).toContain(`Opened goal \`${goal.id}\``)
        expect(goal.openedBy).toEqual({ from: id, call: "toolu_1" })
        expect(goal.askedModes).toEqual(["manual"])
        // The chat is the user's who pressed New Chat, and so is the goal it opened.
        expect(replayHistory(id, yield* (yield* Store).events(id)).owner).toBe(OWNER)
        expect(goal.owner).toBe(OWNER)

        expect((yield* draftGoal(goal.id)).status).toBe(200)
        yield* Deferred.succeed(drafted, undefined)
        const parked = yield* goalWhere(goal.id, atGate)
        expect(parked?.state).toMatchObject({ _tag: "AtGate", gate: "file" })

        // A retry of the same call finds the goal rather than opening a second.
        const again = yield* tool(id, "open_goal", { asked: "JSON on every command" })
        expect(again.text).toContain(`already opened goal \`${goal.id}\``)
        expect(yield* goals).toHaveLength(1)
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })
})

describe("the same tools over the trak's MCP route", () => {
  it("initialize, list every tool with an object schema, call one, and refuse an unknown name", async () => {
    await flow(GENERIC, (flowId, release) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, GENERIC)
        const opened = yield* mcp(id, {
          body: rpc(1, "initialize", { protocolVersion: "2025-06-18" }),
        })
        expect(opened).toMatchObject({
          status: 200,
          body: {
            id: 1,
            result: { protocolVersion: "2025-06-18", serverInfo: { name: "orkestra-trak" } },
          },
        })
        const notified = yield* mcp(id, {
          body: { jsonrpc: "2.0", method: "notifications/initialized" },
        })
        expect(notified.status).toBe(202)

        const tools = yield* mcpTools(id)
        expect(tools.map(nameOf)).toEqual([...PROCESS_TOOLS, ...READ_TOOL_NAMES, "open_goal"])
        // Claude Code drops every tool of a server where one schema lacks this.
        for (const t of tools) expect(t.inputSchema).toMatchObject({ type: "object" })

        const called = yield* mcp(id, {
          body: rpc(3, "tools/call", {
            name: "list_traks",
            arguments: {},
            _meta: { "claudecode/toolUseId": "toolu_9" },
          }),
        })
        expect(called).toMatchObject({ status: 200, body: { id: 3, result: { isError: false } } })
        expect(JSON.stringify(called.body)).toContain("other-trak")

        const unknown = yield* mcp(id, {
          body: rpc(4, "tools/call", { name: "nowhere", arguments: {} }),
        })
        expect(unknown.body).toMatchObject({ id: 4, error: { code: -32602 } })
        // No stream of the server's own is offered.
        expect((yield* mcp(id, { method: "GET" })).status).toBe(405)
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })

  it("answers the shim's listing with the same object schemas", async () => {
    await flow(GENERIC, (flowId, release) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, GENERIC)
        const body = yield* Effect.flatMap(get(`/${id}/tools`), jsonOf)
        for (const t of Schema.decodeUnknownSync(McpToolListDto)(body).tools)
          expect(t.inputSchema).toMatchObject({ type: "object" })
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })
})

describe("another agent's turn", () => {
  it("is listed the read tools and not open_goal, which it is refused, and is handed the server", async () => {
    await flow("work", (flowId, release, _drafted, log) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, "work")
        expect(yield* listed(id)).toEqual([...PROCESS_TOOLS, ...READ_TOOL_NAMES])
        const refused = yield* tool(id, "open_goal", { asked: "JSON on every command" })
        expect(refused.isError).toBe(true)
        expect(refused.text).toContain("`open_goal` is not one of the tools offered")
        expect(yield* goals).toEqual([])
        const list = yield* tool(id, "list_traks", {})
        expect(list.isError).toBe(false)
        expect(list.text).toContain("`other-trak`")
        yield* finish(id, release)
        expect((yield* heldRequest(log, "work"))?.mcpServers).toEqual({
          "orkestra-trak": trakToolsServer(id),
        })
      }).pipe(Effect.orDie),
    )
  })
})

/** The live list, read until `enough` holds — an event lands on the turn's own fiber. */
const liveList = Effect.flatMap(TurnTools, (t) => t.lives)

const livesWhere = (enough: (lives: readonly LiveTurn[]) => boolean) =>
  liveList.pipe(
    Effect.repeat({ until: enough, schedule: Schedule.spaced("1 millis") }),
    Effect.andThen(liveList),
    Effect.timeout("20 seconds"),
    Effect.orDie,
  )

const ofTrak =
  (id: TrakId) =>
  (t: LiveTurn): boolean =>
    t.owner.kind === "trak" && t.owner.id === id

const heardAt = (lives: readonly LiveTurn[], id: TrakId): number | undefined =>
  lives.find(ofTrak(id))?.lastEventAt

// Hoisted, as `atGate` is: one callback too many inline.
const isGoalTurn = (t: LiveTurn): boolean => t.owner.kind === "goal"
const goalIsLive = (all: readonly LiveTurn[]): boolean => all.some(isGoalTurn)
const heardFrom =
  (id: TrakId, after: number) =>
  (all: readonly LiveTurn[]): boolean =>
    (heardAt(all, id) ?? -1) > after
const turnEnded = (goal: Goal): boolean => goal.session !== undefined

const iso = (at: number | undefined): string => new Date(at ?? 0).toISOString()

describe("turn_status", () => {
  it("lists a sandboxed step turn whose last event moves, and a goal's composer turn", async () => {
    const paces = await Effect.runPromise(
      Effect.all([Deferred.make<void>(), Deferred.make<void>()]),
    )
    const held: Turn = {
      ...hangsOn(/artifact named `\d+-work`/, "held work"),
      paces: paces.map((p) => Deferred.await(p)),
      execId: "exec-7",
    }
    await flow(
      "work",
      (flowId, _release, drafted) =>
        Effect.gen(function* () {
          const id = yield* intoTurn(flowId, "work")
          const goal = yield* startGoal("goal", GoalEvents.asked("JSON everywhere", ["manual"]))
          yield* livesWhere(goalIsLive)

          const first = yield* tool(id, "turn_status", {})
          expect(first.isError).toBe(false)
          expect(first.text).toContain(`- trak \`${id}\`, \`1-work\``)
          expect(first.text).toContain(
            `runs in sandbox \`${id}\`, exec \`exec-7\`, runner pid 4242`,
          )
          expect(first.text).toContain("last provider event none yet")
          expect(first.text).toContain(`- goal \`${goal}\`, its composer`)
          expect(first.text).toContain("runs nowhere yet: no CLI has started")
          expect(first.text).toMatch(new RegExp(`started ${ISO.source}`))

          const [one, two] = paces
          yield* Deferred.succeed(one, undefined)
          const once = heardAt(yield* livesWhere(heardFrom(id, -1)), id)
          expect((yield* tool(id, "turn_status", {})).text).toContain(
            `last provider event ${iso(once)}`,
          )
          yield* Effect.sleep("5 millis")
          yield* Deferred.succeed(two, undefined)
          const twice = heardAt(yield* livesWhere(heardFrom(id, once ?? 0)), id)
          expect((yield* tool(id, "turn_status", {})).text).toContain(
            `last provider event ${iso(twice)}`,
          )
          yield* Deferred.succeed(drafted, undefined)
        }).pipe(Effect.orDie),
      held,
    )
  })
})

/** The engine's environment, as the host leaves it, around one call. */
const SECRETS = {
  named: "deploy-token-0123456789",
  claude: "scripted-cli-token-abcdef",
  runner: "boat-runner-key-987654",
}

/** A named secret JSON escapes, so a rendered entry carries only its escaped form. */
const QUOTED = 'quoteX"dpass\\word\n9999'

/** The pieces of a secret long enough to be told apart, each to be gone from an answer. */
const piecesOf = (secret: string): readonly string[] =>
  secret.split(/["\\\n-]/u).filter((piece) => piece.length >= 4)

const withSecrets = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provideServiceEffect(
      Environment,
      Effect.map(Environment, (env) => ({
        ...env,
        // The names a host sets from its secrets.
        secretNames: Effect.succeed(["DEPLOY_TOKEN", "QUOTED_TOKEN"]),
        engine: Effect.succeed({
          DEPLOY_TOKEN: SECRETS.named,
          QUOTED_TOKEN: QUOTED,
          SCRIPTED_TOKEN: SECRETS.claude,
          BOAT_KEY: SECRETS.runner,
        }),
      })),
    ),
    Effect.provide(
      runners({
        runner: {
          description: "boat",
          secret: "BOAT_KEY",
          pass: [],
          idleMinutes: undefined,
          settings: {},
          path: "/runner.sh",
        },
      }),
    ),
  )

describe("the read tools on a trak and a goal", () => {
  it("read a trak's and a goal's newest events and transcript, with times", async () => {
    await flow(GENERIC, (flowId, release, drafted) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, GENERIC)
        const opened = yield* tool(id, "open_goal", { asked: "JSON on every command" })
        expect(opened.isError).toBe(false)
        const [goal] = yield* goals
        if (goal === undefined) return yield* Effect.die("open_goal started no goal")

        const events = yield* tool(id, "read_events", { trak: OTHER, newest: 2 })
        expect(events.text).toContain("The newest 2 entries of trak `other-trak`'s event log")
        expect(events.text).toMatch(new RegExp(`- ${ISO.source} \\{"_tag":"`))
        expect(events.text.match(/^- /gmu)).toHaveLength(2)

        const transcript = yield* tool(id, "read_transcript", { trak: OTHER })
        expect(transcript.isError).toBe(false)
        expect(transcript.text).toContain("trak `other-trak`'s transcript")
        expect(transcript.text).toContain('"position":"composer"')

        const listedGoals = yield* tool(id, "list_goals", {})
        expect(listedGoals.text).toContain(`- \`${goal.id}\` — JSON on every command`)
        expect(listedGoals.text).toContain("state: Composing; a composer turn is running")

        const read = yield* tool(id, "read_goal", { goal: goal.id, newest: 1 })
        expect(read.isError).toBe(false)
        expect(read.text).toContain(`Goal \`${goal.id}\` — JSON on every command`)
        expect(read.text).toMatch(new RegExp(`- ${ISO.source} \\{"_tag":"GoalAsked"`))

        const goalEvents = yield* tool(id, "read_events", { goal: goal.id })
        expect(goalEvents.text).toContain(`goal \`${goal.id}\`'s event log`)

        yield* Deferred.succeed(drafted, undefined)
        yield* goalWhere(goal.id, turnEnded)
        const goalTranscript = yield* tool(id, "read_transcript", { goal: goal.id })
        expect(goalTranscript.isError).toBe(false)

        for (const args of [{}, { trak: OTHER, goal: goal.id }]) {
          const both = yield* tool(id, "read_events", args)
          expect(both.isError).toBe(true)
          expect(both.text).toContain("name exactly one of `trak` and `goal`")
        }
        const missing = yield* tool(id, "read_goal", { goal: "nowhere" })
        expect(missing.text).toContain("there is no goal `nowhere`")
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })

  it("read the engine's warnings about one trak, newest last", async () => {
    await flow(GENERIC, (flowId, release) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, GENERIC)
        yield* Effect.logWarning(`sandbox for ${OTHER} did not answer`)
        yield* Effect.logWarning("something about nothing in particular")
        const about = yield* tool(id, "engine_log", { about: OTHER })
        expect(about.text).toMatch(
          new RegExp(`- ${ISO.source} WARN sandbox for other-trak did not answer`),
        )
        expect(about.text).not.toContain("nothing in particular")
        const all = yield* tool(id, "engine_log", { newest: 1 })
        expect(all.text).toContain("nothing in particular")
        expect(all.text).not.toContain("did not answer")
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })

  it("redact each secret the engine holds from an answer, and say so; say nothing where none is", async () => {
    await flow(GENERIC, (flowId, release) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, GENERIC)
        const leak = `token ${SECRETS.named}, ${SECRETS.claude} and ${SECRETS.runner}`
        yield* (yield* Store).appendTranscript(OTHER, NoteEntry.make({ text: leak }))
        const read = yield* withSecrets(tool(id, "read_transcript", { trak: OTHER, newest: 1 }))
        expect(read.text).toContain("token [redacted], [redacted] and [redacted]")
        for (const value of Object.values(SECRETS)) expect(read.text).not.toContain(value)
        expect(read.text).toContain(
          "3 secret value(s) the engine holds appeared in this answer, each replaced with `[redacted]`.",
        )
        // Escaped in the entry's JSON, so only its escaped form is in the answer.
        yield* (yield* Store).appendTranscript(OTHER, NoteEntry.make({ text: `using ${QUOTED}` }))
        const escaped = yield* withSecrets(tool(id, "read_transcript", { trak: OTHER, newest: 1 }))
        expect(escaped.text).toContain('"text":"using [redacted]"')
        for (const piece of piecesOf(QUOTED)) expect(escaped.text).not.toContain(piece)
        expect(escaped.text).toContain("1 secret value(s) the engine holds appeared")

        // Across the cut at 2000 characters: `{"_tag":"Note","text":"` is 22 of them, so the
        // secret runs from 1982 to 2005, and a cut before redaction would keep its first 18.
        const long = `${"x".repeat(1960)}${SECRETS.named} and after`
        yield* (yield* Store).appendTranscript(OTHER, NoteEntry.make({ text: long }))
        const cut = yield* withSecrets(tool(id, "read_transcript", { trak: OTHER, newest: 1 }))
        expect(cut.text).toContain("[redacted] and af … (cut)")
        for (const piece of piecesOf(SECRETS.named)) expect(cut.text).not.toContain(piece)
        expect(cut.text).toContain("1 secret value(s) the engine holds appeared")

        const clean = yield* withSecrets(tool(id, "list_traks", {}))
        expect(clean.text).not.toContain("redacted")
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })
})

describe("snapshot_logs", () => {
  it("writes the traks it may read into this trak's checkout, redacted, and says so", async () => {
    await flow("work", (flowId, release) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, "work")
        const store = yield* Store
        yield* store.appendTranscript(OTHER, NoteEntry.make({ text: `token ${SECRETS.named}` }))
        const answer = yield* withSecrets(tool(id, "snapshot_logs", { transcripts: true }))
        expect(answer.isError).toBe(false)
        const at = /Wrote a snapshot of 2 trak\(s\) and 0 goal\(s\) to `([^`]+)` in this checkout/u
        expect(answer.text).toMatch(at)
        expect(answer.text).toContain("1 secret value(s) the engine holds appeared")
        const checkout = replayHistory(id, yield* store.events(id)).worktree?.path
        const dir = join(checkout ?? "/nowhere", at.exec(answer.text)?.[1] ?? "")
        const transcript = readFileSync(join(dir, "traks", OTHER, "transcript.jsonl"), "utf8")
        expect(transcript).toContain("token [redacted]")
        expect(transcript).not.toContain(SECRETS.named)
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })
})

/** Write a trak that was opened and abandoned, so the archive holds it under `title`. */
const putAway = (id: string, title: string, owner?: UserId) =>
  Effect.flatMap(Store, (store) =>
    seedLog(store, TrakId.make(id), [
      Events.trakCreated(title, undefined, "manual", false, owner),
      Events.abandoned("not wanted"),
    ]),
  )

/** The rows of a list answer, one per `- ` line. */
const rowsOf = (text: string): readonly string[] =>
  text.split("\n").filter((line) => line.startsWith("- `"))

describe("list_traks and archived traks", () => {
  it("lists archived traks only with `archived: true`, matched by title or id, and leaves the live ones out", async () => {
    await flow(GENERIC, (flowId, release) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, GENERIC)
        yield* putAway("old-parser", "Retire the old parser")
        yield* putAway("old-lexer", "Retire the old lexer")

        const live = yield* tool(id, "list_traks", {})
        expect(rowsOf(live.text)).toEqual(["- `other-trak` — Add a --json flag"])

        const all = yield* tool(id, "list_traks", { archived: true })
        expect(all.isError).toBe(false)
        expect(rowsOf(all.text)).toEqual([
          "- `old-lexer` — Retire the old lexer",
          "- `old-parser` — Retire the old parser",
        ])
        expect(all.text).not.toContain("Only the first")

        const byTitle = yield* tool(id, "list_traks", { archived: true, matching: "PARSER" })
        expect(rowsOf(byTitle.text)).toEqual(["- `old-parser` — Retire the old parser"])
        const byId = yield* tool(id, "list_traks", { archived: true, matching: "old-LEX" })
        expect(rowsOf(byId.text)).toEqual(["- `old-lexer` — Retire the old lexer"])
        const none = yield* tool(id, "list_traks", { archived: true, matching: "frobnicate" })
        expect(none.text).toContain("No archived trak you may read matches.")

        const alone = yield* tool(id, "list_traks", { matching: "parser" })
        expect(alone.isError).toBe(true)
        expect(alone.text).toContain("pass it with `archived: true`")
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })

  it("says the cap cut the list when more archived traks match than it holds", async () => {
    await flow(GENERIC, (flowId, release) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, GENERIC)
        for (let n = 10; n < 61; n += 1) yield* putAway(`bulk-${n}`, `Bulk ${n}`)
        yield* putAway("lone", "Lone one")

        const cut = yield* tool(id, "list_traks", { archived: true, matching: "bulk" })
        expect(rowsOf(cut.text)).toHaveLength(50)
        expect(cut.text).toContain("- `bulk-10` — Bulk 10")
        expect(cut.text).not.toContain("bulk-60")
        expect(cut.text).toContain("Only the first 50 by title are listed.")
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })
})

describe("the read tools and a token minted for a spawn", () => {
  it("redact a token minted for a spawn, which no environment holds", async () => {
    await flow(GENERIC, (flowId, release) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, GENERIC)
        const minted = "ghs_minted0123456789abcdef"
        yield* (yield* Store).appendTranscript(
          OTHER,
          NoteEntry.make({ text: `gh auth token printed ${minted}` }),
        )
        const before = yield* tool(id, "read_transcript", { trak: OTHER, newest: 1 })
        expect(before.text).toContain(minted)
        yield* (yield* MintedSecrets).record(minted)
        const read = yield* tool(id, "read_transcript", { trak: OTHER, newest: 1 })
        expect(read.text).toContain("gh auth token printed [redacted]")
        expect(read.text).not.toContain(minted)
        expect(read.text).toContain("1 secret value(s) the engine holds appeared")
        yield* finish(id, release)
      }).pipe(Effect.provide(MintedSecretsLayer), Effect.orDie),
    )
  })
})

/** One call on a goal's tools, as `orkestra goal-tools` forwards it: the status, and the answer where it is one. */
const goalTool = (goal: GoalId, name: string, args: unknown) =>
  Effect.gen(function* () {
    const response = yield* call(
      new Request(`http://localhost/api/goals/${goal}/tools/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ call: "toolu_g", arguments: args }),
      }),
    )
    if (response.status !== 200) return { status: response.status, text: "", isError: true }
    const answer = Schema.decodeUnknownSync(McpToolResultDto)(yield* jsonOf(response))
    return { status: response.status, ...answer }
  })

const goalToolList = (goal: GoalId) =>
  Effect.map(
    Effect.flatMap(call(new Request(`http://localhost/api/goals/${goal}/tools`)), jsonOf),
    (body) => Schema.decodeUnknownSync(McpToolListDto)(body).tools,
  )

/** The goal this trak's turn opens, its composer turn running. */
const openedGoal = (id: TrakId) =>
  Effect.gen(function* () {
    yield* tool(id, "open_goal", { asked: "JSON on every command" })
    const [goal] = yield* goals
    if (goal === undefined) return yield* Effect.die("open_goal started no goal")
    yield* livesWhere(goalIsLive)
    return goal.id
  })

const GOAL_READS = READ_TOOL_NAMES.filter((name) => name !== "snapshot_logs")

/** Hoisted: a callback inline in a flow body is one too many for the nesting limit. */
const isRead = (name: string): boolean => READ_TOOL_NAMES.includes(name)

describe("a goal's composer and the read tools", () => {
  it("is listed every read tool but snapshot_logs, and reads a trak's documents while composing and after", async () => {
    await flow(GENERIC, (flowId, release, drafted) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, GENERIC)
        const goal = yield* openedGoal(id)

        const offered = yield* goalToolList(goal)
        const names = offered.map(nameOf)
        expect(names.filter(isRead)).toEqual(GOAL_READS)
        expect(names).not.toContain("snapshot_logs")
        expect(names).toContain("draft_goal")
        for (const listedTool of offered)
          expect(listedTool.inputSchema).toMatchObject({ type: "object" })

        const traks = yield* goalTool(goal, "list_traks", {})
        expect(rowsOf(traks.text)).toEqual(
          expect.arrayContaining(["- `other-trak` — Add a --json flag"]),
        )
        // The same tools over the endpoint a composer in the project's sandbox dials.
        const overHttp = yield* mcp(goal, { body: rpc(3, "tools/list") }, "goals")
        const overMcp = Schema.decodeUnknownSync(Schema.Struct({ result: McpToolListDto }))(
          overHttp.body,
        ).result.tools
        expect(overMcp.map(nameOf)).toEqual(names)
        const viaMcp = yield* mcp(
          goal,
          { body: rpc(4, "tools/call", { name: "list_traks", arguments: {} }) },
          "goals",
        )
        expect(JSON.stringify(viaMcp.body)).toContain("other-trak")
        expect(traks.text).toContain(`\`${id}\``)
        const read = yield* goalTool(goal, "read_trak", { trak: OTHER })
        expect(read.isError).toBe(false)
        expect(read.text).toContain("- `trak.md`")
        const ownGoal = yield* goalTool(goal, "read_goal", { goal })
        expect(ownGoal.text).toContain(`Goal \`${goal}\``)
        expect((yield* goalTool(goal, "snapshot_logs", {})).status).toBe(404)

        yield* Deferred.succeed(drafted, undefined)
        const rested = yield* goalWhere(goal, turnEnded)
        expect(rested?.state._tag).not.toBe("Composing")
        const after = yield* goalTool(goal, "read_artifact", { trak: OTHER, name: "trak.md" })
        expect(after.isError).toBe(false)
        expect(after.text).toContain("Index the logs")

        const missing = yield* goalTool(GoalId.make("no-such-goal"), "list_traks", {})
        expect(missing.isError).toBe(true)
        expect(missing.text).toContain("there is no goal `no-such-goal`")
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })

  it("redacts a token minted for a spawn from a goal's read answer", async () => {
    await flow(GENERIC, (flowId, release, drafted) =>
      Effect.gen(function* () {
        const id = yield* intoTurn(flowId, GENERIC)
        const goal = yield* openedGoal(id)
        const minted = "ghs_minted0123456789abcdef"
        yield* (yield* Store).appendTranscript(
          OTHER,
          NoteEntry.make({ text: `gh auth token printed ${minted}` }),
        )
        yield* (yield* MintedSecrets).record(minted)
        const read = yield* goalTool(goal, "read_transcript", { trak: OTHER, newest: 1 })
        expect(read.text).toContain("gh auth token printed [redacted]")
        expect(read.text).not.toContain(minted)
        expect(read.text).toContain("1 secret value(s) the engine holds appeared")
        yield* Deferred.succeed(drafted, undefined)
        yield* finish(id, release)
      }).pipe(Effect.provide(MintedSecretsLayer), Effect.orDie),
    )
  })
})
