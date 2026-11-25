// Reloading the project's files under a running engine: what the next request, the next
// step and a running process see once `POST /api/reload` has swapped the pair.
//
// The route cases read a real `.orkestra/` off a temp directory through the layer that
// ships, because what is worth knowing is that a file written after boot is the one the
// next answer carries. The other two hold the pair in a fake, so a swap can land at an
// exact moment — inside a turn, or under a process that is up.

import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Layer, Schedule, Schema } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import { AgentDto } from "@orkestra/shared/dto/fleet"
import { ReloadFailedDto } from "@orkestra/shared/dto/reload"
import { EngineFrameDto } from "@orkestra/shared/dto/stream"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import { toWeb } from "@effect/platform/HttpServerResponse"
import type { HostedProcess } from "../../src/library/types/process.js"
import { Lib } from "../../src/library/ports/library.js"
import type { Library } from "../../src/library/types/library.js"
import { NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import { ProjectFilesLayer } from "../../src/app/project-files.js"
import { TEMPLATES } from "../../src/app/packaged.js"
import type { Templates } from "../../src/prompts/index.js"
import { Prompts } from "../../src/prompts/ports/prompts.js"
import { ShellHostedProcessesLayer } from "../../src/workflow/adapters/processes-shell.js"
import { PubSubFeedLayer } from "../../src/workflow/adapters/feed-pubsub.js"
import { HostedProcesses, type HostedRun } from "../../src/workflow/ports/hosted-processes.js"
import {
  ProjectFiles,
  type ProjectFilesRead,
  type ProjectFilesShape,
} from "../../src/workflow/ports/project-files.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import { composer, runFlow, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import { act, create, expectAwaiting, human, logTags } from "../support/scenario.js"
import { library } from "../support/library.js"
import { inheritedEnvironment } from "../support/scripted-environment.js"
import { reply } from "../support/scripted-agent.js"
import { mount } from "../support/http.js"
import { fleetRoutes } from "../../src/app/routes/fleet.js"
import { streamRoutes } from "../../src/app/routes/stream.js"

const { call, router } = mount(fleetRoutes, streamRoutes)

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures")
const BARE = join(FIXTURES, "shipped", "bare")
const SCRATCH = mkdtempSync(join(tmpdir(), "orkestra-reload-"))

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

/** A copy of the fixture project, so a test can write into its `.orkestra/`. */
const project = (name: string): string => {
  const dir = join(SCRATCH, name)
  cpSync(join(FIXTURES, "library"), dir, { recursive: true })
  return dir
}

const SURVEY = `---
description: Looks around first.
model: sonnet
permission: read-only
start: true
output:
  Summary: What is there.
---

Look around.
`

const reload = call(new Request("http://localhost/api/reload", { method: "POST" }))

const agentNames = Effect.gen(function* () {
  const response = yield* call(new Request("http://localhost/api/agents"))
  const body = yield* jsonOf(response)
  return Schema.decodeUnknownSync(Schema.Array(AgentDto))(body).map((a) => a.name)
})

/** Run `body` holding the real pair over `dir`, the holder `layers.ts` builds. */
const over = <A, E, R>(dir: string, body: Effect.Effect<A, E, R>) =>
  Effect.flatMap(
    Effect.orDie(Effect.provide(ProjectFiles, ProjectFilesLayer(dir, BARE, TEMPLATES))),
    (files) => Effect.provideService(body, ProjectFiles, files),
  )

/**
 * A pair a test swaps by hand; `reload` is never called through it. The templates are
 * set once the flow has read them, since only its layers hold them.
 */
const holding = (first: Library) => {
  let held: ProjectFilesRead = { library: first, templates: new Map() }
  const files: ProjectFilesShape = {
    current: Effect.sync(() => held),
    reload: Effect.void,
    refresh: Effect.void,
    served: Effect.succeed(undefined),
  }
  const swap = (next: Library): void => {
    held = { ...held, library: next }
  }
  const reading = (templates: Templates): void => {
    held = { ...held, templates }
  }
  return { files, swap, reading }
}

const jsonOf = (response: Parameters<typeof toWeb>[0]) =>
  Effect.promise((): Promise<unknown> => toWeb(response).json())

/** The fixture fleet with every brief rewritten, which is what a reload hands over. */
const rewritten = (lib: Library): Library => ({
  ...lib,
  agents: new Map(
    [...lib.agents].map(([name, agent]) => [name, { ...agent, brief: `${agent.brief} NEW` }]),
  ),
})

describe("the reload route", () => {
  it("lists an agent written after boot once the files are reloaded", async () => {
    const dir = project("added")
    await runFlow([], () =>
      over(
        dir,
        Effect.gen(function* () {
          const before = yield* agentNames
          expect(before).not.toContain("survey")
          writeFileSync(join(dir, ".orkestra", "agents", "survey.md"), SURVEY)
          // Not before the press: a file on disk is not a file the engine holds.
          expect(yield* agentNames).not.toContain("survey")

          expect((yield* reload).status).toBe(204)
          const after = yield* agentNames
          expect(after).toContain("survey")
          expect(after).toHaveLength(before.length + 1)
        }),
      ),
    )
  })

  it("answers 422 with the file that would not load, and keeps serving the old pair", async () => {
    const dir = project("broken")
    await runFlow([], () =>
      over(
        dir,
        Effect.gen(function* () {
          const before = yield* agentNames
          writeFileSync(join(dir, ".orkestra", "agents", "survey.md"), SURVEY)
          writeFileSync(join(dir, ".orkestra", "agents", "broken.md"), "---\nmodel: [\n---\nNo.\n")

          const response = yield* reload
          expect(response.status).toBe(422)
          const body = yield* jsonOf(response)
          expect(Schema.decodeUnknownSync(ReloadFailedDto)(body).reason).toContain("broken.md")
          // Neither file reached the engine — the good one beside it included.
          expect(yield* agentNames).toEqual(before)
        }),
      ),
    )
  })

  it("answers 404 on an engine that holds a fixed pair", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        expect((yield* reload).status).toBe(404)
      }),
    )
  })
})

