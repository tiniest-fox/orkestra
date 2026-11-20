// Hosted processes, end to end: a project's dev server started in a trak's checkout by
// a press or by a step whose agent lists it, told to the turn, and gone before the
// checkout is.
//
// The processes are real — a few lines of `node` serving on the port they are handed —
// because what is worth knowing is that one came up where the engine said it would and
// died when it should, and a fake process cannot show either. Nothing here spends.

import { spawn } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Effect, Option, Schedule, Schema, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { HostedProcessDto, HostedProcessListDto } from "@orkestra/shared/dto/trak"
import { toWeb } from "@effect/platform/HttpServerResponse"
import type { HostedProcess } from "../../src/library/types/process.js"
import type { Library } from "../../src/library/types/library.js"
import { NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import { Process } from "../../src/agent/ports/process.js"
import { Events } from "../../src/workflow/domain/event.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { Feed, type Frame } from "../../src/workflow/ports/feed.js"
import { HostedProcesses, type HostedRun } from "../../src/workflow/ports/hosted-processes.js"
import { advance } from "../../src/workflow/runtime.js"
import { composer, type FlowBody, runFlowWithAgentLog, step } from "../support/flow.js"
import {
  act,
  createAndStart,
  expectAwaiting,
  expectState,
  human,
  logTags,
} from "../support/scenario.js"
import { library } from "../support/library.js"
import { heldBack, pass } from "../support/scripted-checks.js"
import { reply } from "../support/scripted-agent.js"
import { mount } from "../support/http.js"
import { processRoutes } from "../../src/app/routes/processes.js"

const { call } = mount(processRoutes)

const SCRIPTS = mkdtempSync(join(tmpdir(), "orkestra-processes-"))

/** A declaration over a script written here, with the header fields a test cares about. */
const declare = (name: string, body: string, readySeconds = 10): HostedProcess => {
  const path = join(SCRIPTS, `${name}.sh`)
  writeFileSync(path, `#!/bin/bash\n${body}\n`)
  chmodSync(path, 0o755)
  return { name, description: `the ${name} process`, page: true, readySeconds, needs: [], path }
}

const SERVE = `require("http").createServer((q, r) => r.end("hi")).listen(Number(process.env.PORT), "127.0.0.1")`

/** Serves until it is stopped. */
const dev = declare("dev", `echo "dev on $PORT"\nexec node -e '${SERVE}'`)

/** Serves, then ends on its own with code 3, saying so on stderr. */
const quits = declare(
  "quits",
  `exec node -e '${SERVE}; setTimeout(() => { console.error("bye from quits"); process.exit(3) }, 1500)'`,
)

/** Never listens, and is given 0.3 s to. */
const silent = declare("silent", `echo "waiting for nothing"\nexec sleep 60`, 0.3)

const PROCESSES = new Map([dev, quits, silent].map((p) => [p.name, p]))

/** The fixture fleet with these declared, and `work` listing the ones named. */
const hosting = (listed: readonly string[], over: Partial<Library> = {}): Library => {
  const lib = library({ processes: PROCESSES, ...over })
  const work = lib.agents.get("work")
  if (work === undefined) throw new Error("the fixture fleet lost its `work` agent")
  return { ...lib, agents: new Map(lib.agents).set("work", { ...work, processes: listed }) }
}

const turns = [composer("work"), step(1, "work", reply.artifact("done"))]

const runOf = (id: TrakId, name: string) =>
  Effect.flatMap(HostedProcesses, (hosted) =>
    Effect.map(hosted.list(id, ""), (runs) => runs.find((r) => r.name === name)),
  )

/**
 * Wait until the process is where `done` says, the way `logged` waits on a log — and
 * read again after, since `repeat` with a schedule answers the schedule's count.
 */
const until = (id: TrakId, name: string, done: (run: HostedRun | undefined) => boolean) =>
  runOf(id, name).pipe(
    Effect.repeat({ until: done, schedule: Schedule.spaced("50 millis") }),
    Effect.timeout("15 seconds"),
    Effect.orDie,
    Effect.andThen(runOf(id, name)),
  )

/** Whether anything answers at the URL — a refused connection is `false`. */
const answers = (url: string) =>
  Effect.promise(() =>
    fetch(url).then(
      (r) => r.ok,
      () => false,
    ),
  )

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const press = (id: TrakId, name: string, verb: string) =>
  call(
    new Request(`http://localhost/api/traks/${id}/processes/${name}/${verb}`, { method: "POST" }),
  )

const bodyOf = <A, I>(schema: Schema.Schema<A, I>, response: Parameters<typeof toWeb>[0]) =>
  Effect.promise(async () => Schema.decodeUnknownSync(schema)(await toWeb(response).json()))

const urlOf = (run: HostedRun | undefined): string =>
  run?.state._tag === "Running" ? run.state.url : "not running"

/** The frames a watcher sees for one trak's processes, as one line each. */
const frameLine = (id: TrakId, frame: Frame): Option.Option<string> => {
  if (frame._tag === "Process" && frame.id === id) return Option.some(frame.process.state._tag)
  if (frame._tag === "ProcessOutput" && frame.id === id)
    return Option.some(`output ${String(frame.seq)}: ${frame.chunk.trim()}`)
  return Option.none()
}

/** Press start with the feed already subscribed, and what the first `count` frames said. */
const pressWatching = (id: TrakId, name: string, count: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const replay = yield* (yield* Feed).since(0)
      const response = yield* press(id, name, "start")
      const seen = yield* replay.frames.pipe(
        Stream.filterMap(({ frame }) => frameLine(id, frame)),
        Stream.take(count),
        Stream.runCollect,
      )
      return { response, seen: [...seen] }
    }),
  )

