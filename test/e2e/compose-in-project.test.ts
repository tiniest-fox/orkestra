// A trak's composer turn before its checkout, under an external store: the turn runs in the
// project's sandbox, and so does the env script it is handed. Captured on this machine,
// the dump of the engine's whole environment would reach the sandbox as the turn's
// explicit `env`, and `--runners-only` would refuse the capture outright.
//
// A goal's composer turn there starts the project's sandbox before it opens the tunnel to
// its tools: the runner refuses `reach` on a stopped sandbox, and the turn then runs
// without them.
//
// No engine path composes a trak with no checkout, so this calls `Compose` itself, on a
// trak that has none, with `Sandboxes` naming the project's place and an `Environment`
// that records where each capture was asked to run. That a capture placed in the
// project runs in its sandbox is for whatever provides the sandbox to test, against a real
// container.

import { Effect, Layer, Ref } from "effect"
import { McpServer, SessionId } from "../../src/agent/types/session.js"
import { describe, expect, it } from "vitest"
import type { ProcessSpec } from "../../src/agent/ports/process.js"
import { Command } from "../../src/workflow/domain/decide.js"
import { emptyTrak } from "../../src/workflow/domain/trak.js"
import { Triggers } from "../../src/workflow/domain/trigger.js"
import { Environment } from "../../src/workflow/ports/environment.js"
import { GoalEvents, replayGoal } from "../../src/workflow/domain/goal.js"
import { GoalId } from "../../src/workflow/domain/trak.js"
import { Compose, ComposeGoal } from "../../src/workflow/runtime.js"
import { Sandboxes, type SandboxesShape } from "../../src/vcs/ports/sandboxes.js"
import { composer, runFlowWithAgentLog } from "../support/flow.js"
import { onPrompt } from "../support/scripted-agent.js"
import { inheritedEnvironment } from "../support/scripted-environment.js"

/** The cache checkout's path, where the project's sandbox holds its checkout. */
const CACHE = "/work/team/project"

const unused = Effect.die("not reached by a composer turn before its checkout")

/** An external store's project place, and no trak's checkout in a sandbox. */
const projectPlaced: SandboxesShape = {
  inUse: Effect.succeed(true),
  holds: () => Effect.succeed(true),
  placeOf: () => Effect.succeed(undefined),
  project: Effect.succeed({ trak: "project", path: CACHE }),
  create: () => unused,
  status: () => unused,
  idOf: () => Effect.succeed(undefined),
  list: unused,
  release: () => unused,
  kill: () => unused,
  expose: () => unused,
  reach: () => unused,
  healthThrough: () => unused,
  transfer: () => unused,
  retried: () => unused,
  place: () => unused,
  write: () => unused,
  collect: () => unused,
  moveOut: () => unused,
  readInside: () => unused,
  stats: () => unused,
  copyHomeBack: () => Effect.void,
  copyHomeIn: () => unused,
  awake: () => unused,
  lost: () => unused,
  resuming: () => Effect.succeed(false),
  remakeWith: () => unused,
  stopIdleUnder: () => unused,
  waitingBy: () => unused,
  rebuild: () => unused,
  rebuildOf: () => unused,
  leftBehindTo: () => Effect.void,
  asWork: (work) => work,
  shell: () => unused,
}

/** One capture: the directory it was asked in, and the placement laid on its spawn. */
interface Captured {
  readonly cwd: string
  readonly placed: Pick<ProcessSpec, "inProject" | "passOnly"> | undefined
}

/** An env script that leaves `FROM_SCRIPT` exported, and every capture asked of it. */
const recording = (asked: Ref.Ref<readonly Captured[]>) =>
  Layer.effect(
    Environment,
    Effect.map(Environment, (inherited) => ({
      ...inherited,
      capture: (cwd: string, _onStage: unknown, placed?: Captured["placed"]) =>
        Effect.as(
          Ref.update(asked, (all) => [...all, { cwd, placed }]),
          {
            FROM_SCRIPT: "1",
          },
        ),
    })),
  ).pipe(Layer.provide(inheritedEnvironment))

describe("a trak's composer turn before its checkout, under an external store", () => {
  it("captures its env script in the project's sandbox, where the turn runs", async () => {
    const asked = Effect.runSync(Ref.make<readonly Captured[]>([]))
    await runFlowWithAgentLog(
      [composer("work")],
      (id, agentLog) =>
        Effect.gen(function* () {
          const trak = { ...emptyTrak(id), description: "Add a --json flag" }
          expect(trak.worktree).toBeUndefined()
          yield* Compose(
            trak,
            Command.Compose({ description: trak.description, trigger: Triggers.initial() }),
          ).pipe(Effect.provideService(Sandboxes, projectPlaced), Effect.orDie)

          expect(yield* Ref.get(asked)).toEqual([{ cwd: CACHE, placed: { inProject: true } }])
          const [request] = (yield* agentLog).requests
          expect(request?.cwd).toBe(CACHE)
          expect(request?.inProject).toBe(true)
          expect(request?.env).toMatchObject({ FROM_SCRIPT: "1" })
        }),
      undefined,
      undefined,
      undefined,
      undefined,
      recording(asked),
    )
  })
})

describe("a goal's composer turn under an external store", () => {
  it("starts the project's sandbox before it opens the tunnel to its tools", async () => {
    const order = Effect.runSync(Ref.make<readonly string[]>([]))
    const said = (what: string) => Ref.update(order, (all) => [...all, what])
    const sandboxes: SandboxesShape = {
      ...projectPlaced,
      place: (at, files, replace) =>
        said(`place ${at.trak} ${at.path} ${String(files.size)} ${String(replace)}`),
    }
    const tools = {
      here: McpServer.Http({ url: "http://127.0.0.1:1/here" }),
      reached: {
        tools: McpServer.Http({ url: "http://127.0.0.1:1/reached" }),
        reach: () => said("reach"),
      },
    }
    await runFlowWithAgentLog([onPrompt(/./, "Nothing to do yet.", "goal composer")], () =>
      Effect.gen(function* () {
        const id = GoalId.make("g1")
        const goal = replayGoal(id, [GoalEvents.asked("Make search work", ["smart"])])
        if (goal === undefined) return yield* Effect.die("the goal did not replay")
        const announced = yield* Ref.make<SessionId | undefined>(undefined)
        yield* ComposeGoal(goal, tools, SessionId.make("s1"), announced).pipe(
          Effect.provideService(Sandboxes, sandboxes),
        )

        expect(yield* Ref.get(order)).toEqual([`place project ${CACHE} 0 false`, "reach"])
      }),
    )
  })
})