/** Create, approve the plan, approve step 1: two turns, and the gate after the second. */
const throughStepOne = (id: TrakId) =>
  Effect.gen(function* () {
    yield* create(id, "Add a --json flag")
    expectAwaiting(yield* act(id, 0, human.approve()), "approval")
    expectAwaiting(yield* act(id, 1, human.approve()), "approval")
  })

describe("a turn across a reload", () => {
  it("finishes on the brief it began with, and the next step takes the new one", async () => {
    const lib = library()
    const held = holding(lib)
    const work = step(1, "work", reply.artifact("done"))
    // The swap lands while step 1's turn is running: the request is in, and its answer
    // has not been read yet.
    const workSwapping = {
      ...work,
      when: (req: Parameters<typeof work.when>[0]) => {
        const hit = work.when(req)
        if (hit) held.swap(rewritten(lib))
        return hit
      },
    }
    await runFlowWithAgentLog(
      [composer("work", "review"), workSwapping, step(2, "review", reply.artifact("fine"))],
      (id, agentLog) =>
        Effect.gen(function* () {
          held.reading(yield* Prompts)
          yield* Effect.provideService(throughStepOne(id), ProjectFiles, held.files)
          const [workRun, reviewRun] = stepRuns(yield* agentLog)
          // Wherever the brief is carried — the standing brief or the prompt — it is whole.
          expect(JSON.stringify(workRun)).toContain("Do the work.")
          expect(JSON.stringify(workRun)).not.toContain("NEW")
          expect(JSON.stringify(reviewRun)).toContain("Review it. NEW")
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
            "HumanActed",
            "WorkCommitted",
            "EffectsRan",
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
          ])
        }),
      lib,
    )
  })
})

const SERVE = `require("http").createServer((q, r) => r.end("hi")).listen(Number(process.env.PORT), "127.0.0.1")`

const declare = (name: string, said: string): HostedProcess => {
  const path = join(SCRATCH, `${name}-${said}.sh`)
  writeFileSync(path, `#!/bin/bash\necho "${said}"\nexec node -e '${SERVE}'\n`)
  chmodSync(path, 0o755)
  return { name, description: `the ${name} process`, page: true, readySeconds: 10, needs: [], path }
}

const pidOf = (record: string, name: string): number | undefined => {
  const entries: unknown = JSON.parse(readFileSync(record, "utf8"))
  const decoded = Schema.decodeUnknownSync(
    Schema.Array(Schema.Struct({ name: Schema.String, pid: Schema.Number })),
  )(entries)
  return decoded.find((e) => e.name === name)?.pid
}

const alive = (pid: number | undefined): boolean => {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const named = (runs: readonly HostedRun[], name: string): HostedRun | undefined =>
  runs.find((r) => r.name === name)

const runOf = (name: string) =>
  Effect.flatMap(HostedProcesses, (hosted) =>
    Effect.map(hosted.list(undefined, SCRATCH), (runs) => named(runs, name)),
  )

const isUp = (run: HostedRun | undefined): boolean => run?.state._tag === "Running"

/** Read again after the wait, since `repeat` with a schedule answers the schedule's count. */
const running = (name: string) =>
  runOf(name).pipe(
    Effect.repeat({ until: isUp, schedule: Schedule.spaced("50 millis") }),
    Effect.timeout("15 seconds"),
    Effect.orDie,
    Effect.andThen(runOf(name)),
  )

describe("a running process across a reload", () => {
  it("keeps its pid and its run, and the next start uses the new declaration", async () => {
    const v1 = library({ processes: new Map([["dev", declare("dev", "dev v1")]]) })
    const v2 = library({
      processes: new Map([
        ["dev", declare("dev", "dev v2")],
        ["extra", declare("extra", "extra v1")],
      ]),
    })
    const held = holding(v1)
    const record = join(SCRATCH, "processes.json")
    const layer = ShellHostedProcessesLayer({ record }).pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeProcessLayer,
          inheritedEnvironment,
          PubSubFeedLayer,
          Layer.succeed(Lib, v1),
          Layer.succeed(ProjectFiles, held.files),
        ),
      ),
    )
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hosted = yield* HostedProcesses
          yield* hosted.start(undefined, SCRATCH, "dev")
          const before = yield* running("dev")
          const pid = pidOf(record, "dev")
          expect(alive(pid)).toBe(true)

          held.swap(v2)
          const after = yield* runOf("dev")
          // The same run, still up, under the same pid: a reload stops nothing.
          expect(after?.run).toBe(before?.run)
          expect(after?.state).toEqual(before?.state)
          expect(pidOf(record, "dev")).toBe(pid)
          expect(alive(pid)).toBe(true)
          // And the list is the new declarations' — what a press would offer next.
          expect((yield* hosted.list(undefined, SCRATCH)).map((r) => r.name)).toEqual([
            "dev",
            "extra",
          ])

          yield* hosted.restart(undefined, SCRATCH, "dev")
          const again = yield* running("dev")
          expect(again?.log).toContain("dev v2")
          yield* hosted.stop(undefined, "dev")
        }).pipe(Effect.provide(layer)),
      ),
    )
  })
})

