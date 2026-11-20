// A scenario is a sequence of human actions against one trak, asserted against
// the event log — because the log is the durable truth, not in-memory state.
//
// No clock and no agent: memory store + scripted agent + fixed ids, so a
// scenario is fully deterministic.
//
// The worktrees are real directories, and that is deliberate: the thing a flow
// test wants to know about one — that the directory a step is told to work in
// exists, and that what it wrote is still there afterwards — is what a fake that
// only answered the port could not show. The suite spent a while reporting a tidy
// `WorktreeReady` for directories that did not exist.
//
// Git itself is not under them by default. `SnapshotVcsLayer` makes those
// directories and keeps the history in memory, so a flow starts no git process.
// A theme whose subject is git asks for `GitCliLayer` by name — see `FlowVcs`.

import * as path from "node:path"
import { diagramsRefusing } from "./diagrams.js"
import { BuiltinPromptsLayer } from "../../src/prompts/adapters/builtin.js"
import { TEMPLATES } from "../../src/app/packaged.js"
import { Effect, Layer, Schedule, Scope } from "effect"
import { expect } from "vitest"
import { McpServer, SessionId } from "../../src/agent/types/session.js"
import { NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import { Transcript } from "../../src/agent/ports/transcript.js"
import { Lib } from "../../src/library/ports/library.js"
import type { Library } from "../../src/library/types/library.js"
import { GitCliLayer } from "../../src/vcs/adapters/git-cli.js"
import { Vcs } from "../../src/vcs/ports/vcs.js"
import type { GitFailed } from "../../src/vcs/types/errors.js"
import { noPullRequest } from "./forge.js"
import { plainRepo, testRepo } from "./vcs-fixture.js"
import { SnapshotVcsLayer } from "./vcs-snapshots.js"
import { MemoryRunsLayer } from "../../src/workflow/adapters/runs-memory.js"
import { MemoryPassesLayer } from "../../src/workflow/adapters/passes-memory.js"
import { MemoryTurnToolsLayer } from "../../src/workflow/adapters/turn-tools-memory.js"
import { MemorySetupsLayer } from "../../src/workflow/adapters/setups-memory.js"
import { UploadsLayer } from "../../src/app/attachments.js"
import { MemoryPreparationLayer } from "../../src/workflow/adapters/preparation-memory.js"
import { FileEngineLogLayer } from "../../src/workflow/adapters/engine-log-file.js"
import { ShellHostedProcessesLayer } from "../../src/workflow/adapters/processes-shell.js"
import { publishingRuns } from "../../src/workflow/adapters/runs-publishing.js"
import { MemoryStoreLayer } from "../../src/workflow/adapters/store-memory.js"
import { MemoryArchiveLayer } from "../../src/workflow/adapters/archive-memory.js"
import { MemoryIdleLayer } from "../../src/workflow/adapters/idle-memory.js"
import { PubSubFeedLayer } from "../../src/workflow/adapters/feed-pubsub.js"
import { publishingGoalStore } from "../../src/workflow/adapters/goal-store-publishing.js"
import { publishingStore } from "../../src/workflow/adapters/store-publishing.js"
import { ConditionsLayer } from "../../src/app/conditions.js"
import { viewsLayer } from "../../src/app/views.js"
import { DeploysLayer } from "../../src/app/deploys.js"
import { HostGitLayer } from "../../src/app/host-git.js"
import { UsageMemoryLayer } from "../../src/app/plan-usage.js"
import { DetailsLayer } from "../../src/app/details.js"
import { PublicPeopleLayer } from "../../src/app/people.js"
import { Drives, DrivesLayer } from "../../src/app/drive.js"
import { MemoryLocksLayer } from "../../src/workflow/adapters/locks-memory.js"
import { MemoryGoalStoreLayer } from "../../src/workflow/adapters/goal-store-memory.js"
import { goalDrivesLayer } from "../../src/app/goal-drives.js"
import { memoryPush } from "./push-memory.js"
import { memoryOpeners } from "./openers-memory.js"
import { NodeWorkspaceLayer } from "../../src/workflow/adapters/workspace-node.js"
import { Events } from "../../src/workflow/domain/event.js"
import { artifactText } from "../../src/workflow/domain/outputs/artifact.js"
import { Actions } from "../../src/workflow/domain/human-action.js"
import type { Event } from "../../src/workflow/domain/event.js"
import type { HumanAction } from "../../src/workflow/domain/human-action.js"
import {
  type HumanGate,
  type Reconsult,
  type RunMode,
  type Trak,
  TrakId,
} from "../../src/workflow/domain/trak.js"
import type { Forge } from "../../src/vcs/ports/forge.js"
import { EngineVersion } from "../../src/workflow/ports/engine-version.js"
import type { Environment } from "../../src/workflow/ports/environment.js"
import { Ids } from "../../src/workflow/ports/ids.js"
import { Observer } from "../../src/workflow/ports/observer.js"
import { Runs } from "../../src/workflow/ports/runs.js"
import { Store } from "../../src/workflow/ports/store.js"
import type { StoreFailed } from "../../src/workflow/ports/store-errors.js"
import { advance } from "../../src/workflow/runtime.js"
import { scriptedAgent, type Turn } from "./scripted-agent.js"
import { type CheckScript, scriptedChecks } from "./scripted-checks.js"
import { inheritedEnvironment } from "./scripted-environment.js"
import { library } from "./library.js"

/**
 * Deterministic ids, so scenarios are reproducible.
 *
 * A trak id is a counter rather than a UUID shape: nothing requires the format,
 * and `child-1` in an assertion says which trak it is where a UUID says nothing.
 *
 * **A session id is reproducible per run, not per child.** It is drawn as a turn
 * starts, and a spawn's children start at once, so which of them gets `…0001` is
 * whichever the scheduler reached first. Nothing may key off a child's session id
 * being a particular number — `prompt-log.ts` renumbers rather than trusting it.
 */
/** The engine version every flow runs as — what each turn event it writes names. */
export const ENGINE_VERSION = "0.0.0-flow"

/** The read tools every turn is listed, after its process tools, in the order listed. */
export const READ_TOOL_NAMES = [
  "turn_status",
  "list_traks",
  "read_trak",
  "read_artifact",
  "list_goals",
  "read_goal",
  "read_transcript",
  "read_events",
  "engine_log",
  "snapshot_logs",
]

/**
 * The server every step's session is handed — never started, since nothing here spawns a
 * CLI. A flow calls the route instead.
 */
export const trakToolsServer = (trak: TrakId): McpServer =>
  McpServer.Stdio({
    command: "/bin/orkestra",
    args: ["trak-tools"],
    env: { ORK_TRAK_ID: trak },
  })

const FixedIds = Layer.sync(Ids, () => {
  let sessions = 0
  let traks = 0
  let execs = 0
  return {
    newSessionId: Effect.sync(() => {
      sessions += 1
      return SessionId.make(`00000000-0000-4000-8000-${String(sessions).padStart(12, "0")}`)
    }),
    newTrakId: Effect.sync(() => {
      traks += 1
      return TrakId.make(`child-${traks}`)
    }),
    newExecId: Effect.sync(() => {
      execs += 1
      return `exec-${String(execs)}`
    }),
  }
})

/**
 * What a flow's `Vcs` is: the fake, or git in a throwaway repository.
 *
 * `git` is for a theme whose subject is git — a branch, a merge, a remote, a commit
 * an agent makes in its checkout, or a test that reads the repository with `git`.
 * Everything else takes `snapshots`, which starts no git process.
 */
export type FlowVcs = "git" | "snapshots"

/** The project directory and the `Vcs` over it, for one `FlowVcs`. */
const repositoryFor = (
  vcs: FlowVcs,
): Effect.Effect<
  { readonly repoDir: string; readonly layer: Layer.Layer<Vcs, GitFailed> },
  never,
  Scope.Scope
> =>
  vcs === "git"
    ? Effect.map(testRepo, (repoDir) => ({
        repoDir,
        // The layer that ships, so a flow test and `pnpm ork` exercise the same
        // git commands.
        layer: GitCliLayer(repoDir).pipe(Layer.provide(NodeProcessLayer)),
      }))
    : Effect.map(plainRepo, (repoDir) => ({ repoDir, layer: SnapshotVcsLayer(repoDir) }))

export const scenario = (
  turns: readonly Turn[],
  lib: Library = library(),
  checks: CheckScript = {},
  // Overridable so `persistence.test.ts` can point the same scenario at a real
  // temp directory instead of the in-memory store, without duplicating every
  // other layer a flow needs.
  storeLayer: Layer.Layer<Store, StoreFailed> = MemoryStoreLayer,
  // Overridable for the same reason, and defaulted to the answer every flow that
  // is not about a pull request wants: this repository's traks have none. The
  // real adapter would spawn `gh` against whatever forge the machine is logged
  // into, which is a network call inside a test that has no network in it.
  forgeLayer: Layer.Layer<Forge> = noPullRequest,
  // Defaulted to what a project with no env script gets, which is every flow but the
  // theme about the script itself — that one says what its script left exported.
  environmentLayer: Layer.Layer<Environment> = inheritedEnvironment,
  vcs: FlowVcs = "snapshots",
) =>
  Effect.gen(function* () {
    // Scoped: released by `Effect.scoped` in `flow.ts`, after the body has run.
    const repository = yield* repositoryFor(vcs)
    const repoDir = repository.repoDir
    const { layer: agentLayer, log: agentLog } = yield* scriptedAgent(turns)
    const { layer: checksLayer, log: checksLog } = yield* scriptedChecks(checks)
    // The push routes want a `Push` in scope; a flow that never subscribes pays for an
    // empty list. The push theme provides its own over the top to read what was sent.
    const push = yield* memoryPush
    // Likewise the opener routes and `Openers` — the theme about them provides its
    // own shape over the top of a body to watch what was opened.
    const openers = yield* memoryOpeners
    const id = TrakId.make("scenario-trak")

    const layers = Layer.mergeAll(
      BuiltinPromptsLayer(TEMPLATES),
      Layer.succeed(EngineVersion, ENGINE_VERSION),
      diagramsRefusing(),
      // Wrapped exactly as `src/app/layers.ts` wraps the file store, so a flow test
      // exercises the store the daemon actually runs on — and so anything asserting
      // on the stream has frames to watch. The decorator is held to the whole `Store`
      // contract in `test/contract/store-publishing.test.ts`, which is what makes
      // putting it under every flow test safe.
      publishingStore(storeLayer),
      publishingRuns(MemoryRunsLayer),
      MemoryPassesLayer,
      MemoryTurnToolsLayer(trakToolsServer),
      MemorySetupsLayer,
      // As `src/app/layers.ts` provides it: a new trak's files, held until its checkout.
      UploadsLayer(repoDir),
      MemoryPreparationLayer,
      // The real file, in the throwaway repository, so `engine_log` reads what it kept.
      FileEngineLogLayer(repoDir),
      publishingGoalStore(MemoryGoalStoreLayer),
      FixedIds,
      agentLayer,
      checksLayer,
      // After the turn tools, so the one theme whose subject is a session in a sandbox can
      // hand its own `TurnTools` in this layer beside the environment, and be the one the
      // engine sees.
      environmentLayer,
      Layer.succeed(Lib, lib),
      Layer.succeed(Observer, { transition: () => Effect.void, agentEvent: () => Effect.void }),
      Layer.succeed(Transcript, { record: () => Effect.void }),
      repository.layer,
      // Real for the reason the worktrees are: the thing worth knowing about the
      // projection is that the files are in the worktree and that `commitWork`
      // does not commit them, and neither is visible through a fake. On git the
      // fixture's committed ignore entries are what make the second half true —
      // see `vcs-fixture.ts`; the snapshot `Vcs` leaves out `IGNORED_PATHS` itself.
      NodeWorkspaceLayer(repoDir),
      forgeLayer,
      push.layer,
      openers,
      // A flow's provider is not watched, so nothing reports; the route answers `NotRead`.
      UsageMemoryLayer,
      // Real for `Vcs`'s reason: a process coming up on its port and dying when it
      // should is what a fake cannot show. A fleet that lists none spawns nothing.
      ShellHostedProcessesLayer({
        record: path.join(repoDir, ".orkestra", ".database", "processes.json"),
      }).pipe(
        Layer.provide(Layer.mergeAll(NodeProcessLayer, environmentLayer, Layer.succeed(Lib, lib))),
      ),
    ).pipe(
      Layer.provideMerge(PubSubFeedLayer),
      Layer.provideMerge(MemoryArchiveLayer),
      Layer.provideMerge(MemoryIdleLayer),
    )

    // The permits every `advance` takes, and the map a forked drive lives in. Here
    // rather than in `http-api.test.ts` so the harness composes the same set
    // `src/app/layers.ts` does — a route that works in one and not the other is the
    // failure this is meant to make impossible. Both are per-build, so a flow test
    // that never forks a drive pays for an empty map.
    const driving = DrivesLayer.pipe(
      Layer.provideMerge(
        // One person's `People`, as `pnpm serve` runs it — so every press goes through and
        // every turn reads the whole project.
        Layer.mergeAll(
          DeploysLayer,
          DetailsLayer,
          HostGitLayer,
          viewsLayer(),
          PublicPeopleLayer,
        ).pipe(Layer.provideMerge(Layer.merge(layers, MemoryLocksLayer))),
      ),
      Layer.provideMerge(MemoryLocksLayer),
    )
    // A goal's turns over the drives, as `layers.ts` stacks them — and handed no tool
    // server: a flow about goals answers the composer's calls itself, through the route.
    const goaling = goalDrivesLayer(undefined).pipe(Layer.provideMerge(driving))
    // The sweep, over the drives it asks for — as `layers.ts` stacks it. Nothing forks
    // it here: a flow that is about a wait runs `Conditions.sweep` by hand, on a clock
    // it controls.
    const sweeping = ConditionsLayer.pipe(Layer.provideMerge(goaling))

    return { id, layers: sweeping, agentLog, checksLog, repoDir }
  })

// -- waiting on a drive -----------------------------------------------------

/**
 * Wait until nothing is driving this trak.
 *
 * An action answers 202 and the turn runs on a fiber, so asserting straight after one
 * would be asserting on a log still being written. It polls `driving` rather than
 * joining the fiber: that is the same question the list route answers for every row,
 * so a test waits the way a client does rather than through a door only tests have.
 */
export const idle = (id: TrakId): Effect.Effect<void, never, Drives> =>
  Effect.flatMap(Drives, (drives) =>
    Effect.repeat(drives.driving(id), {
      until: (driving) => !driving,
      schedule: Schedule.spaced("1 millis"),
    }),
  ).pipe(Effect.timeout("20 seconds"), Effect.orDie, Effect.asVoid)

/**
 * Wait until the trak's log satisfies `enough`.
 *
 * A drive's first append lands on the fiber it was forked onto, so a test that read
 * the log straight after a 202 would sometimes see the log from before it. The same
 * wait `idle` is, for a drive that is never going to finish.
 */
export const logged = (
  id: TrakId,
  enough: (tags: readonly string[]) => boolean,
): Effect.Effect<readonly string[], never, Store> =>
  Effect.gen(function* () {
    const store = yield* Store
    const tags = Effect.map(store.events(id), (events) => events.map((e) => e._tag))
    // Read again after the wait rather than using what `repeat` hands back: with a
    // `schedule` it returns the *schedule's* output — the repetition count — and a
    // test that mistook one for the other would compare a number to a log.
    yield* tags.pipe(Effect.repeat({ until: enough, schedule: Schedule.spaced("1 millis") }))
    return yield* tags
  }).pipe(Effect.timeout("20 seconds"), Effect.orDie)

// -- assertions -------------------------------------------------------------

export const expectState = (trak: Trak, tag: Trak["state"]["_tag"], step?: number): void => {
  expect(trak.state._tag).toBe(tag)
  if (step !== undefined && "step" in trak.state) expect(trak.state.step).toBe(step)
}

export const expectAwaiting = (trak: Trak, kind: HumanGate): void => {
  expect(trak.state._tag).toBe("AwaitingHuman")
  if (trak.state._tag === "AwaitingHuman") expect(trak.state.kind).toBe(kind)
}

/** The plan gate: its own state, so there is no `kind` to assert. */
export const expectAwaitingProposal = (trak: Trak): void => {
  expect(trak.state._tag).toBe("AwaitingProposal")
}

/**
 * The composer is owed a turn, and this is where its answer will land.
 *
 * Asserted off `Trak.reconsult` rather than off the state, because no state
 * carries it: it is a mechanism field the splice, the plan gate and the composer's
 * prompt all read, and what a human is shown comes out of the log.
 */
export const expectReconsult = (trak: Trak, why: Reconsult["why"]["_tag"]): void => {
  expect(trak.reconsult?.why._tag).toBe(why)
}

export const human = {
  approve: (): HumanAction => Actions.approve(),
  replan: (reason: string): HumanAction => Actions.replan(reason),
  chat: (message: string): HumanAction => Actions.chat(message),
  answer: (...answers: readonly [string, ...string[]]): HumanAction => Actions.answer(answers),
  skip: (message?: string): HumanAction => Actions.skip(message),
}

/**
 * `mode` is the default everywhere but the theme that is about it: `manual` is what
 * every flow before it ran as, so a test that says nothing about the mode still asserts
 * against the gates it was written for.
 */
export const create = (id: TrakId, description: string, mode: RunMode = "manual") =>
  advance(id, Events.trakCreated(description, undefined, mode))

export const act = (id: TrakId, step: number, action: HumanAction) =>
  advance(id, Events.humanActed(step, action))

/**
 * Create a trak and approve the plan, landing at the first step's own gate.
 *
 * The plan gate is the first thing every flow now hits, and most flows are not
 * about it — asserting it in every theme would test one branch eight times. The
 * tests that ARE about it call `create` and act explicitly.
 */
export const createAndStart = (id: TrakId, description: string) =>
  Effect.flatMap(create(id, description), () => act(id, 0, human.approve()))

/**
 * Approve every approve-able gate until the trak settles, and return where it
 * landed.
 *
 * The plan parks and so does every artifact, so a test about the *sequence* would
 * otherwise be mostly approvals. Tests about the gates themselves still act
 * explicitly — this is for the ones where a gate is incidental.
 *
 * Bounded deliberately: a gate that does not advance is the dead-end bug the
 * `Decision` union exists to prevent, so it should fail the test, not spin.
 */
export const approveAll = (id: TrakId, from: Trak) =>
  Effect.gen(function* () {
    let trak = from
    for (let i = 0; i < 10; i += 1) {
      const state = trak.state
      // The plan, and an artifact waiting to be accepted — a review that approves
      // is one too. Answers is the one gate approve cannot supply anything at, so
      // this stops there rather than inventing one.
      if (state._tag === "AwaitingProposal") {
        trak = yield* act(id, 0, human.approve())
        continue
      }
      if (state._tag !== "AwaitingHuman" || state.kind === "answers") return trak
      // Where the step filed nothing there is nothing to take, and `decide`
      // refuses an approval. Carrying on past it is a skip, which is what a
      // person does when they mean *move on without this step*.
      trak = yield* act(
        id,
        state.step,
        state.kind === "stuck" || state.kind === "conversation" ? human.skip() : human.approve(),
      )
    }
    throw new Error("still parked after 10 approvals — a gate is not advancing")
  })

/**
 * An artifact's markdown, keyed by position and agent — `0-work`.
 *
 * The trak holds the `Document` itself, so rendering happens at the point of
 * reading. `undefined` when the step has not produced one, so `toBeUndefined()`
 * still says what it used to.
 */
export const artifactOf = (trak: Trak, key: string): string | undefined => {
  const a = trak.artifacts.get(key)
  return a === undefined ? undefined : artifactText(a)
}

/**
 * One section of a step's artifact, which is what an assertion about *content*
 * means now that every agent declares sections.
 *
 * Sharper than matching a substring of the rendered document: it says which
 * section the words landed in, so a step that filed its work under the wrong
 * heading fails rather than passing on a `toContain`.
 */
export const sectionOf = (trak: Trak, key: string, title = "Summary"): string | undefined =>
  trak.artifacts.get(key)?.sections[title]

/**
 * The run record a killed process leaves: a turn still named, because nothing
 * cleared it.
 *
 * The one shape a flow test cannot reach by acting. An interruption in-process
 * unwinds the turn's scope, and unwinding is exactly what clears the record — so
 * *a turn nobody ended* only exists across a process death, and the record is
 * seeded rather than produced. `runs-file.test.ts` seeds `run.json` by hand for
 * the same reason.
 *
 * The scope is never closed on purpose: closing it is what a turn *ending* does.
 */
export const interrupted = (
  id: TrakId,
  turn: { readonly step: number | undefined; readonly sessionId: SessionId },
): Effect.Effect<void, StoreFailed, Runs> =>
  Effect.gen(function* () {
    const runs = yield* Runs
    yield* Scope.extend(
      runs.turn(id, {
        ...turn,
        agentPid: undefined,
        agentStart: undefined,
        usage: undefined,
        estimate: undefined,
      }),
      yield* Scope.make(),
    )
  })

/**
 * The trak's checkout, made in this flow's project — for a flow standing in for an engine
 * restarted over the project an earlier flow ran in. Each flow has a project of its own,
 * so without this the restarted work finds the checkout missing and makes it again.
 */
export const checkoutSurvived = (id: TrakId) =>
  Effect.orDie(Effect.asVoid(Effect.flatMap(Vcs, (vcs) => vcs.createWorktree(id))))

export const logTags = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    const events = yield* store.events(id)
    return events.map((e) => e._tag)
  })

