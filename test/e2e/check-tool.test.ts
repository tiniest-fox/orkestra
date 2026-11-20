// The engine's check tool, end to end: an agent mid-turn calls `run_check` through the
// route its `orkestra trak-tools` server forwards to, and the pass it records is the pass
// `RunChecks` finds once the turn files.
//
// The turn is held open with `onPromptAfter`, so a call lands while it is genuinely in
// flight — the tool refuses any other time. What the check *does* is scripted, as in
// `checks.test.ts`; the script is on disk only because its text is part of the pass key.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { toWeb } from "@effect/platform/HttpServerResponse"
import { McpToolListDto, McpToolResultDto } from "@orkestra/shared/dto/goals"
import { Deferred, Effect, Fiber, Schedule, Schema } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import type { Check } from "../../src/library/types/check.js"
import { Lib } from "../../src/library/ports/library.js"
import type { Library } from "../../src/library/types/library.js"
import type { Event } from "../../src/workflow/domain/event.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import { Checks } from "../../src/workflow/ports/checks.js"
import { Passes } from "../../src/workflow/ports/passes.js"
import { Store } from "../../src/workflow/ports/store.js"
import { TurnTools } from "../../src/workflow/ports/turn-tools.js"
import { Vcs } from "../../src/vcs/ports/vcs.js"
import { composer, type FlowDeps, runFlowWithAgentLog } from "../support/flow.js"
import { mount } from "../support/http.js"
import { actionRoutes } from "../../src/app/routes/actions.js"
import { stopRoutes } from "../../src/app/routes/stop.js"
import { trakToolRoutes } from "../../src/app/trak-tools.js"
import { trakMcpRoutes } from "../../src/app/trak-mcp.js"
import { create, idle, READ_TOOL_NAMES, trakToolsServer } from "../support/scenario.js"
import { workDeclaring, workEffecting } from "../support/library.js"
import { type CheckScript, hangs, heldBack, pass, proving } from "../support/scripted-checks.js"
import { type AgentLog, onPromptAfter, reply } from "../support/scripted-agent.js"

const { call: through, get, post } = mount(actionRoutes, stopRoutes, trakToolRoutes, trakMcpRoutes)

const scripts = mkdtempSync(join(tmpdir(), "orkestra-check-tool-"))
afterAll(() => {
  rmSync(scripts, { recursive: true, force: true })
})

/** A check on disk, so a pass of it has a key. */
const checkOnDisk = (name: string, cache: boolean, units?: string): Check => {
  const path = join(mkdtempSync(join(scripts, `${name}-`)), `${name}.sh`)
  writeFileSync(path, `pnpm ${name}\n`)
  return {
    name,
    description: `Runs ${name}.`,
    timeoutSeconds: 60,
    askedEverySeconds: undefined,
    exclusive: false,
    cache,
    ignoresLinguistGenerated: false,
    units,
    cacheAcross: "platform" as const,
    path,
  }
}

/** `work` declares `verify`, which keeps a pass, and `lint`, which does not. */
const fleet = (verifyCaches = true, units?: string) =>
  workDeclaring(["verify", "lint"], {
    checks: new Map([
      ["verify", checkOnDisk("verify", verifyCaches, units)],
      ["lint", checkOnDisk("lint", false)],
    ]),
  })

/**
 * `work` declares no check and runs `publish` as an effect. The project keeps a pass
 * for `verify` and `publish`, and none for `lint`.
 */
const undeclared = () =>
  workEffecting(["publish"], {
    checks: new Map([
      ["verify", checkOnDisk("verify", true)],
      ["lint", checkOnDisk("lint", false)],
      ["publish", checkOnDisk("publish", true)],
    ]),
  })

const WORK = /artifact named `1-work`/

/** The plan, then a `work` turn that answers only once `release` is done. */
const heldTurn = (release: Deferred.Deferred<void>) => [
  composer("work"),
  onPromptAfter(WORK, Deferred.await(release), reply.artifact("v1"), "held work"),
]

/** Approve the plan, and wait until the `work` turn is open to its tools. */
const intoTurn = (id: TrakId) =>
  Effect.gen(function* () {
    yield* create(id, "Add a --json flag")
    expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
    const tools = yield* TurnTools
    yield* tools
      .current(id)
      .pipe(Effect.repeat({ until: (t) => t !== undefined, schedule: Schedule.spaced("1 millis") }))
  }).pipe(Effect.timeout("20 seconds"), Effect.orDie)

const jsonOf = (response: Parameters<typeof toWeb>[0]) =>
  Effect.promise(async (): Promise<unknown> => {
    const parsed: unknown = JSON.parse(await toWeb(response).text())
    return parsed
  })