/** The stream, left open: `call` would close the request's scope, and the stream with it. */
const openStream = Router.toHttpApp(router).pipe(
  Effect.flatMap((app) =>
    Effect.provideService(
      app,
      ServerRequest.HttpServerRequest,
      ServerRequest.fromWeb(new Request("http://localhost/api/stream")),
    ),
  ),
  Effect.orDie,
)

/** Frames off an open stream, read on demand, so a test can read some, act, and read on. */
const framesOf = (response: Parameters<typeof toWeb>[0]) => {
  // oxlint-disable-next-line unicorn/no-null -- the Web Streams API answers with it
  const body: ReadableStream<Uint8Array> | null = toWeb(response).body
  if (body === null) throw new Error("the stream has no body")
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  const waiting: EngineFrameDto[] = []
  /** Read until a frame `wanted` accepts, and answer it. */
  const until = async (wanted: (frame: EngineFrameDto) => boolean): Promise<EngineFrameDto> => {
    for (;;) {
      const found = waiting.findIndex(wanted)
      if (found >= 0) {
        const [frame] = waiting.splice(0, found + 1).slice(-1)
        if (frame !== undefined) return frame
      }
      waiting.length = 0
      // oxlint-disable-next-line no-await-in-loop -- reading a stream is inherently serial
      const chunk = await reader.read()
      if (chunk.done) throw new Error("the stream ended")
      buffered += decoder.decode(chunk.value, { stream: true })
      const blocks = buffered.split("\n\n")
      buffered = blocks.pop() ?? ""
      for (const block of blocks) {
        const data = block.split("\n").find((line) => line.startsWith("data: "))
        if (data !== undefined) {
          waiting.push(Schema.decodeUnknownSync(EngineFrameDto)(JSON.parse(data.slice(6))))
        }
      }
    }
  }
  return { until, close: () => reader.cancel() }
}

/** An append of this event, read off the frame. */
const appending =
  (event: string) =>
  (frame: EngineFrameDto): boolean =>
    frame._tag === "Appended" && frame.event._tag === event

const modelOf = (frame: EngineFrameDto): string | undefined => {
  const steps = frame._tag === "Appended" ? (frame.plan?.steps ?? []) : []
  for (const entry of steps) if (entry.type === "agent") return entry.model
  return undefined
}

const nextAppend = (frames: ReturnType<typeof framesOf>, event: string) =>
  Effect.promise(() => frames.until(appending(event)))

/** `work` running on another model, as a reload of an edited agent file hands over. */
const workOn = (lib: Library, model: string): Library => {
  const work = lib.agents.get("work")
  if (work === undefined) throw new Error("the fixture fleet lost its `work` agent")
  return { ...lib, agents: new Map(lib.agents).set("work", { ...work, model }) }
}

describe("the event stream across a reload", () => {
  it("projects a frame appended after the reload with the reloaded model", async () => {
    const lib = library()
    const held = holding(lib)
    await runFlow([composer("work"), step(1, "work", reply.artifact("done"))], (id) =>
      Effect.provideService(
        Effect.gen(function* () {
          held.reading(yield* Prompts)
          const frames = framesOf(yield* openStream)
          expectAwaiting(
            yield* create(id, "Add a --json flag").pipe(
              Effect.andThen(act(id, 0, human.approve())),
            ),
            "approval",
          )
          const before = yield* nextAppend(frames, "AgentReturned")
          expect(modelOf(before)).toBe("sonnet")

          held.swap(workOn(lib, "haiku"))
          yield* act(id, 1, human.approve())
          // The same connection, opened before the reload.
          const after = yield* nextAppend(frames, "HumanActed")
          expect(modelOf(after)).toBe("haiku")
          yield* Effect.promise(frames.close)
        }),
        ProjectFiles,
        held.files,
      ),
    )
  })
})
