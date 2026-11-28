// The simulated engine. `PORT=<n> pnpm sim` writes a fresh project into a temporary
// directory, boots the engine over it with scripted answers in place of every CLI,
// seeds each state `test/support/sim-states.ts` names, and serves the API and the
// built client on `127.0.0.1:$PORT` — any free port for `PORT=0`, named in the ready line.
//
// **It spends nothing and touches nothing of this checkout's.** No turn spawns a CLI:
// the provider is `ScriptedQueuesLayer` alone, each trak answered from its own queue
// and every turn past the end from the repeat. Every write lands in the temporary
// project, which a restart replaces with a clean copy and a stop removes.
//
// Development tooling for this repository, so it is never bundled: that is what lets
// it import the state catalog out of `test/`.

// oxlint-disable-next-line eslint/no-restricted-imports -- git in the simulated engine's scratch project
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Cause, Console, Effect, Exit, Fiber, Layer, Schedule } from "effect"
import * as HttpServer from "@effect/platform/HttpServer"
// Named submodules, as `serve.ts` imports them: the package root pulls in a peer this
// repository does not install.
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as NodeContext from "@effect/platform-node/NodeContext"
import { ScriptedQueuesLayer, type ScriptedTurn } from "./agent/adapters/scripted.js"
import { mintToken } from "./app/access.js"
import { startConditionSweep } from "./app/conditions.js"
import { canonical, PROJECT_DIR_ENV } from "./app/discovery.js"
import { Drives } from "./app/drive.js"
import { startGoal, startGoalWatching } from "./app/goals.js"
import { makeGuard, sessionsFile } from "./app/guard.js"
import { engineLayers } from "./app/layers.js"
import { SHIPPED_AGENTS } from "./app/packaged.js"
import { Reports } from "./app/reports.js"
import { loadLibrary } from "./library/adapters/library-fs.js"
import { Vcs } from "./vcs/ports/vcs.js"
import { worktreePathFor } from "./vcs/logic/paths.js"
import { Events } from "./workflow/domain/event.js"
import { GoalEvents, replayGoal } from "./workflow/domain/goal.js"
import { type GoalId, TrakId } from "./workflow/domain/trak.js"
import { GoalStore } from "./workflow/ports/goal-store.js"
import {
  SIM_GOAL,
  SIM_PROJECT,
  SIM_TRAKS,
  type SimTrak,
  simRepeat,
} from "../test/support/sim-states.js"

const PORT = Number(process.env["PORT"])
if (!Number.isInteger(PORT) || PORT < 0) {
  console.error("sim: set PORT to the port to serve on — `PORT=4700 pnpm sim`, or 0 for any.")
  process.exit(1)
}
const TOKEN = mintToken()

/** The temporary project: every file the catalog names, committed on `main`. */
const writeProject = (): string => {
  // Canonical, because git reports a checkout by its real path and the queues are keyed
  // by the path a turn runs in — `/tmp` is a link on macOS.
  const root = canonical(mkdtempSync(join(tmpdir(), "orkestra-sim-")))
  for (const [path, text] of Object.entries(SIM_PROJECT)) {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
    if (file.endsWith(".sh")) chmodSync(file, 0o755)
  }
  const git = (...args: readonly string[]): void => {
    execFileSync("git", args, { cwd: root, stdio: "pipe" })
  }
  git("init", "--initial-branch=main")
  git("config", "user.name", "Orkestra sim")
  git("config", "user.email", "sim@orkestra.invalid")
  git("add", "-A")
  git("commit", "-m", "The simulated project")
  return root
}

/**
 * A report destination of its own, so the report form can be opened and sent. Each send
 * prints the report and answers a link; a note holding `fail` is refused instead, which
 * is how the failed state and its retry are reached.
 */
const SimReportsLayer = Layer.succeed(Reports, {
  destination: Effect.succeed({ name: "the sim's inbox" }),
  send: (report) =>
    report.note?.includes("fail") === true
      ? Effect.succeed({ reason: "The sim's inbox refused it, because the note says fail." })
      : Effect.as(Console.log(`sim: report ${JSON.stringify(report)}`), {
          reference: `https://reports.example.invalid/${report.trak.id}/${report.madeAt}`,
        }),
})

const ROOT = writeProject()
// What the routes take for the project, read once when `app/server.ts` loads — which is
// why that module is imported below this line rather than above it.
process.env[PROJECT_DIR_ENV] = ROOT
const { apiRouter } = await import("./app/server.js")