/** One call, as `orkestra trak-tools` forwards it, and what the agent reads back. */
const runCheck = (id: TrakId, name: string, call = "toolu_1") =>
  Effect.gen(function* () {
    const response = yield* post(id, "tools/run_check", { call, arguments: { name } })
    expect(response.status).toBe(200)
    return Schema.decodeUnknownSync(McpToolResultDto)(yield* jsonOf(response))
  })

/**
 * `run_check` over the trak's MCP route, as a sandboxed CLI calls it — or, `resent`, as the
 * sandbox's relay resends a call an engine restart cut — and the result's text and flag.
 */
const mcpRunCheck = (id: TrakId, name: string, resent = false) =>
  Effect.gen(function* () {
    const response = yield* through(
      new Request(`http://localhost/api/traks/${id}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(resent ? { "orkestra-resent": "1" } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "run_check", arguments: { name } },
        }),
      }),
    )
    const body = Schema.decodeUnknownSync(
      Schema.Struct({
        result: Schema.Struct({
          content: Schema.Tuple(Schema.Struct({ text: Schema.String })),
          isError: Schema.Boolean,
        }),
      }),
    )(yield* jsonOf(response))
    return { text: body.result.content[0].text, isError: body.result.isError }
  })

const finish = (id: TrakId, release: Deferred.Deferred<void>) =>
  Effect.andThen(Deferred.succeed(release, undefined), idle(id))

const eventsOf = (id: TrakId) => Effect.flatMap(Store, (s) => s.events(id))
const isChecksPassed = (e: Event): boolean => e._tag === "ChecksPassed"
const lastPass = (id: TrakId) => Effect.map(eventsOf(id), (log) => log.findLast(isChecksPassed))

/** The `Check` lines the tool wrote, as `[call, outcome]`. */
const checkLines = (id: TrakId) =>
  Effect.map(
    Effect.flatMap(Store, (s) => s.transcript(id)),
    (entries) => entries.flatMap((e) => (e._tag === "Check" ? [[e.call, e.outcome]] : [])),
  )

const worktreeOf = (id: TrakId) =>
  Effect.map(eventsOf(id), (log) => replayHistory(id, log).worktree?.path ?? "")

type Ran = Effect.Effect<{ readonly ran: readonly string[] }>

/** Wait until the scripted runner has been asked for `n` runs. */
const ranTimes = (checks: Ran, n: number) =>
  checks.pipe(
    Effect.repeat({ until: (c) => c.ran.length >= n, schedule: Schedule.spaced("1 millis") }),
    Effect.timeout("20 seconds"),
    Effect.orDie,
  )

/** A flow over the held turn: the body gets the release, the runner's log and the agent's. */
const flow = (
  body: (
    id: TrakId,
    release: Deferred.Deferred<void>,
    checks: Ran,
    agent: Effect.Effect<AgentLog>,
  ) => Effect.Effect<void, never, FlowDeps>,
  script: CheckScript = { verify: [pass] },
  lib: Library = fleet(),
) =>
  Effect.runPromise(
    Effect.flatMap(Deferred.make<void>(), (release) =>
      Effect.promise(() =>
        runFlowWithAgentLog(
          heldTurn(release),
          (id, agent, checks) => body(id, release, checks, agent),
          lib,
          script,
        ),
      ),
    ),
  )

/** Hoisted: a callback inline in a flow body is one too many for the nesting limit. */
const nameOf = (tool: { readonly name: string }): string => tool.name

/** The `work` turn's request, as the agent was handed it. */
const workRequest = (agent: Effect.Effect<AgentLog>) =>
  Effect.map(agent, (log) => log.requests.find((r) => WORK.test(r.prompt)))

describe("a check the agent runs through the tool", () => {
  it("is recorded, and the engine reuses it after the turn instead of running it again", async () => {
    await flow((id, release, checks) =>
      Effect.gen(function* () {
        yield* intoTurn(id)
        const answer = yield* runCheck(id, "verify")
        expect(answer.isError).toBe(false)
        expect(answer.text).toContain("`verify` passed, and the pass is kept")

        yield* finish(id, release)
        expect((yield* checks).ran).toEqual(["verify", "lint"])
        expect(yield* lastPass(id)).toMatchObject({ ran: ["lint"], reused: ["verify"] })
        expect(yield* checkLines(id)).toEqual([
          ["toolu_1", undefined],
          ["toolu_1", "passed"],
        ])
      }).pipe(Effect.orDie),
    )
  })

  it("answers from the store without running anything once a pass is kept", async () => {
    await flow((id, release, checks) =>
      Effect.gen(function* () {
        yield* intoTurn(id)
        yield* runCheck(id, "verify", "toolu_1")
        const again = yield* runCheck(id, "verify", "toolu_2")
        expect(again.text).toContain("already passed on these files")
        expect((yield* checks).ran).toEqual(["verify"])
        expect((yield* checkLines(id)).at(-1)).toEqual(["toolu_2", "reused"])
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })

  it("is not kept when the files change while it runs, and the engine runs it after the turn", async () => {
    const ran = await Effect.runPromise(Deferred.make<void>())
    await flow(
      (id, release, checks) =>
        Effect.gen(function* () {
          yield* intoTurn(id)
          const calling = yield* Effect.fork(runCheck(id, "verify"))
          yield* ranTimes(checks, 1)
          writeFileSync(join(yield* worktreeOf(id), "fresh.ts"), "export const a = 1\n")
          yield* Deferred.succeed(ran, undefined)
          const answer = yield* Fiber.join(calling)
          expect(answer.text).toContain("files changed while it ran, so the pass is not kept")
          expect((yield* checkLines(id)).at(-1)).toEqual(["toolu_1", "unrecorded"])

          yield* finish(id, release)
          expect((yield* checks).ran).toEqual(["verify", "verify", "lint"])
          expect(yield* lastPass(id)).toMatchObject({ ran: ["verify", "lint"] })
        }).pipe(Effect.orDie),
      { verify: [heldBack(Deferred.await(ran), pass), pass] },
    )
  })

  it("is interrupted when the turn is stopped, and nothing is kept", async () => {
    await flow(
      (id, _release, checks) =>
        Effect.gen(function* () {
          yield* intoTurn(id)
          const calling = yield* Effect.fork(runCheck(id, "verify"))
          yield* ranTimes(checks, 1)

          expect((yield* post(id, "stop", {})).status).toBe(202)
          yield* idle(id)
          const answer = yield* Fiber.join(calling)
          expect(answer.isError).toBe(true)
          expect(answer.text).toContain("was stopped when the turn ended")
          expect((yield* (yield* Checks).live(id))?.finished?.verdict).toBe("cancelled")
          expect((yield* checkLines(id)).at(-1)).toEqual(["toolu_1", "ended"])
          expect(yield* lastPass(id)).toBeUndefined()
        }).pipe(Effect.orDie),
      { verify: [hangs] },
    )
  })
})

describe("what the tool offers", () => {
  it("hands the session the server, with no `run_check`, where no check keeps a pass", async () => {
    await flow(
      (id, release, _checks, agent) =>
        Effect.gen(function* () {
          yield* intoTurn(id)
          yield* finish(id, release)
          const work = yield* workRequest(agent)
          expect(work?.mcpServers).toEqual({ "orkestra-trak": trakToolsServer(id) })
          expect(work?.prompt).toContain("Before you finish, run only what your change touches.")
        }).pipe(Effect.orDie),
      {},
      fleet(false),
    )
  })

  it("lists `run_check` with the offered names, and hands the session its server", async () => {
    await flow((id, release, _checks, agent) =>
      Effect.gen(function* () {
        yield* intoTurn(id)
        const listed = Schema.decodeUnknownSync(McpToolListDto)(
          yield* jsonOf(yield* get(`/${id}/tools`)),
        )
        // The process tools come with the server, whether or not this trak declares one.
        expect(listed.tools.map(nameOf)).toEqual([
          "run_check",
          "process_status",
          "start_process",
          "restart_process",
          "stop_process",
          "process_logs",
          ...READ_TOOL_NAMES,
        ])
        expect(JSON.stringify(listed.tools[0]?.inputSchema)).toContain('"enum":["verify"]')
        yield* finish(id, release)
        const work = yield* workRequest(agent)
        expect(work?.mcpServers).toEqual({ "orkestra-trak": trakToolsServer(id) })
        expect(work?.prompt).toContain("with the `run_check` tool")
        expect(work?.prompt).toContain("The tool takes `verify` — every check")
      }).pipe(Effect.orDie),
    )
  })

  it("is offered to a step that declares no check, which is told nothing runs after it", async () => {
    await flow(
      (id, release, checks, agent) =>
        Effect.gen(function* () {
          yield* intoTurn(id)
          const listed = Schema.decodeUnknownSync(McpToolListDto)(
            yield* jsonOf(yield* get(`/${id}/tools`)),
          )
          // `lint` keeps no pass, and `publish` is an effect: neither is a call a turn may make.
          expect(JSON.stringify(listed.tools[0]?.inputSchema)).toContain('"enum":["verify"]')
          expect((yield* runCheck(id, "publish", "toolu_1")).text).toContain("It runs `verify`.")
          const answer = yield* runCheck(id, "verify", "toolu_2")
          expect(answer.text).toContain("`verify` passed, and the pass is kept")

          yield* finish(id, release)
          expect((yield* checks).ran).toEqual(["verify"])
          const work = yield* workRequest(agent)
          expect(work?.mcpServers).toEqual({ "orkestra-trak": trakToolsServer(id) })
          expect(work?.prompt).toContain("No check runs on your artifact once you finish.")
          expect(work?.prompt).toContain("takes `verify` — every check")
          expect(work?.prompt).not.toContain("Checks that will run on your artifact")
        }).pipe(Effect.orDie),
      { verify: [pass] },
      undeclared(),
    )
  })
  it("refuses a check it does not run, naming the ones it does, and runs nothing", async () => {
    await flow((id, release, checks) =>
      Effect.gen(function* () {
        yield* intoTurn(id)
        const answer = yield* runCheck(id, "lint")
        expect(answer.isError).toBe(true)
        expect(answer.text).toContain("It runs `verify`.")
        expect((yield* checks).ran).toEqual([])
        expect(yield* checkLines(id)).toEqual([])
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })

  it("refuses a call with no turn in flight", async () => {
    await flow((id) =>
      Effect.gen(function* () {
        yield* create(id, "Add a --json flag")
        const answer = yield* runCheck(id, "verify")
        expect(answer.isError).toBe(true)
        expect(answer.text).toContain("no turn of this step is running")
      }).pipe(Effect.orDie),
    )
  })
})

describe("a check call over the MCP route around an engine restart", () => {
  it("answers a call resent after an engine restart as lost, runs nothing, and runs the next call", async () => {
    await flow((id, release, checks) =>
      Effect.gen(function* () {
        yield* intoTurn(id)
        const lost = yield* mcpRunCheck(id, "verify", true)
        expect(lost.isError).toBe(true)
        expect(lost.text).toContain("Calling `run_check` again is safe")
        expect((yield* checks).ran).toEqual([])
        const again = yield* mcpRunCheck(id, "verify")
        expect(again).toMatchObject({ isError: false })
        expect(again.text).toContain("`verify` passed, and the pass is kept")
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })

  // A held call the relay carries to an engine that is still rejoining the turn.
  it("waits over the MCP route for the turn to open, rather than refusing the call", async () => {
    await flow((id, release) =>
      Effect.gen(function* () {
        yield* create(id, "Add a --json flag")
        const early = yield* Effect.fork(mcpRunCheck(id, "verify"))
        expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
        const answer = yield* Fiber.join(early)
        expect(answer.text).toContain("`verify` passed, and the pass is kept")
        yield* finish(id, release)
      }).pipe(Effect.orDie),
    )
  })
})

/** The tree the trak's checkout holds now. */
const treeNow = (id: TrakId) =>
  Effect.gen(function* () {
    const trak = replayHistory(id, yield* eventsOf(id))
    return yield* (yield* Vcs).workingTree(trak.worktree, false)
  })

/** The units kept for `verify` on `tree`, or on the checkout as it is now. */
const provenNow = (id: TrakId, on?: string) =>
  Effect.gen(function* () {
    const verify = (yield* Lib).checks.get("verify")
    if (verify === undefined) return []
    const tree = on ?? (yield* treeNow(id))
    const passes = yield* Passes
    const key = yield* passes.unitKeyOf(verify, tree)
    return key === undefined ? [] : yield* passes.proven(key)
  })

describe("units a check run through the tool proved", () => {
  it("are kept when the turn's end interrupts it, on the tree they were proven on", async () => {
    await flow(
      (id, _release, checks) =>
        Effect.gen(function* () {
          yield* intoTurn(id)
          const calling = yield* Effect.fork(runCheck(id, "verify"))
          yield* ranTimes(checks, 1)

          expect((yield* post(id, "stop", {})).status).toBe(202)
          yield* idle(id)
          yield* Fiber.join(calling)
          expect(yield* lastPass(id)).toBeUndefined()
          expect(yield* provenNow(id)).toEqual(["a.test.ts"])
        }).pipe(Effect.orDie),
      { verify: [proving(["a.test.ts"], hangs)] },
      fleet(true, "tests"),
    )
  })

  it("are not kept when the files change while it runs", async () => {
    const ran = await Effect.runPromise(Deferred.make<void>())
    await flow(
      (id, release, checks) =>
        Effect.gen(function* () {
          yield* intoTurn(id)
          const calling = yield* Effect.fork(runCheck(id, "verify"))
          yield* ranTimes(checks, 1)
          const before = yield* treeNow(id)
          writeFileSync(join(yield* worktreeOf(id), "fresh.ts"), "export const a = 1\n")
          yield* Deferred.succeed(ran, undefined)
          yield* Fiber.join(calling)
          expect(yield* provenNow(id, before)).toEqual([])
          yield* finish(id, release)
        }).pipe(Effect.orDie),
      { verify: [proving(["a.test.ts"], heldBack(Deferred.await(ran), pass)), pass] },
      fleet(true, "tests"),
    )
  })
})