/**
 * Every restart on a log, with the store's `at` dropped so a whole event compares
 * against a constructed one — which is what says which turn a restart names, and
 * that it names nothing else.
 */
export const restartsOn = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    const log = yield* store.events(id)
    return log.flatMap((e) => (e._tag === "Restarted" ? [{ ...e, at: undefined }] : []))
  })

/** How many times an event kind appears in the log. Keeps assertions flat. */
export const countTag = (id: TrakId, tag: Event["_tag"]) =>
  Effect.map(logTags(id), (tags) => tags.filter((t) => t === tag).length)

/** What the latest turn of a step filed, as the log holds it. */
export const lastOutput = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    const events = yield* store.events(id)
    return events.flatMap((e) => (e._tag === "AgentReturned" ? [e.output] : [])).at(-1)
  })

/** The background tasks each step filing stopped, for the filings that stopped any. */
export const stoppedByFilings = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    const events = yield* store.events(id)
    return events.flatMap((e) =>
      e._tag === "AgentReturned" && e.stopped !== undefined ? [e.stopped] : [],
    )
  })

/**
 * The kinds of line a trak's turns wrote, in order.
 *
 * Beside `logTags` because the transcript answers what the log deliberately cannot: a
 * re-ask is not an event, so the only place `elicit` re-prompting is visible is here.
 */
export const transcriptTags = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    const entries = yield* store.transcript(id)
    return entries.map((e) => e._tag)
  })

/**
 * The same fleet, with `work` declaring the given conditions — the third list out of
 * the one registry, and the one whose scripts are asked before a step starts rather
 * than run after it. A flow saying `conditions` is saying it is about the wait.
 */
export const workWaitingOn = (
  conditions: readonly string[],
  over: Partial<Library> = {},
): Library => {
  const lib = library(over)
  const work = lib.agents.get("work")
  if (work === undefined) throw new Error("the fixture fleet lost its `work` agent")
  return { ...lib, agents: new Map(lib.agents).set("work", { ...work, conditions }) }
}