const LIB = await Effect.runPromise(loadLibrary(ROOT, SHIPPED_AGENTS))
const QUEUES = new Map<string, readonly ScriptedTurn[]>([
  ...SIM_TRAKS.map((t) => [worktreePathFor(ROOT, t.id), t.answers(LIB)] as const),
  // A goal's composer runs in the project root, so the root's queue is the goal's.
  [ROOT, SIM_GOAL.answers],
])

/** Wait until nothing is driving the trak: the press before has landed. */
const settled = (id: TrakId) =>
  Effect.flatMap(Drives, (drives) =>
    Effect.repeat(drives.driving(id), {
      until: (driving) => !driving,
      schedule: Schedule.spaced("20 millis"),
    }),
  ).pipe(
    Effect.timeoutFail({
      duration: "60 seconds",
      onTimeout: () => new Error(`sim: ${id} was still driving after a minute`),
    }),
  )

const seedTrak = (state: SimTrak) =>
  Effect.gen(function* () {
    const id = TrakId.make(state.id)
    const drives = yield* Drives
    yield* drives.start(id, () => Events.trakCreated(state.description))
    for (const press of state.presses) {
      yield* settled(id)
      yield* drives.start(id, () => Events.humanActed(press.step, press.action))
    }
    if (state.settles) yield* settled(id)
    yield* Console.log(`sim: ${id} — ${state.rests}`)
  })

const goalState = (id: GoalId) =>
  Effect.flatMap(GoalStore, (store) =>
    Effect.map(store.events(id), (log) => replayGoal(id, log)?.state._tag),
  )

const goalReaches = (id: GoalId, state: string) =>
  goalState(id).pipe(
    Effect.repeat({ until: (s) => s === state, schedule: Schedule.spaced("20 millis") }),
    Effect.timeoutFail({
      duration: "60 seconds",
      onTimeout: () => new Error(`sim: goal ${id} never reached ${state}`),
    }),
  )

/**
 * The goal, started with its spec already approved — as a sub-goal starts — so its first
 * turn opens traks rather than drafting.
 */
const seedGoal = Effect.gen(function* () {
  const id = yield* startGoal(SIM_GOAL.spec.file, GoalEvents.started(SIM_GOAL.spec))
  yield* goalReaches(id, "Watching")
  yield* Console.log(`sim: goal ${id} — ${SIM_GOAL.rests}`)
})

const serving = (engine: string) =>
  Effect.gen(function* () {
    // Open, as an engine with no passphrase is: it binds loopback only.
    const guard = yield* makeGuard({
      passphrase: undefined,
      token: TOKEN,
      sessions: sessionsFile(join(ROOT, ".orkestra")),
    })
    yield* startGoalWatching
    yield* startConditionSweep
    yield* HttpServer.serveEffect()(guard(apiRouter()))
    yield* Console.log(`sim: project ${ROOT}`)
    yield* (yield* Vcs).ensureIgnored()
    // One after another: each opens a git worktree, and the states are few.
    yield* Effect.forEach(SIM_TRAKS, seedTrak, { discard: true })
    yield* seedGoal
    yield* Console.log(`sim: ready on ${engine}/`)
    yield* Effect.never
  }).pipe(
    Effect.provide(
      engineLayers(ROOT, {
        hosting: { engine, token: TOKEN },
        reports: SimReportsLayer,
        scripted: ScriptedQueuesLayer({ queues: QUEUES, repeat: simRepeat(LIB) }),
      }),
    ),
  )

// The engine's address is read back from the bind, so `PORT=0` serves on whatever the
// kernel picked — what a test does, since a number picked free first can be taken.
const program = Effect.gen(function* () {
  const bound = (yield* HttpServer.HttpServer).address
  const port = bound._tag === "TcpAddress" ? bound.port : PORT
  return yield* serving(`http://127.0.0.1:${String(port)}`)
}).pipe(
  Effect.provide(NodeHttpServer.layer(() => createServer(), { port: PORT, host: "127.0.0.1" })),
  Effect.provide(NodeContext.layer),
  Effect.scoped,
)

const fiber = Effect.runFork(program)

const removeProject = (): void => {
  rmSync(ROOT, { recursive: true, force: true })
}

// A boot or a seed that failed says so and exits, as `serve.ts` does.
fiber.addObserver((exit) => {
  if (Exit.isFailure(exit) && !Cause.isInterruptedOnly(exit.cause)) {
    console.error(Cause.pretty(exit.cause, { renderErrorCause: true }))
    removeProject()
    process.exit(1)
  }
})

const stop = (): void => {
  void Effect.runPromise(Fiber.interrupt(fiber)).finally(() => {
    removeProject()
    process.exit(0)
  })
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