const textOf = (response: Parameters<typeof toWeb>[0]) =>
  Effect.promise(() => toWeb(response).text())

const startTimeOf = (pid: number) =>
  Effect.provide(
    Effect.flatMap(Process, (p) => p.startTime(pid)),
    NodeProcessLayer,
  )

const recordIn = (repoDir: string): string =>
  join(repoDir, ".orkestra", ".database", "processes.json")

const listedAndUp: FlowBody = (id, agentLog) =>
  Effect.gen(function* () {
    const parked = yield* createAndStart(id, "Add a --json flag")
    expectAwaiting(parked, "approval")
    const running = yield* runOf(id, "dev")
    expect(running?.state._tag).toBe("Running")
    expect(urlOf(running)).toMatch(/^http:\/\/127\.0\.0\.1:2\d{4}\/$/)
    expect(running?.log).toContain("dev on")

    const turn = (yield* agentLog).requests[1]
    expect(turn?.env["HOSTED_DEV_URL"]).toBe(urlOf(running))
    expect(turn?.prompt).toContain(`Running at ${urlOf(running)}`)
    expect(yield* answers(urlOf(running))).toBe(true)

    // A restart is a new run, and moves nothing on the trak. In the trak's checkout, as a
    // press restarts it: anywhere else it would run in this test's own working directory.
    const before = yield* logTags(id)
    const restarted = yield* Effect.orDie(
      (yield* HostedProcesses).restart(id, parked.worktree?.path ?? "", "dev"),
    )
    expect(restarted.state._tag).toBe("Running")
    expect(restarted.run).toBeGreaterThan(running?.run ?? 0)
    expect(yield* logTags(id)).toEqual(before)

    yield* (yield* HostedProcesses).stopAll(id)
  })

const listedAndDown: FlowBody = (id, agentLog) =>
  Effect.gen(function* () {
    expectAwaiting(yield* createAndStart(id, "Add a --json flag"), "approval")
    const failed = yield* runOf(id, "silent")
    expect(failed?.state._tag).toBe("DidNotComeUp")
    expect(failed?.state._tag === "DidNotComeUp" ? failed.state.reason : "").toContain(
      "Nothing answered on port",
    )
    expect(failed?.log).toContain("waiting for nothing")
    const turn = (yield* agentLog).requests[1]
    expect(turn?.prompt).toContain("**Not running:** it did not come up.")
    expect(turn?.env["HOSTED_SILENT_URL"]).toBeUndefined()
  })

describe("a step whose agent lists a process", () => {
  it("runs with the process up, told its URL in the prompt and the environment", async () => {
    await expect(runFlowWithAgentLog(turns, listedAndUp, hosting(["dev"]))).resolves.toBeUndefined()
  })

  it("still runs when the process does not come up, and is told it is down", async () => {
    await expect(
      runFlowWithAgentLog(turns, listedAndDown, hosting(["silent"])),
    ).resolves.toBeUndefined()
  })
})

