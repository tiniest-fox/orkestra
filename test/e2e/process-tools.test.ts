// The process tools a step's turn is offered on its `orkestra-trak` server, called
// through the route its `orkestra trak-tools` server forwards to: status, start, restart,
// stop and logs, each answering in words the agent reads.
//
// The turn is held open with `onPromptAfter`, as `engine-tools.test.ts` holds it: a call
// belongs to the turn in flight. The processes are real, as `hosted-processes.test.ts`
// says why. Nothing here spends.

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { toWeb } from "@effect/platform/HttpServerResponse"
import { McpToolListDto, McpToolResultDto } from "@orkestra/shared/dto/goals"
import { Deferred, Effect, type Layer, Schedule, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { SpawnStage } from "../../src/agent/types/spawn-stage.js"
import type { HostedProcess } from "../../src/library/types/process.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import type { Environment } from "../../src/workflow/ports/environment.js"
import { HostedProcesses } from "../../src/workflow/ports/hosted-processes.js"
import { Store } from "../../src/workflow/ports/store.js"
import { TurnTools } from "../../src/workflow/ports/turn-tools.js"
import { composer, type FlowDeps, runFlowWithAgentLog } from "../support/flow.js"
import { mount } from "../support/http.js"
import { actionRoutes } from "../../src/app/routes/actions.js"
import { trakToolRoutes } from "../../src/app/trak-tools.js"
import { create, idle, READ_TOOL_NAMES, trakToolsServer } from "../support/scenario.js"
import { library } from "../support/library.js"
import { type AgentLog, onPromptAfter, reply } from "../support/scripted-agent.js"
import { environmentHeldAt } from "../support/scripted-environment.js"

const { get, post } = mount(actionRoutes, trakToolRoutes)

const SCRIPTS = mkdtempSync(join(tmpdir(), "orkestra-process-tools-"))

const declare = (name: string, body: string, readySeconds = 10): HostedProcess => {
  const path = join(SCRIPTS, `${name}.sh`)
  writeFileSync(path, `#!/bin/bash\n${body}\n`)
  chmodSync(path, 0o755)
  return { name, description: `the ${name} process`, page: true, readySeconds, needs: [], path }
}

const SERVE = `require("http").createServer((q, r) => r.end("hi")).listen(Number(process.env.PORT), "127.0.0.1")`

/** Serves until it is stopped. */
const dev = declare("dev", `echo "dev on $PORT"\nexec node -e '${SERVE}'`)

/** Never listens, and is given 0.3 s to. */
const silent = declare("silent", `echo "waiting for nothing"\nexec sleep 60`, 0.3)

const HELD = /artifact named `1-work`/

/** Hoisted: a callback inline in a flow body is one too many for the nesting limit. */
const heldTurn = (request: { readonly prompt: string }): boolean => HELD.test(request.prompt)

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
const tool = (id: TrakId, name: string, args: unknown) =>
  Effect.gen(function* () {
    const response = yield* post(id, `tools/${name}`, { call: "toolu_1", arguments: args })
    expect(response.status).toBe(200)
    return Schema.decodeUnknownSync(McpToolResultDto)(yield* jsonOf(response))
  })

/** Approve the plan and wait for the held turn to open. */
const intoTurn = (id: TrakId) =>
  Effect.gen(function* () {
    yield* create(id, "Add a --json flag")
    expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
    yield* (yield* TurnTools)
      .current(id)
      .pipe(Effect.repeat({ until: (t) => t !== undefined, schedule: Schedule.spaced("1 millis") }))
  }).pipe(Effect.timeout("20 seconds"), Effect.orDie)

type HeldBody = (
  id: TrakId,
  release: Deferred.Deferred<void>,
  agentLog: Effect.Effect<AgentLog>,
) => Effect.Effect<void, never, FlowDeps>

/** A flow whose `work` turn is held open until `release`, with these processes declared. */
const held = (
  processes: readonly HostedProcess[],
  body: HeldBody,
  environment?: Layer.Layer<Environment>,
) =>
  Effect.runPromise(Deferred.make<void>()).then((release) =>
    runFlowWithAgentLog(
      [composer("work"), onPromptAfter(HELD, Deferred.await(release), reply.artifact("v1"))],
      (id, agentLog) => Effect.andThen(intoTurn(id), body(id, release, agentLog)),
      library({ processes: new Map(processes.map((p) => [p.name, p])) }),
      undefined,
      undefined,
      undefined,
      environment,
    ),
  )

const finish = (id: TrakId, release: Deferred.Deferred<void>) =>
  Effect.andThen(Deferred.succeed(release, undefined), idle(id))

const listedAndHanded: HeldBody = (id, release, agentLog) =>
  Effect.gen(function* () {
    expect(yield* listed(id)).toEqual([
      "process_status",
      "start_process",
      "restart_process",
      "stop_process",
      "process_logs",
      ...READ_TOOL_NAMES,
    ])
    yield* finish(id, release)
    const turn = (yield* agentLog).requests.find(heldTurn)
    expect(turn?.mcpServers).toEqual({ "orkestra-trak": trakToolsServer(id) })
    expect(turn?.prompt).toContain("## Processes you can manage")
    expect(turn?.prompt).toContain("Never start one in the background")
  })

const startedAndStopped: HeldBody = (id, release) =>
  Effect.gen(function* () {
    const before = yield* tool(id, "process_status", {})
    expect(before.isError).toBe(false)
    expect(before.text).toContain("- `dev` — not started")
    expect(before.text).toContain("- `silent` — not started")

    const started = yield* tool(id, "start_process", { name: "dev" })
    expect(started.isError).toBe(false)
    expect(started.text).toMatch(/- `dev` — running at http:\/\/127\.0\.0\.1:2\d{4}\//)

    const one = yield* tool(id, "process_status", { name: "dev" })
    expect(one.text).toContain("- `dev` — running at")
    expect(one.text).not.toContain("`silent`")

    const logs = yield* tool(id, "process_logs", { name: "dev" })
    expect(logs.text).toContain("printed, at most:")
    expect(logs.text).toContain("dev on")

    const restarted = yield* tool(id, "restart_process", { name: "dev" })
    expect(restarted.text).toContain("- `dev` — running at")

    const stopped = yield* tool(id, "stop_process", { name: "dev" })
    expect(stopped.isError).toBe(false)
    expect(stopped.text).toContain("- `dev` — stopped")

    yield* finish(id, release)
    const after = yield* tool(id, "process_status", {})
    expect(after.isError).toBe(true)
    expect(after.text).toContain("no turn of this step is running")
  })

const refusedAndDown: HeldBody = (id, release) =>
  Effect.gen(function* () {
    const down = yield* tool(id, "start_process", { name: "silent" })
    expect(down.isError).toBe(false)
    expect(down.text).toContain("- `silent` — did not come up: Nothing answered on port")
    expect(down.text).toContain("The end of what it printed:")
    expect(down.text).toContain("waiting for nothing")

    const unknown = yield* tool(id, "start_process", { name: "nope" })
    expect(unknown.isError).toBe(true)
    expect(unknown.text).toContain("no process `nope` is declared here")

    const unnamed = yield* tool(id, "stop_process", {})
    expect(unnamed.isError).toBe(true)
    expect(unnamed.text).toContain("the arguments do not fit this tool")
    yield* (yield* HostedProcesses).stopAll(id)
    yield* finish(id, release)
  })

/** Where every start's environment capture waits, so the start stays preparing until it settles. */
const copied = Effect.runSync(Deferred.make<void>())

const reportedPreparing: HeldBody = (id, release) =>
  Effect.gen(function* () {
    const starting = yield* Effect.fork(tool(id, "start_process", { name: "dev" }))
    // Read until the start has installed its run: the fork may not have reached it yet.
    let status = yield* tool(id, "process_status", { name: "dev" })
    while (status.text.includes("not started")) {
      yield* Effect.sleep("10 millis")
      status = yield* tool(id, "process_status", { name: "dev" })
    }
    expect(status.text).toContain("- `dev` — starting: copying files into the sandbox, 0 of 7 sent")
    yield* Deferred.succeed(copied, undefined)
    expect((yield* starting.await.pipe(Effect.flatten)).text).toContain("- `dev` — running at")
    yield* (yield* HostedProcesses).stopAll(id)
    yield* finish(id, release)
  }).pipe(Effect.orDie)

const noneDeclared: HeldBody = (id, release, agentLog) =>
  Effect.gen(function* () {
    const none = yield* tool(id, "process_status", {})
    expect(none.text).toContain("No process is declared here.")
    yield* finish(id, release)
    const turn = (yield* agentLog).requests.find(heldTurn)
    // Handed the server all the same: the read tools are every turn's.
    expect(turn?.mcpServers).toEqual({ "orkestra-trak": trakToolsServer(id) })
  })

const brokenInCheckout: HeldBody = (id, release) =>
  Effect.gen(function* () {
    const checkout = replayHistory(id, yield* (yield* Store).events(id)).worktree?.path
    if (checkout === undefined) return yield* Effect.die("the turn has no checkout")
    mkdirSync(join(checkout, ".orkestra", "processes"), { recursive: true })
    writeFileSync(join(checkout, ".orkestra", "processes", "gallery.sh"), "exec serve\n")

    const status = yield* tool(id, "process_status", {})
    expect(status.isError).toBe(false)
    expect(status.text).toContain("- `dev` — not started")
    expect(status.text).toContain("Declared in this checkout and not used:")
    expect(status.text).toContain("- `processes/gallery.sh` — ")

    const refused = yield* tool(id, "start_process", { name: "gallery" })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain("no process `gallery` is declared here. processes/gallery.sh:")
    yield* finish(id, release)
  }).pipe(Effect.orDie)

describe("a step's process tools", () => {
  it("are listed, and the session handed the server, when the trak declares a process", async () => {
    await expect(held([dev], listedAndHanded)).resolves.toBeUndefined()
  })

  it("start, report, restart, read and stop a process, and only during a turn", async () => {
    await expect(held([dev, silent], startedAndStopped)).resolves.toBeUndefined()
  })

  it("say why a start failed, and refuse a name nothing declares", async () => {
    await expect(held([silent], refusedAndDown)).resolves.toBeUndefined()
  })

  it("report a start still preparing with its stage", async () => {
    await expect(
      held(
        [dev],
        reportedPreparing,
        environmentHeldAt(SpawnStage.Copying({ sent: 0, total: 7 }), copied),
      ),
    ).resolves.toBeUndefined()
  })

  it("say nothing is declared, and the server is still handed", async () => {
    await expect(held([], noneDeclared)).resolves.toBeUndefined()
  })

  it("report a declaration in the checkout they cannot use, and refuse to start it", async () => {
    await expect(held([dev], brokenInCheckout)).resolves.toBeUndefined()
  })
})