/**
 * Archive with `dev` up, asking at the moment `teardown.sh` runs whether it still
 * answers — the only way to tell *before* the script from *after* it.
 */
const archiving = () => {
  const answeredDuringTeardown: boolean[] = []
  let url = ""
  const body: FlowBody = (id, _agentLog, _checks, repoDir) =>
    Effect.gen(function* () {
      yield* createAndStart(id, "Add a --json flag")
      url = urlOf(yield* runOf(id, "dev"))
      expect(yield* answers(url)).toBe(true)
      expectState(yield* act(id, 1, human.approve()), "Finished")

      expectState(yield* advance(id, Events.closed()), "Closed")
      expect(answeredDuringTeardown).toEqual([false])
      expect((yield* runOf(id, "dev"))?.state._tag).toBe("Stopped")
      expect(JSON.parse(readFileSync(recordIn(repoDir), "utf8"))).toEqual([])
    })
  const asked = Effect.flatMap(
    Effect.suspend(() => answers(url)),
    (up) =>
      Effect.sync(() => {
        answeredDuringTeardown.push(up)
      }),
  )
  return { body, teardown: [heldBack(asked, pass)] }
}

const TEARDOWN = {
  name: "teardown",
  description: "Drops the worktree's database.",
  timeoutSeconds: 60,
  askedEverySeconds: undefined,
  exclusive: false,
  cache: true,
  ignoresLinguistGenerated: false,
  units: undefined,
  cacheAcross: "platform" as const,
  path: "/nowhere/teardown.sh",
}

describe("archiving a trak", () => {
  it("stops every process before teardown.sh runs, and leaves no pid recorded", async () => {
    const { body, teardown } = archiving()
    await expect(
      runFlowWithAgentLog(turns, body, hosting(["dev"], { teardown: TEARDOWN }), { teardown }),
    ).resolves.toBeUndefined()
  })
})

const pressedUp: FlowBody = (id) =>
  Effect.gen(function* () {
    yield* createAndStart(id, "Add a --json flag")
    // Subscribed before the press, so what a watcher sees is every frame it made: the
    // preparation, the start, the line the process printed coming up, then up.
    const { response, seen } = yield* pressWatching(id, "dev", 4)
    expect(response.status).toBe(200)
    const started = yield* bodyOf(HostedProcessDto, response)
    expect(started).toMatchObject({ name: "dev", page: true, state: { _tag: "Running" } })
    expect(seen).toEqual([
      "Preparing",
      "Starting",
      expect.stringMatching(/^output 1: dev on \d+$/),
      "Running",
    ])

    const listed = yield* bodyOf(
      HostedProcessListDto,
      yield* call(new Request(`http://localhost/api/traks/${id}/processes`)),
    )
    expect(listed.processes.map(({ name, state }) => [name, state._tag])).toEqual([
      ["dev", "Running"],
      ["quits", "NotStarted"],
      ["silent", "NotStarted"],
    ])
    const logs = yield* call(new Request(`http://localhost/api/traks/${id}/processes/dev/logs`))
    expect(yield* textOf(logs)).toContain("dev on")

    const stopped = yield* bodyOf(HostedProcessDto, yield* press(id, "dev", "stop"))
    expect(stopped.state._tag).toBe("Stopped")
    expect(yield* answers(started.state._tag === "Running" ? started.state.url : "")).toBe(false)
  })

const refused: FlowBody = (id) =>
  Effect.gen(function* () {
    yield* createAndStart(id, "Add a --json flag")
    const before = yield* logTags(id)
    expect((yield* press(id, "nope", "start")).status).toBe(404)
    expect((yield* press(id, "nope", "stop")).status).toBe(404)
    expect((yield* press(TrakId.make("no-such-trak"), "dev", "start")).status).toBe(404)
    expect(yield* logTags(id)).toEqual(before)
  })

/**
 * The project checkout's routes, short of a start: one would spawn in the checkout this
 * test runs from, which is the person's. `process-registry.test.ts` runs the project's
 * processes against a directory of its own.
 */
const pressOnProject = (path: string) =>
  call(new Request(`http://localhost/api/processes/${path}`, { method: "POST" }))

const onTheProject: FlowBody = (id) =>
  Effect.gen(function* () {
    yield* createAndStart(id, "Add a --json flag")
    const before = yield* logTags(id)
    const listed = yield* bodyOf(
      HostedProcessListDto,
      yield* call(new Request("http://localhost/api/processes")),
    )
    expect(listed.processes.map(({ name, state }) => [name, state._tag])).toEqual([
      ["dev", "NotStarted"],
      ["quits", "NotStarted"],
      ["silent", "NotStarted"],
    ])
    expect((yield* pressOnProject("nope/start")).status).toBe(404)
    expect((yield* pressOnProject("nope/restart")).status).toBe(404)
    expect((yield* pressOnProject("nope/stop")).status).toBe(404)
    // Stopping one that is not running answers it as it stands, and starts nothing.
    const stopped = yield* bodyOf(HostedProcessDto, yield* pressOnProject("dev/stop"))
    expect(stopped.state._tag).toBe("NotStarted")
    const logs = yield* call(new Request("http://localhost/api/processes/nope/logs"))
    expect(logs.status).toBe(404)
    // The trak's own list is not the project's.
    expect((yield* runOf(id, "dev"))?.state._tag).toBe("NotStarted")
    expect(yield* logTags(id)).toEqual(before)
  })

describe("the process routes", () => {
  it("start one on a press, answer once it is up, and publish it as frames", async () => {
    await expect(runFlowWithAgentLog(turns, pressedUp, hosting([]))).resolves.toBeUndefined()
  })

  it("refuse a name no script declares, and a trak that does not exist", async () => {
    await expect(runFlowWithAgentLog(turns, refused, hosting([]))).resolves.toBeUndefined()
  })

  it("list the project checkout's processes and refuse a name no script declares", async () => {
    await expect(runFlowWithAgentLog(turns, onTheProject, hosting([]))).resolves.toBeUndefined()
  })
})

const endsOnItsOwn: FlowBody = (id) =>
  Effect.gen(function* () {
    const parked = yield* createAndStart(id, "Add a --json flag")
    const before = yield* logTags(id)
    const started = yield* bodyOf(HostedProcessDto, yield* press(id, "quits", "start"))
    expect(started.state._tag).toBe("Running")

    const ended = yield* until(id, "quits", (run) => run?.state._tag === "Exited")
    expect(ended?.state).toMatchObject({ _tag: "Exited", code: 3 })
    expect(ended?.log).toContain("bye from quits")
    expect(yield* logTags(id)).toEqual(before)
    expectAwaiting(parked, "approval")
  })

describe("a process that ends on its own", () => {
  it("shows its exit code and the end of its log, and the trak does not move", async () => {
    await expect(runFlowWithAgentLog(turns, endsOnItsOwn, hosting([]))).resolves.toBeUndefined()
  })
})

const reaped: FlowBody = (id, _agentLog, _checks, repoDir) =>
  Effect.gen(function* () {
    yield* createAndStart(id, "Add a --json flag")
    // What a SIGKILLed engine leaves: a detached group nobody holds, and the record.
    const survivor = spawn("sleep", ["60"], { cwd: SCRIPTS, detached: true, stdio: "ignore" })
    const pid = survivor.pid ?? 0
    survivor.unref()
    const start = yield* startTimeOf(pid)
    mkdirSync(dirname(recordIn(repoDir)), { recursive: true })
    writeFileSync(recordIn(repoDir), JSON.stringify([{ trak: id, name: "dev", pid, start }]))

    const found = yield* (yield* HostedProcesses).reap
    expect(found).toEqual([{ trak: id, name: "dev", pid, outcome: "killed" }])
    // The survivor is this worker's own child, so after the kill it is a zombie that
    // `kill(pid, 0)` still answers until Node reaps it — which, under a loaded full run,
    // lands after this line. Wait for the reap rather than racing it.
    yield* Effect.sync(() => alive(pid)).pipe(
      Effect.repeat({ until: (up) => !up, schedule: Schedule.spaced("20 millis") }),
      Effect.timeout("5 seconds"),
      Effect.orDie,
    )
    expect(alive(pid)).toBe(false)
    expect((yield* runOf(id, "dev"))?.state._tag).toBe("StoppedByRestart")
  })

describe("the boot reap", () => {
  it("kills a recorded process still running from before, and shows it stopped by the restart", async () => {
    await expect(runFlowWithAgentLog(turns, reaped, hosting([]))).resolves.toBeUndefined()
  })
})
