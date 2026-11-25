// Goals: a goal started from a sentence or with its spec on its log, its composer's tool calls through the route its
// server forwards them to, the limits those calls are refused at, the watcher that wakes
// it, and pause and resume.
//
// The composer's turns are scripted and held open with `until`, which is how a tool call
// lands *inside* a turn here: the test makes the call through the route, the way
// `orkestra goal-tools` would, and then lets the turn end.

import { seedLog } from "../support/seed.js"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  Cause,
  Deferred,
  Effect,
  Either,
  Exit,
  Layer,
  Queue,
  Schedule,
  Schema,
  Stream,
} from "effect"
import { describe, expect, it } from "vitest"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { CreatedDto } from "@orkestra/shared/dto/actions"
import { McpToolResultDto } from "@orkestra/shared/dto/goals"
import { TrakDetailDto } from "@orkestra/shared/dto/trak"
import { McpServer, SessionId } from "../../src/agent/types/session.js"
import type { TranscriptEntry } from "../../src/agent/types/transcript-entry.js"
import { Lib } from "../../src/library/ports/library.js"
import {
  composer,
  composerFinishes,
  onGit,
  runFlow,
  runFlowWithAgentLog,
  step,
} from "../support/flow.js"
import { forgeSaying, refusesMerge } from "../support/forge.js"
import { PushSent } from "../support/push-memory.js"
import { worktreeOf, writeWork } from "../support/git.js"
import { mount } from "../support/http.js"
import { goalRoutes, startGoal as startWithSpec } from "../../src/app/goals.js"
import { trakRoutes } from "../../src/app/routes/trak.js"
import { act, human, idle, logged } from "../support/scenario.js"
import { library } from "../support/library.js"
import { crashesOn, hangsOn, onPrompt, onPromptAfter, reply } from "../support/scripted-agent.js"
import { Drives, openTrak } from "../../src/app/drive.js"
import { forgeSweep, sweepMemory } from "../../src/app/forge-sweep.js"
import { GoalDrives } from "../../src/app/goal-drives.js"
import { reconcileGoals, watchGoalTraks } from "../../src/app/goals.js"
import {
  BranchName,
  CommitSha,
  ForgeAnswer,
  ForgeListing,
  ForgeOpen,
  MergeInto,
} from "../../src/vcs/index.js"
import { Forge } from "../../src/vcs/ports/forge.js"
import { Vcs } from "../../src/vcs/ports/vcs.js"
import { goalCheckoutPathFor } from "../../src/vcs/logic/paths.js"
import { advance } from "../../src/workflow/runtime.js"
import { type Event, Events } from "../../src/workflow/domain/event.js"
import {
  type Goal,
  type GoalEvent,
  GoalEvents,
  type GoalSpec,
  type PlannedSubgoal,
  type PlannedTrak,
  replayGoal,
  subgoalSpec,
} from "../../src/workflow/domain/goal.js"
import { DeclaredServer } from "../../src/workflow/domain/mcp-servers.js"
import { hostListing } from "../support/scripted-environment.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import { GoalId, TrakId, UserId, atRest } from "../../src/workflow/domain/trak.js"
import { Frame, type Framed } from "../../src/workflow/ports/feed.js"
import { GoalStore } from "../../src/workflow/ports/goal-store.js"
import { Locks } from "../../src/workflow/ports/locks.js"
import { Store } from "../../src/workflow/ports/store.js"

const { call } = mount(goalRoutes, trakRoutes)

/** A project with nothing in it, for a library's root. */
const emptyProject = (): string => mkdtempSync(join(tmpdir(), "orkestra-goal-"))

/** A goal's spec, as approving its draft would leave it. */
const specOf = (file: string, title: string, rest: Partial<GoalSpec> = {}): GoalSpec => ({
  file,
  title,
  line: "The engine side",
  finished: "Every goal runs end to end.",
  limits: {},
  ...rest,
})

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(
    new Request(`http://localhost/api/goals${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  )

const jsonOf = (response: HttpServerResponse): Effect.Effect<unknown> =>
  Effect.promise(async (): Promise<unknown> => {
    const parsed: unknown = JSON.parse(await toWeb(response).text())
    return parsed
  })

/**
 * Start a goal whose spec is already approved, owned by the host user `by` where there is
 * one — so its first turn opens traks. A goal reaches this from a sentence only through
 * its file gate; the tests of that gate start from a sentence instead.
 */
const startGoal = (spec: GoalSpec, by?: string) =>
  startWithSpec(
    spec.file ?? "goal",
    GoalEvents.started(spec, by === undefined ? undefined : UserId.make(by)),
  ).pipe(Effect.orDie)

/** One tool call, as `orkestra goal-tools` forwards it, and what the model is told. */
const tool = (goal: GoalId, name: string, callId: string, args: unknown) =>
  Effect.gen(function* () {
    const response = yield* post(`/${goal}/tools/${name}`, { call: callId, arguments: args })
    expect(response.status).toBe(200)
    return Schema.decodeUnknownSync(McpToolResultDto)(yield* jsonOf(response))
  })

const goalNow = (id: GoalId) =>
  Effect.flatMap(GoalStore, (store) => Effect.map(store.events(id), (log) => replayGoal(id, log)))

/** Wait until the goal satisfies `enough` — a turn runs on the worker, not this fiber. */
const goalWhere = (id: GoalId, enough: (goal: Goal) => boolean) =>
  Effect.gen(function* () {
    yield* goalNow(id).pipe(
      Effect.repeat({
        until: (g) => g !== undefined && enough(g),
        schedule: Schedule.spaced("1 millis"),
      }),
    )
    const goal = yield* goalNow(id)
    if (goal === undefined) return yield* Effect.die("the goal has no log")
    return goal
  }).pipe(Effect.timeout("20 seconds"), Effect.orDie)

const runningNow = (id: GoalId) => Effect.flatMap(GoalDrives, (drives) => drives.running(id))

/** Wait until a composer turn of the goal is running. */
const untilRunning = (id: GoalId) =>
  runningNow(id).pipe(
    Effect.repeat({ until: (running) => running, schedule: Schedule.spaced("1 millis") }),
    Effect.timeout("20 seconds"),
    Effect.orDie,
  )

// Hoisted, because a callback inside a flow body is one too many for the nesting limit.
const atGate = (g: Goal): boolean => g.state._tag === "AtGate"
const isWatching = (g: Goal): boolean => g.state._tag === "Watching"
const oneWake = (g: Goal): boolean => g.wakes.length === 1
const twoWakes = (g: Goal): boolean => g.wakes.length === 2 && isWatching(g)
const isDropped = (g: Goal): boolean => g.state._tag === "Dropped"
const filed = (g: Goal): boolean => g.spec !== undefined && g.state._tag === "Watching"

/** Kick the goal's owed turn while holding its permit, then drop it — the drop's own order. */
const kickThenDrop = (goal: GoalId) =>
  Effect.gen(function* () {
    yield* (yield* GoalDrives).kick(goal)
    yield* Effect.sleep("50 millis")
    yield* seedLog(yield* GoalStore, goal, [GoalEvents.dropped("raced")])
  })
const opensIn = (tags: readonly string[]): number => tags.filter((t) => t === "TrakOpened").length
const holding = (t: TrakId) =>
  Effect.flatMap(Store, (store) =>
    Effect.map(store.events(t), (log) => replayHistory(t, log).holding),
  )

const goalTags = (id: GoalId) =>
  Effect.flatMap(GoalStore, (store) =>
    Effect.map(store.events(id), (log) => log.map((e) => e._tag)),
  )

const PLANNED: PlannedTrak = {
  title: "Parse the file",
  description: "Parse goal files.",
  mode: "smart",
}

/** What a goal's first turn is asked, once it has a file. */
const STARTED = /Open the traks you are confident in/

/** One question, for a test that wants a goal parked at a gate of its own asking. */
const ASK = { questions: [{ question: "Which part first?", options: [] }] } as const

/** A goal with `opened` running — written straight to its log. */
const watchingGoal = (id: GoalId, spec: GoalSpec, opened: readonly TrakId[]) =>
  Effect.flatMap(GoalStore, (store) =>
    seedLog(store, id, [
      GoalEvents.started(spec),
      ...opened.map((t, i) => GoalEvents.trakOpened(`c${String(i + 2)}`, t, t, "smart")),
      GoalEvents.turnEnded(SESSION, 0, undefined),
    ]),
  )

const SESSION = SessionId.make("00000000-0000-4000-8000-000000000009")
const SPEC: GoalSpec = { file: "g", title: "G", line: "l", finished: "done", limits: {} }

const SHIP = specOf("ship", "Ship goals")
const lib = library({ root: emptyProject() })

describe("a goal started from a file", () => {
  it("opens traks on its first turn with no gate before them, with `goal` set and the goal's owner", async () => {
    const opening = Effect.runSync(Deferred.make<void>())
    const chatted = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [
        onPromptAfter(STARTED, Deferred.await(opening), "Opened the first trak."),
        onPromptAfter(/Keep going/, Deferred.await(chatted), "Carrying on."),
        // The opened trak's own composer: it is an ordinary trak, and stays composing.
        hangsOn(/Compose a pipeline/),
      ],
      (_id, agentLog) =>
        Effect.gen(function* () {
          const id = yield* startGoal(SHIP, "gh:583231")
          expect((yield* goalNow(id))?.owner).toBe("gh:583231")
          const replanned = yield* tool(id, "replan", "toolu_plan", {
            traks: [PLANNED],
            why: "The first piece is clear.",
          })
          expect(replanned.isError).toBe(false)
          const opened = yield* tool(id, "open_trak", "toolu_open", PLANNED)
          expect(opened).toEqual({ text: "Opened trak `child-1`.", isError: false })
          yield* Deferred.succeed(opening, undefined)
          const watching = yield* goalWhere(id, isWatching)
          expect(watching.plan).toEqual([PLANNED])
          expect(watching.traks).toMatchObject([{ id: "child-1", status: "live", mode: "smart" }])
          expect((yield* post(`/${id}/act`, { _tag: "Chat", message: "Keep going" })).status).toBe(
            202,
          )
          yield* Deferred.succeed(chatted, undefined)
          yield* goalWhere(id, isWatching)

          const born = (yield* (yield* Store).events(TrakId.make("child-1")))[0]
          expect(born).toMatchObject({
            _tag: "TrakCreated",
            goal: id,
            mode: "smart",
            owner: "gh:583231",
          })
          expect(yield* goalTags(id)).toEqual([
            "GoalStarted",
            "Replanned",
            "TrakOpened",
            "GoalTurnEnded",
            "GoalActed",
            "GoalTurnEnded",
          ])
          // The second turn carries on the session the first one started.
          const requests = (yield* agentLog).requests
          const first = requests[0]
          const second = askedWith(requests, "Keep going")
          expect(first?.resumeFrom).toBeUndefined()
          expect(second?.resumeFrom).toBe(first?.sessionId)
          expect(first?.cwd).toBe(lib.root)
          expect(first?.toolAccess).toBe("read-only")
          expect(first?.permission).toBe("full")
        }),
      lib,
    )
  })
})

describe("goals side by side", () => {
  // Two goals in one project, each turn told apart by the title a fresh session reads.
  const DOCS_SPEC = specOf("docs", "Write docs", {
    line: "The docs side",
    finished: "Every page is true.",
  })
  const both = library({ root: emptyProject() })
  const SHIP_TURN = /The goal: Ship goals[\s\S]*Open the traks you are confident in/
  const DOCS_TURN = /The goal: Write docs[\s\S]*Open the traks you are confident in/

  it("runs two goals' composer turns at once, and each parks at its own gate", async () => {
    const shipping = Effect.runSync(Deferred.make<void>())
    const writing = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [
        onPromptAfter(SHIP_TURN, Deferred.await(shipping), "Asked about ship."),
        onPromptAfter(DOCS_TURN, Deferred.await(writing), "Asked about docs."),
      ],
      (_id, agentLog) =>
        Effect.gen(function* () {
          const ship = yield* startGoal(SHIP)
          const docs = yield* startGoal(DOCS_SPEC)
          expect(docs).not.toBe(ship)
          // Both turns are running before either is let go.
          yield* untilRunning(ship)
          yield* untilRunning(docs)
          expect((yield* agentLog).requests).toHaveLength(2)

          yield* tool(docs, "escalate", "toolu_docs", ASK)
          yield* Deferred.succeed(writing, undefined)
          const docsParked = yield* goalWhere(docs, atGate)
          expect(docsParked.state).toMatchObject({ _tag: "AtGate", gate: "escalation" })
          expect(yield* runningNow(ship)).toBe(true)

          yield* tool(ship, "replan", "toolu_plan", { traks: [PLANNED, PLANNED], why: "w" })
          yield* tool(ship, "escalate", "toolu_ship", ASK)
          yield* Deferred.succeed(shipping, undefined)
          const shipParked = yield* goalWhere(ship, atGate)
          expect(shipParked.plan).toHaveLength(2)
          expect((yield* goalNow(docs))?.plan).toHaveLength(0)
          expect(yield* goalTags(ship)).toEqual([
            "GoalStarted",
            "Replanned",
            "Escalated",
            "GoalTurnEnded",
          ])
          expect(yield* goalTags(docs)).toEqual(["GoalStarted", "Escalated", "GoalTurnEnded"])
        }),
      both,
    )
  })

  it("drops one goal mid-turn and leaves the other's turn running", async () => {
    const writing = Effect.runSync(Deferred.make<void>())
    await runFlow(
      [hangsOn(SHIP_TURN), onPromptAfter(DOCS_TURN, Deferred.await(writing), "Asked about docs.")],
      () =>
        Effect.gen(function* () {
          const ship = yield* startGoal(SHIP)
          const docs = yield* startGoal(DOCS_SPEC)
          yield* untilRunning(ship)
          yield* untilRunning(docs)

          expect((yield* post(`/${ship}/drop`, { reason: "not now" })).status).toBe(202)
          expect((yield* goalNow(ship))?.state._tag).toBe("Dropped")
          expect(yield* runningNow(ship)).toBe(false)
          expect(yield* runningNow(docs)).toBe(true)

          yield* tool(docs, "escalate", "toolu_docs", ASK)
          yield* Deferred.succeed(writing, undefined)
          const parked = yield* goalWhere(docs, atGate)
          expect(parked.state).toMatchObject({ _tag: "AtGate", gate: "escalation" })
        }),
      both,
    )
  })

  it("starts a goal while another is going, and leaves the first where it was", async () => {
    const shipping = Effect.runSync(Deferred.make<void>())
    const writing = Effect.runSync(Deferred.make<void>())
    await runFlow(
      [
        onPromptAfter(SHIP_TURN, Deferred.await(shipping), "Asked about ship."),
        onPromptAfter(DOCS_TURN, Deferred.await(writing), "Asked about docs."),
      ],
      () =>
        Effect.gen(function* () {
          const ship = yield* startGoal(SHIP)
          yield* tool(ship, "escalate", "toolu_ship", ASK)
          yield* Deferred.succeed(shipping, undefined)
          yield* goalWhere(ship, atGate)

          const docs = yield* startGoal(DOCS_SPEC)
          yield* tool(docs, "escalate", "toolu_docs", ASK)
          yield* Deferred.succeed(writing, undefined)
          yield* goalWhere(docs, atGate)
          expect((yield* goalNow(ship))?.state).toMatchObject({
            _tag: "AtGate",
            gate: "escalation",
          })
          expect(yield* goalTags(ship)).toEqual(["GoalStarted", "Escalated", "GoalTurnEnded"])
        }),
      both,
    )
  })
})

describe("a goal's limits", () => {
  const NARROW = specOf("narrow", "Narrow", {
    limits: { parallel: 1, perDay: 1, modes: ["smart"] },
  })
  const limited = library({ root: emptyProject() })

  it("refuses an open_trak past the mode or parallel limit, and the refusal is the tool result", async () => {
    const opening = Effect.runSync(Deferred.make<void>())
    await runFlow(
      [
        onPromptAfter(STARTED, Deferred.await(opening), "Done for now."),
        hangsOn(/Compose a pipeline/),
      ],
      () =>
        Effect.gen(function* () {
          const id = yield* startGoal(NARROW)
          const auto = yield* tool(id, "open_trak", "t2", { ...PLANNED, mode: "auto" })
          expect(auto).toEqual({
            text: "Refused: the goal allows only smart as a run mode, and this asked for auto.",
            isError: true,
          })
          expect((yield* tool(id, "open_trak", "t3", PLANNED)).isError).toBe(false)
          const second = yield* tool(id, "open_trak", "t4", PLANNED)
          expect(second.text).toContain("1 of your traks are already running")
          expect(second.isError).toBe(true)
          // A refusal appends nothing: one trak opened, by the one call that passed.
          const tags = yield* goalTags(id)
          expect(opensIn(tags)).toBe(1)
          // The arguments are held to the tool's own shape.
          const bad = yield* tool(id, "escalate", "t5", { question: "q", answers: [] })
          expect(bad.isError).toBe(true)
          expect(bad.text).toContain("Refused: the arguments do not fit this tool.")
        }),
      limited,
    )
  })
})

/** What the feed carries for a trak's newest append: the trak its own log replays to. */
const frameOf = (id: TrakId, frameId: number) =>
  Effect.gen(function* () {
    const log = yield* (yield* Store).events(id)
    const framed: Framed = {
      id: frameId,
      frame: Frame.Appended({
        id,
        seq: log.length,
        event: log[log.length - 1] ?? Events.closed(),
        trak: replayHistory(id, log),
      }),
    }
    return framed
  })

/** A trak of the goal whose setup failed — the shortest real log that stands at `Failed`. */
const failedTrak = (id: TrakId, goal: GoalId) =>
  Effect.flatMap(Store, (store) =>
    seedLog(store, id, [
      Events.trakForGoal(`work ${id}`, "smart", goal),
      Events.worktreeFailed("setup failed"),
    ]),
  )

const replayed = (id: TrakId) =>
  Effect.flatMap(Store, (store) => Effect.map(store.events(id), (log) => replayHistory(id, log)))

const woken = (g: Goal): boolean => g.wakes.length > 0 && isWatching(g)
const kindsOf = (g: Goal): readonly string[] =>
  g.wakes.map((w) => `${"trak" in w ? w.trak : w.subgoal}:${w.kind}`)

/** The composer's turn after a wake, answered every time it is asked. */
const READS = { ...onPrompt(/traks needs you/, "Read them."), repeatable: true }

describe("the watcher and the reconcile pass", () => {
  it("files what each trak's log stands at — stuck, failed — and nothing for an approval gate", async () => {
    const goal = GoalId.make("watched")
    const approval = TrakId.make("approval")
    const stuck = TrakId.make("stuck")
    const failed = TrakId.make("failed")
    await runFlow(
      [
        composer("work"),
        composer("review"),
        step(1, "work", reply.artifact("done")),
        step(1, "review", reply.stuck("could not find the file")),
        READS,
      ],
      () =>
        Effect.gen(function* () {
          yield* advance(approval, Events.trakForGoal("approve me", "manual", goal))
          yield* advance(stuck, Events.trakForGoal("get stuck", "manual", goal))
          yield* act(approval, 0, human.approve())
          yield* act(stuck, 0, human.approve())
          yield* failedTrak(failed, goal)
          expect((yield* replayed(approval)).state).toMatchObject({ kind: "approval" })
          expect((yield* replayed(stuck)).state).toMatchObject({ kind: "stuck" })

          yield* watchingGoal(goal, SPEC, [approval, stuck, failed])
          yield* reconcileGoals
          const settled = yield* goalWhere(goal, woken)
          expect(kindsOf(settled)).toEqual(["stuck:stuck", "failed:failed"])
        }),
    )
  })

  it("files a landing the watcher never saw — the engine stopped before it filed — at the next boot", async () => {
    const goal = GoalId.make("landing")
    const landed = TrakId.make("landed")
    await runFlowWithAgentLog([composerFinishes("nothing to do"), READS], (_id, agentLog) =>
      Effect.gen(function* () {
        // Nothing committed, so the trak ends itself even on `manual` — and its goal
        // reads that `Closed` as a landing rather than as a person putting it down.
        yield* advance(landed, Events.trakForGoal("land me", "manual", goal))
        expect((yield* replayed(landed)).state._tag).toBe("Closed")
        // The goal's log never heard: no watcher ran while the trak ended.
        yield* watchingGoal(goal, SPEC, [landed])
        expect(yield* goalNow(goal)).toMatchObject({ wakes: [] })

        yield* reconcileGoals
        const settled = yield* goalWhere(goal, woken)
        expect(kindsOf(settled)).toEqual(["landed:landed"])
        expect(settled.traks).toMatchObject([{ id: landed, status: "landed" }])
        // The wake was owed a turn, and the pass started it.
        expect((yield* agentLog).matched).toContain(READS.label)
      }),
    )
  })

  it("reconciles when a frame is lost, filing the failure the missing frame carried", async () => {
    const goal = GoalId.make("gappy")
    const lost = TrakId.make("lost")
    const going = TrakId.make("going")
    await runFlow([READS], () =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* failedTrak(lost, goal)
        yield* seedLog(store, going, [Events.trakForGoal("still going", "smart", goal)])
        yield* watchingGoal(goal, SPEC, [lost, going])
        // Frame 2 — `lost` failing — was shed by the feed; 1 and 3 are of a trak with
        // nothing to report, so only the gap can bring the failure in.
        yield* watchGoalTraks(Stream.make(yield* frameOf(going, 1), yield* frameOf(going, 3)))
        const settled = yield* goalWhere(goal, woken)
        expect(kindsOf(settled)).toEqual(["lost:failed"])
      }),
    )
  })

  it("files a wake once across a restart, and again only when the trak reaches it anew", async () => {
    const goal = GoalId.make("restarted")
    const flaky = TrakId.make("flaky")
    await runFlow([READS], () =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* failedTrak(flaky, goal)
        yield* watchingGoal(goal, SPEC, [flaky])
        yield* reconcileGoals
        yield* goalWhere(goal, woken)

        // After a restart: a fresh watcher, an append that leaves the trak failed, and
        // the boot pass again. Neither files a second wake.
        yield* seedLog(store, flaky, [Events.holdChanged(true)])
        yield* watchGoalTraks(Stream.make(yield* frameOf(flaky, 1)))
        yield* reconcileGoals
        expect(kindsOf(yield* goalWhere(goal, isWatching))).toEqual(["flaky:failed"])

        // Retried and failed again: a new outcome, so a new wake.
        yield* seedLog(store, flaky, [Events.restarted(undefined), Events.worktreeFailed("again")])
        yield* watchGoalTraks(Stream.make(yield* frameOf(flaky, 2)))
        const again = yield* goalWhere(goal, twoWakes)
        expect(kindsOf(again)).toEqual(["flaky:failed", "flaky:failed"])
      }),
    )
  })
})

const OFF = "Fix the deploy hook, which fires against the wrong host."
/** The goal composer's turn, matched only where the wake lists the hand-off's words. */
const PLACES = onPrompt(
  new RegExp(`handed off work, and nothing was opened for it:\n {2}- ${OFF}`),
  "Placed it in the plan.",
  "goal reads the hand-off",
)
const handedOffIn = (id: TrakId) =>
  Effect.flatMap(Store, (store) =>
    Effect.map(store.events(id), (log) => log.filter((e) => e._tag === "HandedOff")),
  )
/** The auto trak's birth, hoisted: one callback deeper is one too many. */
const bornAutoForGoal = (goal: GoalId) => () => Events.trakForGoal("Check the deploy", "auto", goal)

describe("a hand-off from a goal's trak", () => {
  it("opens nothing when a person approves it at a manual gate, and wakes the goal with it", async () => {
    const goal = GoalId.make("handing")
    const sender = TrakId.make("sender")
    await runFlowWithAgentLog(
      [composerFinishes("Nothing to build on this branch.", [OFF]), PLACES],
      (_id, agentLog) =>
        Effect.gen(function* () {
          yield* watchingGoal(goal, SPEC, [sender])
          const parked = yield* advance(
            sender,
            Events.trakForGoal("Check the deploy", "manual", goal),
          )
          expect(parked.state._tag).toBe("AwaitingProposal")
          // The card at the gate is told the goal, and no branch: nothing is cut.
          const detail = Schema.decodeUnknownSync(TrakDetailDto)(
            yield* jsonOf(yield* call(new Request(`http://localhost/api/traks/${sender}`))),
          )
          expect(detail.handOffGoal).toBe(goal)
          expect(detail.handOffBase).toBeUndefined()
          const done = yield* act(sender, 0, human.approve())
          expect(done.state._tag).toBe("Closed")
          // The gate went past with the hand-off on it, and named no trak to open.
          const [handed, ...more] = yield* handedOffIn(sender)
          expect(more).toEqual([])
          expect(handed).toMatchObject({ step: 0 })
          expect(handed).not.toHaveProperty("ids")
          expect(handed).not.toHaveProperty("base")

          // The watcher, on the frame that carried it.
          const frame: Framed = {
            id: 1,
            frame: Frame.Appended({
              id: sender,
              seq: 1,
              event: handed ?? Events.closed(),
              trak: yield* replayed(sender),
            }),
          }
          yield* watchGoalTraks(Stream.make(frame))
          const settled = yield* goalWhere(goal, woken)
          expect(settled.wakes).toMatchObject([
            { trak: sender, kind: "handedOff", handOff: [OFF] },
            { trak: sender, kind: "landed" },
          ])
          expect((yield* agentLog).matched).toContain(PLACES.label)
          // Filed once: the boot pass and the same frame again add nothing.
          yield* reconcileGoals
          yield* watchGoalTraks(Stream.make(frame))
          expect((yield* goalWhere(goal, isWatching)).wakes).toHaveLength(2)
        }),
    )
  })

  it("is taken on auto, and the daemon opens no trak for it", async () => {
    const goal = GoalId.make("handing-auto")
    const sender = TrakId.make("sender-auto")
    await runFlow([composerFinishes("Nothing to build on this branch.", [OFF])], () =>
      Effect.gen(function* () {
        yield* watchingGoal(goal, SPEC, [sender])
        yield* (yield* Drives).start(sender, bornAutoForGoal(goal))
        yield* idle(sender)
        expect((yield* replayed(sender)).state._tag).toBe("Closed")
        expect(yield* handedOffIn(sender)).toMatchObject([{ step: 0 }])
        expect(yield* (yield* Store).list()).toEqual([sender])
      }),
    )
  })
})

/**
 * The forge's answers about one branch's pull request, at `state`. `asked` is what asking
 * for that one pull request says — `unavailable` for a forge that answers the listing and
 * then cannot be reached.
 */
const forgeAt = (
  branch: string,
  state: "open" | "merged",
  asked: "found" | "unavailable" = "found",
  merging: "clean" | "conflicting" = "clean",
) => {
  const merged = state === "merged" ? { mergeCommit: "9f31c07aa11" } : {}
  const summary = { number: 7, title: "Work", url: "https://forge/pr/7", state, isDraft: false }
  const one =
    asked === "unavailable"
      ? ForgeAnswer.Unavailable({ why: "gh could not be run" })
      : ForgeAnswer.Found({
          pullRequest: {
            ...summary,
            ...merged,
            merging: "clean",
            rollup: "passed",
            checks: [],
            reviews: [],
            conversation: [],
            truncated: [],
            mergeMethods: [],
          },
        })
  return forgeSaying(
    one,
    ForgeListing.Listed({
      entries: [{ branch, pull: { ...summary, ...merged, merging, checks: "passed" } }],
    }),
  )
}

/** Take `id` to `Finished` with a commit on its branch, through both of its gates. */
const finishWithWork = (id: TrakId, event: Event) =>
  Effect.gen(function* () {
    yield* advance(id, event)
    writeWork(worktreeOf(yield* replayed(id)), "flag.ts", "export const json = true\n")
    yield* act(id, 0, human.approve())
    yield* act(id, 1, human.approve())
    expect((yield* replayed(id)).state._tag).toBe("Finished")
  })

const logLength = (id: TrakId) =>
  Effect.map(
    Effect.flatMap(Store, (s) => s.events(id)),
    (l) => l.length,
  )

const WORK = [composer("work"), step(1, "work", reply.artifact("done"))]

/**
 * One tick with a memory of its own. These cases read nothing a tick remembers — every
 * pull request here has its checks passed — so each tick starts empty.
 */
const sweep = Effect.flatMap(sweepMemory, forgeSweep)

describe("the forge sweep", () => {
  const merges = TrakId.make("merges")

  it("archives a goal's trak once its pull request merged, and the goal wakes landed once", async () => {
    const goal = GoalId.make("merging")
    await runFlow(
      [...WORK, READS],
      () =>
        Effect.gen(function* () {
          yield* finishWithWork(merges, Events.trakForGoal("merge me", "manual", goal))
          yield* watchingGoal(goal, SPEC, [merges])

          yield* sweep
          yield* idle(merges)
          expect((yield* replayed(merges)).state).toEqual({ _tag: "Merged", sha: "9f31c07aa11" })
          yield* reconcileGoals
          expect(kindsOf(yield* goalWhere(goal, woken))).toEqual(["merges:landed"])

          // A second tick finds nothing to watch, and the goal hears nothing more.
          const length = yield* logLength(merges)
          yield* sweep
          yield* reconcileGoals
          expect(yield* logLength(merges)).toBe(length)
          expect(kindsOf(yield* goalWhere(goal, isWatching))).toEqual(["merges:landed"])
        }),
      undefined,
      undefined,
      forgeAt("trak/merges", "merged"),
    )
  })

  it("records the merge the listing named, without asking the forge again as it archives", async () => {
    const goal = GoalId.make("unreachable")
    await runFlow(
      [...WORK, READS],
      () =>
        Effect.gen(function* () {
          yield* finishWithWork(merges, Events.trakForGoal("merge me", "manual", goal))
          yield* watchingGoal(goal, SPEC, [merges])

          yield* sweep
          yield* idle(merges)
          // The removal's own ask would have answered `Unavailable` and ended it `Closed`.
          expect((yield* replayed(merges)).state).toEqual({ _tag: "Merged", sha: "9f31c07aa11" })
          yield* reconcileGoals
          expect(kindsOf(yield* goalWhere(goal, woken))).toEqual(["merges:landed"])
        }),
      undefined,
      undefined,
      forgeAt("trak/merges", "merged", "unavailable"),
    )
  })

  it("leaves a goal's trak whose pull request is still open", async () => {
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finishWithWork(merges, Events.trakForGoal("merge me", "manual", GoalId.make("g")))
          const length = yield* logLength(merges)
          yield* sweep
          yield* idle(merges)
          expect(yield* logLength(merges)).toBe(length)
          expect((yield* replayed(merges)).state._tag).toBe("Finished")
        }),
      undefined,
      undefined,
      forgeAt("trak/merges", "open"),
    )
  })

  it("hears a person's archive of a goal's trak that committed work as a drop, not a landing", async () => {
    const goal = GoalId.make("archived")
    await runFlow(WORK, () =>
      Effect.gen(function* () {
        yield* finishWithWork(merges, Events.trakForGoal("archive me", "manual", goal))
        yield* advance(merges, Events.closed())
        expect((yield* replayed(merges)).state._tag).toBe("Closed")
        yield* watchingGoal(goal, SPEC, [merges])
        yield* reconcileGoals
        const settled = yield* goalNow(goal)
        expect(settled?.wakes).toEqual([])
        expect(settled?.traks).toMatchObject([{ id: merges, status: "dropped" }])
      }),
    )
  })

  it("leaves a merged trak outside a goal for its person", async () => {
    await runFlow(
      WORK,
      () =>
        Effect.gen(function* () {
          yield* finishWithWork(merges, Events.trakCreated("merge me", undefined, "manual"))
          const length = yield* logLength(merges)
          yield* sweep
          yield* idle(merges)
          expect(yield* logLength(merges)).toBe(length)
        }),
      undefined,
      undefined,
      forgeAt("trak/merges", "merged"),
    )
  })
})

describe("messaging a goal's finished trak", () => {
  const open = TrakId.make("open")

  // `Finished` is at rest, but its branch has not landed: the pull request is still
  // open, and conflicts with `main` are exactly what the goal has to tell it about.
  it("takes the message, since its branch is not merged", async () => {
    const goal = GoalId.make("unmerged")
    const message = "Merge `origin/main` into this branch and resolve the conflicts."
    await runFlow([...WORK, hangsOn(STARTED)], () =>
      Effect.gen(function* () {
        yield* finishWithWork(open, Events.trakForGoal("ship it", "manual", goal))
        // Inside a composer turn, which is the only place a tool call is heard.
        yield* seedLog(yield* GoalStore, goal, [
          GoalEvents.started(SPEC),
          GoalEvents.trakOpened("c2", open, open, "manual"),
        ])

        const result = yield* tool(goal, "message_trak", "m1", { trak: open, message })
        expect(result.text).not.toMatch(/^Refused/)
        expect(result.isError).toBe(false)
        expect(yield* goalTags(goal)).toContain("TrakMessaged")
        const log = yield* (yield* Store).events(open)
        expect(JSON.stringify(log)).toContain(message)
      }),
    )
  })

  it("refuses it once the branch has merged", async () => {
    const goal = GoalId.make("landed")
    await runFlow([...WORK, hangsOn(STARTED)], () =>
      Effect.gen(function* () {
        yield* finishWithWork(open, Events.trakForGoal("ship it", "manual", goal))
        const sha = CommitSha.make("9f31c07aa11")
        yield* seedLog(yield* Store, open, [
          Events.merged(),
          Events.workMerged(sha),
          Events.worktreeRemoved(),
        ])
        expect((yield* replayed(open)).state).toEqual({ _tag: "Merged", sha })
        yield* seedLog(yield* GoalStore, goal, [
          GoalEvents.started(SPEC),
          GoalEvents.trakOpened("c2", open, open, "manual"),
        ])

        const result = yield* tool(goal, "message_trak", "m1", { trak: open, message: "Rebase." })
        expect(result.text).toMatch(/^Refused: `open` is not one of this goal's running traks/)
        expect(yield* goalTags(goal)).not.toContain("TrakMessaged")
      }),
    )
  })
})

describe("auto-merge on a goal's trak", () => {
  const merges = TrakId.make("merges")

  it("stops sending an auto-merging trak back after three, and its goal wakes stuck", async () => {
    const goal = GoalId.make("stopping")
    // The trak's own composer, sent back for the conflict, finding nothing to do.
    const resolves = {
      ...onPrompt(/conflicting with its base branch/, reply.finished("nothing conflicts here")),
      repeatable: true,
    }
    await runFlow(
      [...WORK, resolves, READS],
      () =>
        Effect.gen(function* () {
          const born = Events.trakForGoal("merge me", "manual", goal, undefined, true)
          yield* finishWithWork(merges, born)
          yield* watchingGoal(goal, SPEC, [merges])
          for (const sent of [1, 2, 3]) {
            yield* sweep
            yield* idle(merges)
            expect((yield* replayed(merges)).autoMerge?.sentBack).toBe(sent)
          }
          yield* sweep
          yield* idle(merges)
          const stopped = yield* replayed(merges)
          expect(stopped.state._tag).toBe("Finished")
          expect(stopped.autoMerge).toEqual({ sentBack: 3, stopped: { _tag: "Conflict" } })
          yield* reconcileGoals
          expect(kindsOf(yield* goalWhere(goal, woken))).toEqual(["merges:stuck"])

          // Stopped is stopped: the next tick sends nothing.
          const length = yield* logLength(merges)
          yield* sweep
          yield* idle(merges)
          expect(yield* logLength(merges)).toBe(length)
        }),
      undefined,
      undefined,
      forgeAt("trak/merges", "open", "found", "conflicting"),
    )
  })
})

const gitIn = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

/**
 * GitHub's half: a bare `origin` for `repoDir`, and a pull request merged into it from a
 * clone `repoDir` has not fetched since. Answers the directory to remove afterwards.
 */
const mergedOnOrigin = (repoDir: string): string => {
  const around = mkdtempSync(join(tmpdir(), "orkestra-origin-"))
  const origin = join(around, "origin.git")
  gitIn(around, "init", "-q", "--bare", "--initial-branch=main", origin)
  gitIn(repoDir, "remote", "add", "origin", origin)
  gitIn(repoDir, "push", "-q", "origin", "main")
  gitIn(repoDir, "remote", "set-head", "origin", "main")
  const other = join(around, "other")
  gitIn(around, "clone", "-q", origin, other)
  writeFileSync(join(other, "merged.ts"), "export const merged = true\n")
  gitIn(other, "add", "-A")
  gitIn(other, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "merged")
  gitIn(other, "push", "-q", "origin", "HEAD:main")
  return around
}

const setUp = (tags: readonly string[]): boolean => tags.includes("WorktreeReady")

describe("what a goal's trak is cut from", () => {
  it("fetches, then cuts from `origin/<default>`, leaving the project checkout where it was", async () => {
    await onGit.runFlow([hangsOn(/Compose a pipeline/)], (_id, _agents, _checks, repoDir) =>
      Effect.gen(function* () {
        const around = mergedOnOrigin(repoDir)
        const host = gitIn(repoDir, "rev-parse", "main")

        const opened = yield* Effect.orDie(
          openTrak("Build on the merge", "smart", GoalId.make("g")),
        )
        expect(opened._tag).toBe("Opened")
        if (opened._tag !== "Opened") return
        yield* logged(opened.id, setUp)
        const [born] = yield* (yield* Store).events(opened.id)
        expect(born).toMatchObject({ _tag: "TrakCreated", base: "origin/main" })
        const trak = yield* replayed(opened.id)
        expect(existsSync(join(worktreeOf(trak).path, "merged.ts"))).toBe(true)
        // Fetched, never pulled: the person's branch and tree are as they were.
        expect(gitIn(repoDir, "rev-parse", "main")).toBe(host)
        expect(existsSync(join(repoDir, "merged.ts"))).toBe(false)
        rmSync(around, { recursive: true, force: true })
      }),
    )
  })
})

describe("dropping a goal", () => {
  it("never runs a turn the drop raced: the turn starts under the permit the drop holds", async () => {
    const goal = GoalId.make("raced")
    await runFlowWithAgentLog([READS], (_id, agentLog) =>
      Effect.gen(function* () {
        yield* watchingGoal(goal, SPEC, [])
        yield* seedLog(yield* GoalStore, goal, [GoalEvents.trakWoke(TrakId.make("x"), "failed", 2)])
        // The turn is owed, and asked for while the drop holds the goal's permit.
        yield* (yield* Locks).withGoal(goal)(kickThenDrop(goal))
        yield* goalWhere(goal, isDropped)
        yield* Effect.sleep("50 millis")
        expect((yield* agentLog).requests).toHaveLength(0)
      }),
    )
  })
})

describe("a goal's rate", () => {
  const RATED = specOf("rated", "Rated", { limits: { perHour: 1 } })
  const rated = library({ root: emptyProject() })

  it("refuses an open_trak past the hourly limit, whatever is still running", async () => {
    const opening = Effect.runSync(Deferred.make<void>())
    await runFlow(
      [
        onPromptAfter(STARTED, Deferred.await(opening), "Done for now."),
        { ...hangsOn(/Compose a pipeline/), repeatable: true },
      ],
      () =>
        Effect.gen(function* () {
          const id = yield* startGoal(RATED)
          expect((yield* tool(id, "open_trak", "t2", PLANNED)).isError).toBe(false)
          expect(yield* tool(id, "open_trak", "t3", PLANNED)).toEqual({
            text: "Refused: 1 traks were opened in the last hour, which is the goal's limit. Wait for the hour to pass.",
            isError: true,
          })
        }),
      rated,
    )
  })
})

describe("a goal's limit on auto-merge", () => {
  const HELD = specOf("held", "Held", { limits: { autoMerge: "never" } })
  const held = library({ root: emptyProject() })

  it("refuses an open_trak with auto-merge on, and opens the same trak without it", async () => {
    const opening = Effect.runSync(Deferred.make<void>())
    await runFlow(
      [
        onPromptAfter(STARTED, Deferred.await(opening), "Done for now."),
        { ...hangsOn(/Compose a pipeline/), repeatable: true },
      ],
      () =>
        Effect.gen(function* () {
          const id = yield* startGoal(HELD)
          expect(yield* tool(id, "open_trak", "t2", { ...PLANNED, auto_merge: true })).toEqual({
            text: "Refused: the goal does not let a trak merge its own pull request. Open it without `auto_merge`; its pull request then waits for the person.",
            isError: true,
          })
          expect(yield* (yield* Store).list()).toEqual([])
          expect((yield* tool(id, "open_trak", "t3", PLANNED)).isError).toBe(false)
        }),
      held,
    )
  })
})

describe("pause and resume", () => {
  it("holds every live trak but a manual one, takes no turn, and resumes with one", async () => {
    const goal = GoalId.make("paused")
    const smart = TrakId.make("smart-one")
    const manual = TrakId.make("manual-one")
    await runFlowWithAgentLog([onPrompt(/resumed the goal/, "Carried on.")], (_id, agentLog) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, smart, [Events.trakForGoal("smart work", "smart", goal)])
        yield* seedLog(store, manual, [Events.trakForGoal("manual work", "manual", goal)])
        yield* watchingGoal(goal, SPEC, [smart, manual])

        expect((yield* post(`/${goal}/pause`, {})).status).toBe(204)
        expect(yield* holding(smart)).toBe(true)
        expect(yield* holding(manual)).toBe(false)
        expect((yield* goalNow(goal))?.held).toEqual([smart])

        // A failure while paused is filed and starts no turn.
        yield* seedLog(store, smart, [Events.worktreeFailed("setup failed")])
        yield* watchGoalTraks(Stream.make(yield* frameOf(smart, 1)))
        const waiting = yield* goalWhere(goal, oneWake)
        expect(waiting.state._tag).toBe("Composing")
        expect((yield* agentLog).requests).toHaveLength(0)

        expect((yield* post(`/${goal}/resume`, {})).status).toBe(204)
        expect(yield* holding(smart)).toBe(false)
        const resumed = yield* goalWhere(goal, isWatching)
        expect(resumed.paused).toBe(false)
        expect((yield* agentLog).matched).toEqual([String(/resumed the goal/)])
        expect(yield* goalTags(goal)).toEqual([
          "GoalStarted",
          "TrakOpened",
          "TrakOpened",
          "GoalTurnEnded",
          "GoalPaused",
          "TrakWoke",
          "GoalResumed",
          "GoalTurnEnded",
        ])
      }),
    )
  })
})

describe("dropping a paused goal", () => {
  it("takes the pause's holds off, leaves its live trak going, and takes no turn", async () => {
    const goal = GoalId.make("paused-drop")
    const trak = TrakId.make("kept-one")
    await runFlowWithAgentLog([], (_id, agentLog) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, trak, [Events.trakForGoal("kept work", "smart", goal)])
        yield* watchingGoal(goal, SPEC, [trak])
        expect((yield* post(`/${goal}/pause`, {})).status).toBe(204)
        expect(yield* holding(trak)).toBe(true)

        expect((yield* post(`/${goal}/drop`, { reason: "no longer wanted" })).status).toBe(202)
        expect((yield* goalNow(goal))?.state).toEqual({
          _tag: "Dropped",
          reason: "no longer wanted",
        })
        expect(yield* holding(trak)).toBe(false)
        const kept = replayHistory(trak, yield* store.events(trak))
        expect(atRest(kept.state)).toBe(false)
        yield* Effect.sleep("50 millis")
        expect(yield* runningNow(goal)).toBe(false)
        expect((yield* agentLog).requests).toHaveLength(0)
        expect((yield* post(`/${goal}/drop`, { reason: "again" })).status).toBe(409)
      }),
    )
  })
})

const DRAFTED = {
  name: "search-everywhere",
  title: "Search everywhere",
  line: "Find any trak by typing",
  finished: "One box finds every trak.",
  parallel: 2,
}

/** The project's commit and every path git sees as changed or untracked, for a before and after. */
const repoState = (repoDir: string) => ({
  head: gitIn(repoDir, "rev-parse", "HEAD"),
  status: gitIn(repoDir, "status", "--porcelain", "--untracked-files=all"),
})

/** Start a goal from a sentence, through the route a person's page presses. */
const askGoal = (modes: readonly string[]) =>
  Effect.gen(function* () {
    const started = yield* post("", { asked: "Make search work", modes })
    expect(started.status).toBe(202)
    return GoalId.make(Schema.decodeUnknownSync(CreatedDto)(yield* jsonOf(started)).id)
  })

describe("a goal started from a sentence", () => {
  it("drafts its spec, and approving the draft writes nothing to git and opens traks with no other gate", async () => {
    const drafting = Effect.runSync(Deferred.make<void>())
    const planning = Effect.runSync(Deferred.make<void>())
    await onGit.runFlow(
      [
        onPromptAfter(/weigh what the sentence leaves open/, Deferred.await(drafting), "Drafted."),
        onPromptAfter(
          /approved the goal file\. Open the traks you are confident in/,
          Deferred.await(planning),
          "Opened the first trak.",
        ),
        hangsOn(/Compose a pipeline/),
      ],
      (_id, _agents, _checks, repoDir) =>
        Effect.gen(function* () {
          const id = yield* askGoal(["smart", "auto"])

          // Nothing but the draft while there is no spec.
          expect((yield* tool(id, "open_trak", "toolu_o0", PLANNED)).isError).toBe(true)
          expect((yield* tool(id, "draft_goal", "toolu_d", DRAFTED)).isError).toBe(false)
          yield* Deferred.succeed(drafting, undefined)
          const parked = yield* goalWhere(id, atGate)
          expect(parked.state).toMatchObject({ _tag: "AtGate", gate: "file" })
          expect(parked.draft?.limits).toEqual({ parallel: 2, modes: ["smart", "auto"] })

          const before = repoState(repoDir)
          expect((yield* post(`/${id}/act`, { _tag: "Approve" })).status).toBe(202)
          expect(repoState(repoDir)).toEqual(before)
          expect(existsSync(join(repoDir, ".orkestra", "goals"))).toBe(false)

          // The spec is the goal's now: never drafted again.
          expect((yield* tool(id, "draft_goal", "toolu_d2", DRAFTED)).isError).toBe(true)
          // The turn the approval owes opens a trak, and nobody is asked first.
          expect((yield* tool(id, "open_trak", "toolu_o1", PLANNED)).isError).toBe(false)
          yield* Deferred.succeed(planning, undefined)
          const planned = yield* goalWhere(id, filed)
          expect(planned.spec).toMatchObject({
            file: "search-everywhere",
            title: "Search everywhere",
            finished: "One box finds every trak.",
          })
          expect(planned.traks).toHaveLength(1)
          expect(yield* goalTags(id)).toEqual([
            "GoalAsked",
            "GoalDrafted",
            "GoalTurnEnded",
            "GoalActed",
            "TrakOpened",
            "GoalTurnEnded",
          ])
          expect(repoState(repoDir)).toEqual(before)

          // Dismissing is for a goal at rest.
          expect((yield* post(`/${id}/dismiss`, {})).status).toBe(409)
          expect((yield* post(`/${id}/drop`, { reason: "enough" })).status).toBe(202)
          expect((yield* post(`/${id}/dismiss`, {})).status).toBe(204)
          expect((yield* goalNow(id))?.dismissed).toBe(true)
        }),
    )
  })

  it("refuses a start that names a file, and records no goal", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const response = yield* post("", { file: "ship" })
        expect(response.status).toBe(400)
        expect(yield* (yield* GoalStore).list()).toEqual([])
      }),
    )
  })

  it("refuses a draft named as another goal is, and appends nothing", async () => {
    await runFlow([hangsOn(/weigh what the sentence leaves open/)], () =>
      Effect.gen(function* () {
        yield* startGoal(specOf("search-everywhere", "Search, the first time"))
        const id = yield* askGoal(["smart"])
        yield* untilRunning(id)
        const before = (yield* (yield* GoalStore).events(id)).length
        expect(yield* tool(id, "draft_goal", "toolu_d", DRAFTED)).toEqual({
          text: "Refused: another goal in this project is already named `search-everywhere`. Pick another name.",
          isError: true,
        })
        expect((yield* (yield* GoalStore).events(id)).length).toBe(before)
        expect(
          (yield* tool(id, "draft_goal", "toolu_d2", { ...DRAFTED, name: "search" })).isError,
        ).toBe(false)
      }),
    )
  })
})

describe("the drafted spec's limits", () => {
  it("makes the limits the person set on Approve the spec's", async () => {
    const drafting = Effect.runSync(Deferred.make<void>())
    const planning = Effect.runSync(Deferred.make<void>())
    await runFlow(
      [
        onPromptAfter(/weigh what the sentence leaves open/, Deferred.await(drafting), "Drafted."),
        onPromptAfter(/approved the goal file/, Deferred.await(planning), "Planning next."),
      ],
      () =>
        Effect.gen(function* () {
          const id = yield* askGoal(["smart", "auto"])
          yield* tool(id, "draft_goal", "toolu_d", DRAFTED)
          yield* Deferred.succeed(drafting, undefined)
          yield* goalWhere(id, atGate)

          // `parallel` left as the composer drafted it; the rest changed.
          const limits = { parallel: 2, perDay: 5, modes: ["smart"], autoMerge: "always" }
          expect((yield* post(`/${id}/act`, { _tag: "Approve", limits })).status).toBe(202)
          yield* Deferred.succeed(planning, undefined)
          expect((yield* goalWhere(id, filed)).spec?.limits).toEqual(limits)
        }),
    )
  })
})

describe("the drafted spec's goal branch", () => {
  it("carries the branch the composer proposed, as the person changed it, into the spec and origin", async () => {
    const drafting = Effect.runSync(Deferred.make<void>())
    await onGit.runFlow(
      [
        onPromptAfter(/weigh what the sentence leaves open/, Deferred.await(drafting), "Drafted."),
        hangsOn(/approved the goal file/),
      ],
      (_id, _agents, _checks, repoDir) =>
        Effect.gen(function* () {
          const around = mergedOnOrigin(repoDir)
          const id = yield* askGoal(["smart"])
          const proposed = { ...DRAFTED, branch: "goal/search" }
          expect((yield* tool(id, "draft_goal", "toolu_d", proposed)).isError).toBe(false)
          yield* Deferred.succeed(drafting, undefined)
          expect((yield* goalWhere(id, atGate)).draft?.branch).toBe("goal/search")

          const approve = { _tag: "Approve", limits: { parallel: 2 }, branch: "goal/mine" }
          expect((yield* post(`/${id}/act`, approve)).status).toBe(202)
          expect((yield* goalNow(id))?.spec?.branch).toBe("goal/mine")
          const origin = join(around, "origin.git")
          expect(gitIn(origin, "rev-parse", "goal/mine")).toBe(gitIn(origin, "rev-parse", "main"))
          rmSync(around, { recursive: true, force: true })
        }),
    )
  })
})

/** The body of the next notification the goal drivers sent. */
const told = Effect.flatMap(PushSent, Queue.take).pipe(Effect.map((p) => p.body))

describe("a goal's scoping round", () => {
  const SEARCH = {
    name: "search-everywhere",
    title: "Search everywhere",
    line: "Find any trak by typing",
    finished: "One box finds every trak.",
  }

  it("asks its scope before any draft, and the answers reach the turn that drafts", async () => {
    const asking = Effect.runSync(Deferred.make<void>())
    const drafting = Effect.runSync(Deferred.make<void>())
    const SCOPE = [
      {
        question: "How far does it go?",
        options: [
          { label: "Traks only", description: "Smallest.", recommended: true },
          { label: "Traks and goals" },
        ],
      },
      { question: "Is the archive in?", context: "It has its own list.", options: [] },
      { question: "Typed or fuzzy?", options: [{ label: "typed" }, { label: "fuzzy" }] },
    ]
    await onGit.runFlow(
      [
        onPromptAfter(/weigh what the sentence leaves open/, Deferred.await(asking), "Asked."),
        onPromptAfter(
          /1\. How far does it go\? — Traks only\n2\. Is the archive in\? — no\n3\. Typed or fuzzy\? — fuzzy[\s\S]*by Friday/,
          Deferred.await(drafting),
          "Drafted the file.",
        ),
      ],
      (_id, _agents, _checks, repoDir) =>
        Effect.gen(function* () {
          const started = yield* post("", { asked: "Make search work", modes: ["smart"] })
          const id = GoalId.make(Schema.decodeUnknownSync(CreatedDto)(yield* jsonOf(started)).id)
          expect((yield* tool(id, "escalate", "toolu_e", { questions: SCOPE })).isError).toBe(false)
          yield* Deferred.succeed(asking, undefined)
          const parked = yield* goalWhere(id, atGate)
          expect(parked.state).toMatchObject({ _tag: "AtGate", gate: "escalation" })
          expect(parked.draft).toBeUndefined()
          expect(parked.escalation?.questions).toHaveLength(3)
          expect(yield* told).toBe("Make search work has a question for you")

          const answer = { answers: ["Traks only", "no", "fuzzy"], note: "by Friday" }
          expect((yield* post(`/${id}/act`, { _tag: "Answer", ...answer })).status).toBe(202)
          expect((yield* tool(id, "draft_goal", "toolu_d", SEARCH)).isError).toBe(false)
          yield* Deferred.succeed(drafting, undefined)
          const filing = yield* goalWhere(id, atGate)
          expect(filing.state).toMatchObject({ _tag: "AtGate", gate: "file" })
        }).pipe(
          Effect.provideServiceEffect(
            Lib,
            Effect.map(Lib, (held) => ({ ...held, root: repoDir })),
          ),
        ),
    )
  })

  it("asks for work by hand before any draft, and the turn that hears the report drafts", async () => {
    const asking = Effect.runSync(Deferred.make<void>())
    const hearing = Effect.runSync(Deferred.make<void>())
    const REQUEST = {
      title: "Grant the search index access",
      steps: ["Open the index's console", "Add the project's key as a reader"],
      why: "No trak can read the index without it.",
    }
    await onGit.runFlow(
      [
        onPromptAfter(/weigh what the sentence leaves open/, Deferred.await(asking), "Asked."),
        onPromptAfter(
          /\*\*Grant the search index access\*\*\n\n1\. Open the index's console\n2\. Add the project's key as a reader[\s\S]*They report they could not do it\.[\s\S]*No admin rights[\s\S]*Draft the goal file with `draft_goal` now, around what could not be done/,
          Deferred.await(hearing),
          "Heard.",
        ),
      ],
      (_id, _agents, _checks, repoDir) =>
        Effect.gen(function* () {
          const started = yield* post("", { asked: "Make search work", modes: ["smart"] })
          const id = GoalId.make(Schema.decodeUnknownSync(CreatedDto)(yield* jsonOf(started)).id)
          expect((yield* tool(id, "request_action", "toolu_r", REQUEST)).isError).toBe(false)
          yield* Deferred.succeed(asking, undefined)
          const parked = yield* goalWhere(id, atGate)
          expect(parked.state).toMatchObject({ _tag: "AtGate", gate: "action" })
          expect(parked.action).toMatchObject(REQUEST)
          expect(yield* told).toBe("Make search work needs you to do something")

          const report = { _tag: "Reported", done: false, note: "No admin rights" }
          expect((yield* post(`/${id}/act`, report)).status).toBe(202)
          // The report turn is told to draft, and drafting leaves the goal at its file gate
          // rather than watching with no file.
          expect((yield* tool(id, "draft_goal", "toolu_d", SEARCH)).isError).toBe(false)
          yield* Deferred.succeed(hearing, undefined)
          const filing = yield* goalWhere(id, atGate)
          expect(filing.state).toMatchObject({ _tag: "AtGate", gate: "file" })
          expect(filing.action).toBeUndefined()
        }).pipe(
          Effect.provideServiceEffect(
            Lib,
            Effect.map(Lib, (held) => ({ ...held, root: repoDir })),
          ),
        ),
    )
  })
})

const turnEnded = (g: Goal): boolean => g.session !== undefined

/** The lines the host's servers left on a goal's transcript, as `[position, text]`. */
const mcpNotes = (entries: readonly TranscriptEntry[]) =>
  entries.flatMap((e) =>
    e._tag === "Note" && e.text.startsWith("MCP server") ? [[e.position, e.text]] : [],
  )

describe("a goal's composer on an engine whose host lists MCP servers", () => {
  const listing = hostListing(
    Either.right([
      DeclaredServer.Http({
        name: "linear",
        url: "https://mcp.linear.app/mcp",
        headers: { Authorization: "Bearer ${LINEAR_API_KEY}" },
      }),
      DeclaredServer.Stdio({ name: "files", command: "files-mcp", args: [], env: {} }),
    ]),
  )

  it("dials them, and a server with an unset secret is left out with a note", async () => {
    await runFlowWithAgentLog(
      [onPrompt(STARTED, "Reading the code first.")],
      (_id, agentLog) =>
        Effect.gen(function* () {
          const id = yield* startGoal(SHIP)
          yield* goalWhere(id, turnEnded)
          const [turn] = (yield* agentLog).requests
          // A flow answers the goal's tool calls itself, so the engine adds no server of its own.
          expect(turn?.mcpServers).toEqual({
            files: McpServer.Stdio({ command: "files-mcp", args: [], env: {} }),
          })
          const notes = mcpNotes(yield* (yield* GoalStore).transcript(id))
          expect(notes).toEqual([
            [
              "composer",
              "MCP server `linear` was left out of this turn: the secret `LINEAR_API_KEY` is not set in the engine's environment.",
            ],
          ])
        }),
      library({ root: lib.root }),
      undefined,
      undefined,
      undefined,
      listing,
    )
  })
})

const replacing = (goal: GoalId, limits: unknown) =>
  Effect.map(post(`/${goal}/settings`, limits), (response) => response.status)
const autoMerging = (t: TrakId) => Effect.map(replayed(t), (trak) => trak.autoMerge !== undefined)
const trakTags = (t: TrakId) =>
  Effect.flatMap(Store, (store) => Effect.map(store.events(t), (log) => log.map((e) => e._tag)))

describe("a running goal's settings", () => {
  it("lands on the goal's log alone, starts no turn, and reaches each live trak's auto-merge", async () => {
    const goal = GoalId.make("tuned")
    const one = TrakId.make("tuned-one")
    const two = TrakId.make("tuned-two")
    await runFlowWithAgentLog([], (_id, agentLog) =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, one, [Events.trakForGoal("one", "smart", goal)])
        yield* seedLog(store, two, [Events.trakForGoal("two", "smart", goal, undefined, true)])
        yield* watchingGoal(goal, SPEC, [one, two])

        expect(yield* replacing(goal, { parallel: 1, autoMerge: "always" })).toBe(204)
        expect((yield* goalNow(goal))?.spec?.limits).toEqual({ parallel: 1, autoMerge: "always" })
        expect([yield* autoMerging(one), yield* autoMerging(two)]).toEqual([true, true])
        // The one already merging itself is left alone rather than turned on twice.
        expect(yield* trakTags(two)).not.toContain("AutoMergeChanged")

        // Composer decides leaves each trak as it is.
        expect(yield* replacing(goal, { parallel: 1 })).toBe(204)
        expect([yield* autoMerging(one), yield* autoMerging(two)]).toEqual([true, true])

        expect(yield* replacing(goal, { autoMerge: "never" })).toBe(204)
        expect([yield* autoMerging(one), yield* autoMerging(two)]).toEqual([false, false])

        expect((yield* agentLog).requests).toHaveLength(0)
        expect((yield* goalTags(goal)).slice(-3)).toEqual([
          "GoalSettingsChanged",
          "GoalSettingsChanged",
          "GoalSettingsChanged",
        ])
        expect(yield* replacing(GoalId.make("nobody"), {})).toBe(404)
        yield* seedLog(yield* GoalStore, goal, [GoalEvents.dropped("enough")])
        expect(yield* replacing(goal, {})).toBe(409)
      }),
    )
  })

  const open = library({ root: emptyProject() })

  it("judges the next open_trak by the new limits, and Always opens it merging itself", async () => {
    const opening = Effect.runSync(Deferred.make<void>())
    await runFlow(
      [
        onPromptAfter(STARTED, Deferred.await(opening), "Done for now."),
        { ...hangsOn(/Compose a pipeline/), repeatable: true },
      ],
      () =>
        Effect.gen(function* () {
          const id = yield* startGoal(specOf("open", "Open"))

          expect(yield* replacing(id, { parallel: 1, autoMerge: "always" })).toBe(204)
          const first = yield* tool(id, "open_trak", "t2", PLANNED)
          expect(first.isError).toBe(false)
          const [opened] = yield* (yield* Store).list()
          if (opened === undefined) return yield* Effect.die("no trak opened")
          expect(yield* autoMerging(opened)).toBe(true)
          const second = yield* tool(id, "open_trak", "t3", PLANNED)
          expect(second.text).toContain("1 of your traks are already running")
        }),
      open,
    )
  })
})

/** A forge keeping every pull request it is asked to open, answering each with the next of `answers`. */
const forgeOpening = (...answers: readonly ForgeOpen[]) => {
  const opened: { head: string; base: string; title: string; body: string }[] = []
  const layer = Layer.succeed(Forge, {
    pullRequest: () => Effect.succeed(ForgeAnswer.None()),
    listing: () => Effect.succeed(ForgeListing.Listed({ entries: [] })),
    merge: refusesMerge,
    openPullRequest: (head, base, title, body) =>
      Effect.sync(() => {
        opened.push({ head, base, title, body })
        return answers[opened.length - 1] ?? ForgeOpen.Opened({ url: "https://example.invalid/1" })
      }),
  })
  return { opened, layer }
}

const GOAL_BRANCH = "goal/ship"
const atDone = (g: Goal): boolean => g.state._tag === "AtGate" && g.state.gate === "done"
const isDone = (g: Goal): boolean => g.state._tag === "Done"

/** A goal on a goal branch, at its done gate — written straight to its log. */
const doneGoal = (id: GoalId) =>
  Effect.flatMap(GoalStore, (store) =>
    seedLog(store, id, [
      GoalEvents.started({
        ...SPEC,
        title: "Ship goals",
        finished: "Goals ship.",
        branch: GOAL_BRANCH,
      }),
      GoalEvents.doneProposed("c2", "All of it landed."),
      GoalEvents.turnEnded(SESSION, 0, undefined),
    ]),
  )

/** The draft a sentence's first turn files, proposing the goal branch. */
const BRANCHED = { ...DRAFTED, branch: GOAL_BRANCH }

describe("a goal with a goal branch", () => {
  it("makes the branch on origin at its approval, and cuts its traks from it", async () => {
    const drafting = Effect.runSync(Deferred.make<void>())
    await onGit.runFlow(
      [
        onPromptAfter(/weigh what the sentence leaves open/, Deferred.await(drafting), "Drafted."),
        hangsOn(STARTED),
        hangsOn(/Compose a pipeline/),
      ],
      (_id, _agents, _checks, repoDir) =>
        Effect.gen(function* () {
          const around = mergedOnOrigin(repoDir)
          const goal = yield* askGoal(["smart"])
          yield* tool(goal, "draft_goal", "toolu_d", BRANCHED)
          yield* Deferred.succeed(drafting, undefined)
          yield* goalWhere(goal, atGate)
          expect((yield* post(`/${goal}/act`, { _tag: "Approve" })).status).toBe(202)
          const origin = join(around, "origin.git")
          expect(gitIn(origin, "rev-parse", GOAL_BRANCH)).toBe(gitIn(origin, "rev-parse", "main"))

          const opened = yield* Effect.orDie(
            openTrak("Build on it", "smart", goal, false, BranchName.make(GOAL_BRANCH)),
          )
          expect(opened._tag).toBe("Opened")
          if (opened._tag !== "Opened") return
          yield* logged(opened.id, setUp)
          const [born] = yield* (yield* Store).events(opened.id)
          expect(born).toMatchObject({
            _tag: "TrakCreated",
            base: `origin/${GOAL_BRANCH}`,
            goalBranch: GOAL_BRANCH,
          })
          rmSync(around, { recursive: true, force: true })
        }),
    )
  })

  it("refuses the approval where the branch cannot be made, and appends nothing", async () => {
    const drafting = Effect.runSync(Deferred.make<void>())
    await runFlow(
      [onPromptAfter(/weigh what the sentence leaves open/, Deferred.await(drafting), "Drafted.")],
      () =>
        Effect.gen(function* () {
          const goal = yield* askGoal(["smart"])
          yield* tool(goal, "draft_goal", "toolu_d", BRANCHED)
          yield* Deferred.succeed(drafting, undefined)
          yield* goalWhere(goal, atGate)
          const before = (yield* (yield* GoalStore).events(goal)).length
          const response = yield* post(`/${goal}/act`, { _tag: "Approve" })
          expect(response.status).toBe(409)
          expect(yield* jsonOf(response)).toMatchObject({ _tag: "GoalBranchRefused" })
          expect((yield* (yield* GoalStore).events(goal)).length).toBe(before)
          expect((yield* goalNow(goal))?.state).toMatchObject({ _tag: "AtGate", gate: "file" })
        }),
    )
  })

  it("opens one pull request into the default branch at Confirm, and a refusal leaves it at the gate", async () => {
    const forge = forgeOpening(ForgeOpen.Refused({ why: "the forge is down" }))
    await onGit.runFlow(
      [],
      (_id, _agents, _checks, repoDir) =>
        Effect.gen(function* () {
          const around = mergedOnOrigin(repoDir)
          const id = GoalId.make("ship-1")
          yield* doneGoal(id)
          const before = (yield* (yield* GoalStore).events(id)).length

          const refused = yield* post(`/${id}/act`, { _tag: "Confirm" })
          expect(refused.status).toBe(409)
          const said = yield* jsonOf(refused)
          expect(said).toMatchObject({ _tag: "GoalBranchRefused" })
          expect(JSON.stringify(said)).toContain("the forge is down")
          expect((yield* (yield* GoalStore).events(id)).length).toBe(before)
          expect(atDone(yield* goalWhere(id, atDone))).toBe(true)

          expect((yield* post(`/${id}/act`, { _tag: "Confirm" })).status).toBe(202)
          yield* goalWhere(id, isDone)
          const sent = { head: GOAL_BRANCH, base: "main", title: "Ship goals", body: "Goals ship." }
          expect(forge.opened).toEqual([sent, sent])
          rmSync(around, { recursive: true, force: true })
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })
})

const SAID = "Also keep the old flag working."
const said = (id: GoalId) => post(`/${id}/act`, { _tag: "Chat", message: SAID })
const waitingOf = (id: GoalId) =>
  Effect.map(goalNow(id), (g) => (g?.messages ?? []).map((m) => m.message))
const messageTags = (tags: readonly string[]) => tags.filter((t) => t.startsWith("GoalMessage"))
const entryTags = (id: GoalId) =>
  Effect.flatMap(GoalStore, (store) =>
    Effect.map(store.transcript(id), (lines) => lines.map((l) => l._tag)),
  )
const quietlyWatching = (g: Goal): boolean => isWatching(g) && g.messages.length === 0
const answeredOne = (g: Goal): boolean => isWatching(g) && g.read === 1

describe("a message sent while the composer works", () => {
  it("is heard by the running turn, and owes no turn of its own", async () => {
    const release = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [{ ...onPromptAfter(STARTED, Deferred.await(release), "Planned."), hears: true }],
      (_id, agentLog) =>
        Effect.gen(function* () {
          const id = yield* startGoal(SHIP)
          yield* untilRunning(id)
          expect((yield* said(id)).status).toBe(202)
          expect(yield* waitingOf(id)).toEqual([SAID])

          yield* Deferred.succeed(release, undefined)
          const settled = yield* goalWhere(id, isWatching)
          expect(settled.messages).toEqual([])
          const tags = yield* goalTags(id)
          expect(messageTags(tags)).toEqual(["GoalMessageWaiting", "GoalMessageHeard"])
          expect(tags).not.toContain("GoalActed")
          expect((yield* agentLog).requests).toHaveLength(1)
          expect(yield* entryTags(id)).toContain("Said")
        }),
      lib,
    )
  })

  it("becomes the next turn's chat when the running turn cannot take it", async () => {
    const release = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [
        onPromptAfter(STARTED, Deferred.await(release), "Planned."),
        onPrompt(/The person says:\s+Also keep the old flag working\./, "Kept it."),
      ],
      (_id, agentLog) =>
        Effect.gen(function* () {
          const id = yield* startGoal(SHIP)
          yield* untilRunning(id)
          expect((yield* said(id)).status).toBe(202)
          yield* Deferred.succeed(release, undefined)
          // Watching with nothing waiting is only ever after the second turn: the chat is
          // appended under the permit the first turn's ending was.
          yield* goalWhere(id, quietlyWatching)
          expect((yield* agentLog).matched).toEqual([
            "after:/Open the traks you are confident in/",
            "/The person says:\\s+Also keep the old flag working\\./",
          ])
          expect(yield* goalTags(id)).toEqual([
            "GoalStarted",
            "GoalMessageWaiting",
            "GoalTurnEnded",
            "GoalActed",
            "GoalTurnEnded",
          ])
        }),
      lib,
    )
  })

  it("is still waiting after a restart, and the turn the engine starts hears it", async () => {
    const goal = GoalId.make("restarted")
    await runFlowWithAgentLog(
      [{ ...onPrompt(STARTED, "Planned."), hears: true }],
      (_id, agentLog) =>
        Effect.gen(function* () {
          // A message the engine wrote down and died before any turn read it.
          yield* seedLog(yield* GoalStore, goal, [
            GoalEvents.started(SPEC),
            GoalEvents.messageWaiting("k1", SAID),
          ])
          yield* (yield* GoalDrives).kick(goal)
          const settled = yield* goalWhere(goal, isWatching)
          expect(settled.messages).toEqual([])
          expect(messageTags(yield* goalTags(goal))).toEqual([
            "GoalMessageWaiting",
            "GoalMessageHeard",
          ])
          expect((yield* agentLog).requests).toHaveLength(1)
        }),
      lib,
    )
  })
})

describe("stopping a goal's composer turn", () => {
  const stop = (id: GoalId) => post(`/${id}/stop`, {})

  it("settles at the gate the turn asked for, and answers NothingToStop once nothing runs", async () => {
    await runFlow(
      [hangsOn(STARTED)],
      () =>
        Effect.gen(function* () {
          const id = yield* startGoal(SHIP)
          yield* untilRunning(id)
          yield* tool(id, "escalate", "toolu_ask", ASK)

          expect((yield* stop(id)).status).toBe(204)
          expect(yield* runningNow(id)).toBe(false)
          const stopped = yield* goalNow(id)
          expect(stopped?.state).toMatchObject({ _tag: "AtGate", gate: "escalation" })
          expect((yield* goalTags(id)).at(-1)).toBe("GoalTurnStopped")

          const again = yield* stop(id)
          expect(again.status).toBe(409)
          expect(yield* jsonOf(again)).toMatchObject({ _tag: "NothingToStop" })
        }),
      lib,
    )
  })

  it("watches with the turn's wakes unread, and starts no turn until somebody chats", async () => {
    const goal = GoalId.make("stopped")
    const opened = TrakId.make("opened-1")
    await runFlowWithAgentLog(
      [hangsOn(/traks needs you/), onPrompt(/The person says:\s+go on/, "Going on.")],
      (_id, agentLog) =>
        Effect.gen(function* () {
          yield* watchingGoal(goal, SPEC, [opened])
          yield* seedLog(yield* GoalStore, goal, [GoalEvents.trakWoke(opened, "failed", 1)])
          yield* (yield* GoalDrives).kick(goal)
          yield* untilRunning(goal)

          expect((yield* stop(goal)).status).toBe(204)
          yield* (yield* GoalDrives).kick(goal)
          yield* Effect.sleep("50 millis")
          const stopped = yield* goalNow(goal)
          expect(stopped?.state._tag).toBe("Watching")
          expect(stopped?.read).toBe(0)
          expect((yield* agentLog).requests).toHaveLength(1)

          expect((yield* post(`/${goal}/act`, { _tag: "Chat", message: "go on" })).status).toBe(202)
          const answered = yield* goalWhere(goal, answeredOne)
          expect(answered.wakes).toHaveLength(1)
          expect((yield* agentLog).requests).toHaveLength(2)
        }),
      lib,
    )
  })
})

/**
 * Let the held turn finish while holding the goal's permit, as the stop route holds it, and
 * halt it then: the driver is waiting on the permit to append the ending, with the turn
 * still on its entry.
 */
const haltAfterEnding = (id: GoalId, release: Deferred.Deferred<void>) =>
  Effect.gen(function* () {
    yield* Deferred.succeed(release, undefined)
    yield* Effect.sleep("100 millis")
    expect(yield* runningNow(id)).toBe(true)
    return yield* (yield* GoalDrives).halt(id)
  })

describe("a stop that lands after the turn has ended", () => {
  it("is nothing to stop: the turn's own ending stands, and its gate with it", async () => {
    const release = Effect.runSync(Deferred.make<void>())
    await runFlow(
      [onPromptAfter(STARTED, Deferred.await(release), "Asked.")],
      () =>
        Effect.gen(function* () {
          const id = yield* startGoal(SHIP)
          yield* untilRunning(id)
          yield* tool(id, "escalate", "toolu_ask", ASK)
          const halted = yield* (yield* Locks).withGoal(id)(haltAfterEnding(id, release))
          expect(halted).toBeUndefined()
          const parked = yield* goalWhere(id, atGate)
          expect(parked.state).toMatchObject({ _tag: "AtGate", gate: "escalation" })
          expect(yield* goalTags(id)).toEqual(["GoalStarted", "Escalated", "GoalTurnEnded"])

          const stopped = yield* post(`/${id}/stop`, {})
          expect(stopped.status).toBe(409)
          expect(yield* jsonOf(stopped)).toMatchObject({ _tag: "NothingToStop" })
          expect(yield* goalTags(id)).not.toContain("GoalTurnStopped")
        }),
      lib,
    )
  })
})

describe("the file gate's presses", () => {
  it("refuses a Redraft body at the act route, and appends nothing", async () => {
    const goal = GoalId.make("drafting")
    await runFlow(
      [],
      () =>
        Effect.gen(function* () {
          yield* seedLog(yield* GoalStore, goal, [
            GoalEvents.asked("make search work", ["smart"]),
            GoalEvents.drafted("d1", SPEC),
            GoalEvents.turnEnded(SESSION, 0, undefined),
          ])
          // The body does not decode, which the router answers 400 — and which the test
          // harness's `call` turns into a defect rather than a response.
          const refused = yield* Effect.exit(post(`/${goal}/act`, { _tag: "Redraft" }))
          expect(Exit.isFailure(refused)).toBe(true)
          expect(Exit.isFailure(refused) ? Cause.pretty(refused.cause) : "").toContain(
            'actual "Redraft"',
          )
          expect(yield* goalTags(goal)).toEqual(["GoalAsked", "GoalDrafted", "GoalTurnEnded"])
          expect((yield* goalNow(goal))?.state).toMatchObject({ _tag: "AtGate", gate: "file" })
        }),
      lib,
    )
  })
})

// ============================================================================
// Sub-goals — a goal opened by another goal's composer
// ============================================================================

const SUB: PlannedSubgoal = {
  title: "Accounts and sign-in",
  line: "Each person signs in with their own account.",
  finished: "Two accounts sign in at once.",
}

const subgoalOf = (g: Goal): GoalId | undefined => g.subgoals[0]?.id
const hasSubgoal = (g: Goal): boolean => g.subgoals.length > 0 && isWatching(g)
const subWoke =
  (kind: string) =>
  (g: Goal): boolean =>
    g.wakes.some((w) => "subgoal" in w && w.kind === kind)
const isPaused = (g: Goal | undefined): boolean => g?.paused === true
const isFailed = (g: Goal): boolean => g.state._tag === "Failed"
const countOf = (tags: readonly string[], tag: string): number =>
  tags.filter((t) => t === tag).length
/** The first request whose prompt holds `text`. */
const askedWith = <R extends { readonly prompt: string }>(requests: readonly R[], text: string) =>
  requests.find((r) => r.prompt.includes(text))
const dropReason = (g: Goal | undefined) =>
  g?.state._tag === "Dropped" ? g.state.reason : g?.state._tag

/** A parent whose plan holds `SUB` and nothing else, watching — written straight to its log. */
const parentWithSubgoalPlan = (id: GoalId, spec: GoalSpec) =>
  Effect.flatMap(GoalStore, (store) =>
    seedLog(store, id, [
      GoalEvents.started(spec),
      GoalEvents.replanned("c1", [], "Accounts first.", [SUB]),
      GoalEvents.turnEnded(SESSION, 0, undefined),
    ]),
  )

/** A sub-goal of `parent`, watching, `opened` running. */
const watchingSubgoal = (
  id: GoalId,
  parent: GoalId,
  opened: readonly TrakId[],
  ...more: readonly GoalEvent[]
) =>
  Effect.flatMap(GoalStore, (store) =>
    Effect.gen(function* () {
      yield* seedLog(store, id, [
        GoalEvents.started(subgoalSpec(SUB, undefined), undefined, { parent, call: `open-${id}` }),
        ...opened.map((t, i) => GoalEvents.trakOpened(`s${String(i + 2)}`, t, t, "smart")),
        ...more,
        GoalEvents.turnEnded(SESSION, 0, undefined),
      ])
      yield* seedLog(store, parent, [GoalEvents.subgoalOpened(`open-${id}`, id, SUB.title)])
    }),
  )

describe("a sub-goal", () => {
  it("opens from a plan entry on the parent's first turn, opens its own trak on its first turn with no gate, and opens no sub-goal itself", async () => {
    const opening = Effect.runSync(Deferred.make<void>())
    const subOpening = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [
        onPromptAfter(/## A sub-goal/, Deferred.await(subOpening), "Opened my first trak."),
        onPromptAfter(STARTED, Deferred.await(opening), "Opened the sub-goal."),
        hangsOn(/Compose a pipeline/),
      ],
      (_id, agentLog) =>
        Effect.gen(function* () {
          const parent = yield* startGoal(SHIP)
          yield* untilRunning(parent)
          const plan = { traks: [], subgoals: [SUB], why: "Accounts stand alone." }
          expect((yield* tool(parent, "replan", "p1", plan)).isError).toBe(false)

          const unknown = yield* tool(parent, "open_subgoal", "toolu_x", { title: "Nope" })
          expect(unknown.isError).toBe(true)
          const opened = yield* tool(parent, "open_subgoal", "toolu_sub", { title: SUB.title })
          expect(opened.isError).toBe(false)
          // A retried call answers with the sub-goal it already opened.
          expect(yield* tool(parent, "open_subgoal", "toolu_sub", { title: SUB.title })).toEqual(
            opened,
          )
          const twice = yield* tool(parent, "open_subgoal", "toolu_2", { title: SUB.title })
          expect(twice.text).toContain("already open")
          yield* Deferred.succeed(opening, undefined)
          const watching = yield* goalWhere(parent, hasSubgoal)
          const sub = subgoalOf(watching)
          if (sub === undefined) return
          expect(opened.text).toContain(sub)

          yield* untilRunning(sub)
          const nested = yield* tool(sub, "open_subgoal", "toolu_n", { title: SUB.title })
          expect(nested).toMatchObject({ isError: true })
          expect(nested.text).toContain("is a sub-goal")
          const deeper = yield* tool(sub, "replan", "s0", { traks: [], subgoals: [SUB], why: "w" })
          expect(deeper.isError).toBe(true)
          expect((yield* tool(sub, "open_trak", "s1", PLANNED)).isError).toBe(false)
          yield* Deferred.succeed(subOpening, undefined)

          const child = yield* goalWhere(sub, isWatching)
          expect(child.traks).toHaveLength(1)
          expect(yield* goalTags(sub)).toEqual(["GoalStarted", "TrakOpened", "GoalTurnEnded"])
          expect(child.parent).toEqual({ goal: parent, call: "toolu_sub" })
          expect(child.spec).toEqual({ ...SUB, limits: {} })
          const requests = (yield* agentLog).requests
          const subTurn = askedWith(requests, "## A sub-goal")
          const parentTurn = askedWith(requests, "# The goal: Ship goals")
          expect(subTurn?.resumeFrom).toBeUndefined()
          expect(subTurn?.sessionId).not.toBe(parentTurn?.sessionId)
          expect(child.session).toBe(subTurn?.sessionId)
          expect(countOf(yield* goalTags(parent), "SubgoalOpened")).toBe(1)
          expect((yield* goalTags(sub))[0]).toBe("GoalStarted")
        }),
      lib,
    )
  })
})

describe("a sub-goal's limits", () => {
  it("shares its parent's parallel limit, counting both goals' traks, and a looser limit of its own changes nothing", async () => {
    const parent = GoalId.make("parent")
    const sub = GoalId.make("sub")
    const ours = TrakId.make("parents-trak")
    const theirs = TrakId.make("subs-trak")
    await runFlow(
      [hangsOn(/The person says/), hangsOn(/The person says/)],
      () =>
        Effect.gen(function* () {
          const store = yield* Store
          yield* seedLog(store, ours, [Events.trakForGoal("ours", "smart", parent)])
          yield* seedLog(store, theirs, [Events.trakForGoal("theirs", "smart", sub)])
          yield* watchingGoal(parent, { ...SPEC, limits: { parallel: 2 } }, [ours])
          const looser = GoalEvents.settingsChanged({ parallel: 5 })
          yield* watchingSubgoal(sub, parent, [theirs], looser)
          yield* post(`/${parent}/act`, { _tag: "Chat", message: "Carry on." })
          yield* post(`/${sub}/act`, { _tag: "Chat", message: "Carry on." })
          yield* untilRunning(parent)
          yield* untilRunning(sub)

          for (const goal of [parent, sub]) {
            const refused = yield* tool(goal, "open_trak", `more-${goal}`, PLANNED)
            expect(refused).toMatchObject({ isError: true })
            expect(refused.text).toContain("2 of your traks are already running")
          }
          expect(opensIn(yield* goalTags(parent))).toBe(1)
          expect(opensIn(yield* goalTags(sub))).toBe(1)
        }),
      lib,
    )
  })
})

describe("a sub-goal's parent", () => {
  it("pauses, resumes and drops with its parent, and only the pause it took is resumed", async () => {
    const parent = GoalId.make("cascade")
    const one = GoalId.make("sub-one")
    const two = GoalId.make("sub-two")
    await runFlow(
      [{ ...onPrompt(/resumed the goal/, "Carried on."), repeatable: true }],
      () =>
        Effect.gen(function* () {
          yield* watchingGoal(parent, SPEC, [])
          yield* watchingSubgoal(one, parent, [])
          yield* watchingSubgoal(two, parent, [])
          // The person paused this one themselves; the parent's resume leaves it paused.
          expect((yield* post(`/${two}/pause`, {})).status).toBe(204)

          expect((yield* post(`/${parent}/pause`, {})).status).toBe(204)
          expect(isPaused(yield* goalNow(one))).toBe(true)
          expect((yield* goalNow(parent))?.heldSubgoals).toEqual([one])

          expect((yield* post(`/${parent}/resume`, {})).status).toBe(204)
          expect(isPaused(yield* goalNow(one))).toBe(false)
          expect(isPaused(yield* goalNow(two))).toBe(true)
          yield* goalWhere(one, isWatching)
          yield* goalWhere(parent, isWatching)

          expect((yield* post(`/${parent}/drop`, { reason: "not now" })).status).toBe(202)
          expect(dropReason(yield* goalNow(parent))).toBe("not now")
          expect(dropReason(yield* goalNow(one))).toBe("not now")
          expect(dropReason(yield* goalNow(two))).toBe("not now")
        }),
      lib,
    )
  })

  it("wakes its parent stuck when its composer turn fails, and dropped when a person drops it", async () => {
    const parent = GoalId.make("waiting-parent")
    const sub = GoalId.make("failing-sub")
    await runFlow(
      [crashesOn(/Carry on/, "the connection dropped"), READS],
      () =>
        Effect.gen(function* () {
          yield* watchingGoal(parent, SPEC, [])
          yield* watchingSubgoal(sub, parent, [])
          yield* post(`/${sub}/act`, { _tag: "Chat", message: "Carry on." })
          yield* goalWhere(sub, isFailed)
          const stuck = yield* goalWhere(parent, subWoke("stuck"))
          expect(stuck.wakes).toMatchObject([{ subgoal: sub, kind: "stuck" }])
          expect(JSON.stringify(stuck.wakes)).toContain("the connection dropped")
          expect(stuck.subgoals[0]?.status).toBe("live")

          expect((yield* post(`/${sub}/drop`, { reason: "covered elsewhere" })).status).toBe(202)
          const dropped = yield* goalWhere(parent, subWoke("dropped"))
          expect(dropped.wakes[1]).toEqual({
            subgoal: sub,
            kind: "dropped",
            said: "covered elsewhere",
          })
          expect(dropped.subgoals[0]?.status).toBe("dropped")
          // Read again by the reconcile pass, it files nothing a second time.
          yield* reconcileGoals
          expect(countOf(yield* goalTags(parent), "SubgoalWoke")).toBe(2)
        }),
      lib,
    )
  })
})

/** A file committed on `branch` of `origin`, through a clone of its own. */
const commitOnOrigin = (around: string, branch: string, name: string, content: string) => {
  const clone = mkdtempSync(join(around, "clone-"))
  gitIn(around, "clone", "-q", "-b", branch, join(around, "origin.git"), clone)
  writeFileSync(join(clone, name), content)
  gitIn(clone, "add", "-A")
  gitIn(clone, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", name)
  gitIn(clone, "push", "-q", "origin", `HEAD:${branch}`)
}

const SUB_DONE = "Accounts sign in."

describe("a sub-goal under a parent with a goal branch", () => {
  it("cuts its branch from the parent's, lands its traks there, and Confirm merges it into the parent's branch and wakes the parent", async () => {
    const forge = forgeOpening()
    const opening = Effect.runSync(Deferred.make<void>())
    const subWorking = Effect.runSync(Deferred.make<void>())
    await onGit.runFlow(
      [
        onPromptAfter(/## A sub-goal/, Deferred.await(subWorking), "Done."),
        onPromptAfter(/The person says/, Deferred.await(opening), "Opened it."),
        hangsOn(/Compose a pipeline/),
        READS,
      ],
      (_id, _agents, _checks, repoDir) =>
        Effect.gen(function* () {
          const around = mergedOnOrigin(repoDir)
          const origin = join(around, "origin.git")
          const vcs = yield* Vcs
          yield* Effect.orDie(vcs.createGoalBranch(BranchName.make(GOAL_BRANCH)))
          const parent = GoalId.make("ship-1")
          yield* parentWithSubgoalPlan(parent, {
            ...SPEC,
            title: "Ship goals",
            branch: GOAL_BRANCH,
          })
          yield* post(`/${parent}/act`, { _tag: "Chat", message: "Open the sub-goal." })
          yield* untilRunning(parent)
          expect((yield* tool(parent, "open_subgoal", "o1", { title: SUB.title })).isError).toBe(
            false,
          )
          yield* Deferred.succeed(opening, undefined)
          const sub = subgoalOf(yield* goalWhere(parent, hasSubgoal))
          if (sub === undefined) return
          const branch = `${GOAL_BRANCH}-${sub}`
          expect((yield* goalNow(sub))?.spec?.branch).toBe(branch)
          expect(gitIn(origin, "rev-parse", branch)).toBe(gitIn(origin, "rev-parse", GOAL_BRANCH))

          yield* untilRunning(sub)
          const opened = yield* tool(sub, "open_trak", "s2", PLANNED)
          const trak = TrakId.make(opened.text.replace(/^Opened trak `(.+)`\.$/, "$1"))
          yield* logged(trak, setUp)
          const [born] = yield* (yield* Store).events(trak)
          expect(born).toMatchObject({ goal: sub, goalBranch: branch, base: `origin/${branch}` })
          // The landing the runtime makes for a trak with a goal branch.
          const worktree = worktreeOf(yield* replayed(trak))
          writeWork(worktree, "accounts.ts", "export const accounts = true\n")
          gitIn(worktree.path, "add", "-A")
          gitIn(
            worktree.path,
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit",
            "-q",
            "-m",
            "a",
          )
          const into = MergeInto.Goal({ goal: sub, branch: BranchName.make(branch) })
          yield* Effect.orDie(vcs.merge(into, worktree.branch, "Merge the trak"))
          yield* tool(sub, "propose_done", "s3", { summary: SUB_DONE })
          yield* Deferred.succeed(subWorking, undefined)
          yield* goalWhere(sub, atDone)

          expect((yield* post(`/${sub}/act`, { _tag: "Confirm" })).status).toBe(202)
          const tip = gitIn(origin, "rev-parse", GOAL_BRANCH)
          expect(gitIn(origin, "show", `${tip}:accounts.ts`)).toBe("export const accounts = true")
          expect(forge.opened).toEqual([])
          const parentNow = yield* goalWhere(parent, subWoke("done"))
          expect(parentNow.wakes).toEqual([{ subgoal: sub, kind: "done", said: SUB_DONE }])
          rmSync(around, { recursive: true, force: true })
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })
})

describe("a sub-goal whose branch conflicts with its parent's", () => {
  it("refuses Confirm on a merge that conflicts, with the reason, and stays at its done gate", async () => {
    const forge = forgeOpening()
    await onGit.runFlow(
      [],
      (_id, _agents, _checks, repoDir) =>
        Effect.gen(function* () {
          const around = mergedOnOrigin(repoDir)
          const vcs = yield* Vcs
          const parent = GoalId.make("ship-1")
          const sub = GoalId.make("subgoal-1")
          const branch = `${GOAL_BRANCH}-${sub}`
          yield* Effect.orDie(vcs.createGoalBranch(BranchName.make(GOAL_BRANCH)))
          const cut = vcs.createGoalBranch(BranchName.make(branch), BranchName.make(GOAL_BRANCH))
          yield* Effect.orDie(cut)
          commitOnOrigin(around, GOAL_BRANCH, "same.txt", "parent\n")
          commitOnOrigin(around, branch, "same.txt", "sub\n")
          yield* parentWithSubgoalPlan(parent, { ...SPEC, branch: GOAL_BRANCH })
          const store = yield* GoalStore
          yield* seedLog(store, sub, [
            GoalEvents.started(subgoalSpec(SUB, branch), undefined, { parent, call: "o1" }),
            GoalEvents.doneProposed("s2", SUB_DONE),
            GoalEvents.turnEnded(SESSION, 0, undefined),
          ])
          yield* seedLog(store, parent, [GoalEvents.subgoalOpened("o1", sub, SUB.title)])

          const refused = yield* post(`/${sub}/act`, { _tag: "Confirm" })
          expect(refused.status).toBe(409)
          const reason = JSON.stringify(yield* jsonOf(refused))
          expect(reason).toContain("SubgoalConflicted")
          expect(reason).toContain("same.txt")
          expect(atDone(yield* goalWhere(sub, atDone))).toBe(true)
          expect((yield* goalNow(parent))?.wakes).toEqual([])
          expect(forge.opened).toEqual([])
          rmSync(around, { recursive: true, force: true })
        }),
      undefined,
      undefined,
      forge.layer,
    )
  })
})

/** A composer turn for the person's chat, held until `released`, on every goal it reaches. */
const heldChat = (released: Deferred.Deferred<void>) => ({
  ...onPromptAfter(/The person says/, Deferred.await(released), "Merged it."),
  repeatable: true,
})

/** The goal `id`, mid-turn: a chat sent and its turn running. */
const chattedInto = (id: GoalId) =>
  Effect.andThen(
    post(`/${id}/act`, { _tag: "Chat", message: "Keep it current." }),
    untilRunning(id),
  )

const traksOpened = (id: GoalId) =>
  Effect.map(goalTags(id), (tags) => tags.filter((t) => t === "TrakOpened").length)

/** The goal's `merge_default_branch` call, which has to be refused, and what it said. */
const refusedMerge = (id: GoalId) =>
  Effect.map(tool(id, "merge_default_branch", "m1", {}), (answer) => {
    expect(answer.isError).toBe(true)
    return answer.text
  })

describe("merging the default branch into a goal branch", () => {
  it("merges cleanly inside the call, pushes the goal branch, and opens no trak", async () => {
    const released = Effect.runSync(Deferred.make<void>())
    await onGit.runFlow([heldChat(released)], (_id, _agents, _checks, repoDir) =>
      Effect.gen(function* () {
        const around = mergedOnOrigin(repoDir)
        const origin = join(around, "origin.git")
        yield* Effect.orDie((yield* Vcs).createGoalBranch(BranchName.make(GOAL_BRANCH)))
        commitOnOrigin(around, GOAL_BRANCH, "ours.txt", "ours\n")
        commitOnOrigin(around, "main", "theirs.txt", "theirs\n")
        const id = GoalId.make("ship-1")
        yield* watchingGoal(id, { ...SPEC, branch: GOAL_BRANCH }, [])
        yield* chattedInto(id)

        const answer = yield* tool(id, "merge_default_branch", "m1", {})
        expect(answer.isError).toBe(false)
        expect(answer.text).toContain("Merged `main` into `goal/ship`")
        const main = gitIn(origin, "rev-parse", "main")
        gitIn(origin, "merge-base", "--is-ancestor", main, GOAL_BRANCH)
        expect(gitIn(origin, "show", `${GOAL_BRANCH}:ours.txt`)).toBe("ours")
        expect(gitIn(origin, "show", `${GOAL_BRANCH}:theirs.txt`)).toBe("theirs")
        expect(yield* traksOpened(id)).toBe(0)

        const again = yield* tool(id, "merge_default_branch", "m2", {})
        expect(again.text).toContain("already holds everything on `main`")
        yield* Deferred.succeed(released, undefined)
        rmSync(around, { recursive: true, force: true })
      }),
    )
  })

  it("answers a conflict with the paths and the default branch's commit, and changes nothing", async () => {
    const released = Effect.runSync(Deferred.make<void>())
    await onGit.runFlow([heldChat(released)], (_id, _agents, _checks, repoDir) =>
      Effect.gen(function* () {
        const around = mergedOnOrigin(repoDir)
        const origin = join(around, "origin.git")
        yield* Effect.orDie((yield* Vcs).createGoalBranch(BranchName.make(GOAL_BRANCH)))
        commitOnOrigin(around, GOAL_BRANCH, "same.txt", "ours\n")
        commitOnOrigin(around, "main", "same.txt", "theirs\n")
        const id = GoalId.make("ship-1")
        yield* watchingGoal(id, { ...SPEC, branch: GOAL_BRANCH }, [])
        yield* chattedInto(id)
        const before = gitIn(origin, "rev-parse", GOAL_BRANCH)

        const answer = yield* tool(id, "merge_default_branch", "m1", {})
        expect(answer.isError).toBe(false)
        expect(answer.text).toContain("`same.txt`")
        expect(answer.text).toContain(gitIn(origin, "rev-parse", "main"))
        expect(answer.text).toContain("Open a trak with `open_trak`")
        expect(gitIn(origin, "rev-parse", GOAL_BRANCH)).toBe(before)
        const checkout = goalCheckoutPathFor(repoDir, id)
        expect(gitIn(checkout, "rev-parse", "HEAD")).toBe(before)
        expect(gitIn(checkout, "status", "--porcelain")).toBe("")
        expect(yield* traksOpened(id)).toBe(0)
        yield* Deferred.succeed(released, undefined)
        rmSync(around, { recursive: true, force: true })
      }),
    )
  })

  it("is refused on a goal with no branch, on a sub-goal, on a paused goal, and before the file is approved", async () => {
    const released = Effect.runSync(Deferred.make<void>())
    await runFlow([heldChat(released), hangsOn(/weigh what the sentence leaves open/)], () =>
      Effect.gen(function* () {
        const plain = GoalId.make("plain")
        yield* watchingGoal(plain, SPEC, [])
        yield* chattedInto(plain)
        expect(yield* refusedMerge(plain)).toContain("has no goal branch")

        const parent = GoalId.make("parent")
        const sub = GoalId.make("sub")
        yield* parentWithSubgoalPlan(parent, { ...SPEC, branch: GOAL_BRANCH })
        yield* seedLog(yield* GoalStore, sub, [
          GoalEvents.started(subgoalSpec(SUB, `${GOAL_BRANCH}-sub`), undefined, {
            parent,
            call: "o1",
          }),
          GoalEvents.turnEnded(SESSION, 0, undefined),
        ])
        yield* chattedInto(sub)
        expect(yield* refusedMerge(sub)).toContain("this goal is a sub-goal")

        const paused = GoalId.make("paused")
        yield* watchingGoal(paused, { ...SPEC, branch: GOAL_BRANCH }, [])
        yield* chattedInto(paused)
        expect((yield* post(`/${paused}/pause`, {})).status).toBe(204)
        expect(yield* refusedMerge(paused)).toContain("the goal is paused")

        const started = yield* post("", { asked: "Ship it", modes: ["smart"] })
        const drafting = GoalId.make(
          Schema.decodeUnknownSync(CreatedDto)(yield* jsonOf(started)).id,
        )
        yield* untilRunning(drafting)
        expect(yield* refusedMerge(drafting)).toContain("no approved file yet")
        yield* Deferred.succeed(released, undefined)
      }),
    )
  })
})

describe("a sub-goal's auto-merge", () => {
  it("is turned off by its parent's never, and its own always under that never turns nothing on", async () => {
    const parent = GoalId.make("merging-parent")
    const sub = GoalId.make("merging-sub")
    const ours = TrakId.make("parents-merging")
    const theirs = TrakId.make("subs-merging")
    await runFlow([], () =>
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, ours, [Events.trakForGoal("ours", "smart", parent, undefined, true)])
        yield* seedLog(store, theirs, [Events.trakForGoal("theirs", "smart", sub, undefined, true)])
        yield* watchingGoal(parent, SPEC, [ours])
        yield* watchingSubgoal(sub, parent, [theirs])

        expect(yield* replacing(parent, { autoMerge: "never" })).toBe(204)
        expect([yield* autoMerging(ours), yield* autoMerging(theirs)]).toEqual([false, false])

        expect(yield* replacing(sub, { autoMerge: "always" })).toBe(204)
        expect(yield* autoMerging(theirs)).toBe(false)
      }),
    )
  })
})

describe("a sub-goal's own limit", () => {
  it("counts its own traks alone, so its parent's traks never use it up", async () => {
    const parent = GoalId.make("busy-parent")
    const sub = GoalId.make("narrow-sub")
    const first = TrakId.make("parents-first")
    const second = TrakId.make("parents-second")
    await runFlow(
      [hangsOn(/The person says/), hangsOn(/Compose a pipeline/), hangsOn(/Compose a pipeline/)],
      () =>
        Effect.gen(function* () {
          const store = yield* Store
          yield* seedLog(store, first, [Events.trakForGoal("first", "smart", parent)])
          yield* seedLog(store, second, [Events.trakForGoal("second", "smart", parent)])
          yield* watchingGoal(parent, { ...SPEC, limits: { parallel: 5 } }, [first, second])
          const own = GoalEvents.settingsChanged({ parallel: 2 })
          yield* watchingSubgoal(sub, parent, [], own)
          yield* post(`/${sub}/act`, { _tag: "Chat", message: "Carry on." })
          yield* untilRunning(sub)

          // The parent's two traks already reach the sub-goal's own number.
          expect((yield* tool(sub, "open_trak", "o1", PLANNED)).isError).toBe(false)
          expect((yield* tool(sub, "open_trak", "o2", PLANNED)).isError).toBe(false)
          const third = yield* tool(sub, "open_trak", "o3", PLANNED)
          expect(third).toMatchObject({ isError: true })
          expect(third.text).toContain("counted over this sub-goal's own traks")
        }),
      lib,
    )
  })
})

describe("a parent goal with a sub-goal still going", () => {
  it("is refused propose_done and Confirm done, naming the sub-goal", async () => {
    const proposing = GoalId.make("proposing-parent")
    const confirming = GoalId.make("confirming-parent")
    const sub = GoalId.make("still-going")
    const other = GoalId.make("also-going")
    await runFlow(
      [hangsOn(/The person says/)],
      () =>
        Effect.gen(function* () {
          yield* watchingGoal(proposing, SPEC, [])
          yield* watchingSubgoal(sub, proposing, [])
          yield* post(`/${proposing}/act`, { _tag: "Chat", message: "Are we done?" })
          yield* untilRunning(proposing)
          const proposed = yield* tool(proposing, "propose_done", "d1", { summary: "All of it." })
          expect(proposed).toMatchObject({ isError: true })
          expect(proposed.text).toContain(`${SUB.title} (\`${sub}\`)`)
          expect(yield* goalTags(proposing)).not.toContain("DoneProposed")

          yield* watchingGoal(confirming, SPEC, [])
          yield* watchingSubgoal(other, confirming, [])
          yield* seedLog(yield* GoalStore, confirming, [
            GoalEvents.doneProposed("d2", "All of it."),
            GoalEvents.turnEnded(SESSION, 0, undefined),
          ])
          const refused = yield* post(`/${confirming}/act`, { _tag: "Confirm" })
          expect(refused.status).toBe(409)
          expect(yield* jsonOf(refused)).toEqual({
            _tag: "SubgoalsLive",
            subgoals: `${SUB.title} (\`${other}\`)`,
          })
          expect(atDone(yield* goalWhere(confirming, atDone))).toBe(true)
        }),
      lib,
    )
  })
})

const subDropped = (g: Goal): boolean => g.subgoals[0]?.status === "dropped"

describe("a parent managing its sub-goals", () => {
  it("messages a live sub-goal's composer as its parent, and is refused for one it did not open, one at a gate, and on a sub-goal", async () => {
    const parent = GoalId.make("messaging-parent")
    const sub = GoalId.make("messaged-sub")
    const gated = GoalId.make("gated-sub")
    const theirs = TrakId.make("messaged-subs-trak")
    await runFlowWithAgentLog(
      [
        onPrompt(/from the composer of the parent goal/, "Heard."),
        hangsOn(/The person says/),
        hangsOn(/The person says/),
      ],
      (_id, agentLog) =>
        Effect.gen(function* () {
          yield* seedLog(yield* Store, theirs, [Events.trakForGoal("theirs", "smart", sub)])
          yield* watchingGoal(parent, SPEC, [])
          yield* watchingSubgoal(sub, parent, [theirs])
          const goals = yield* GoalStore
          yield* seedLog(goals, gated, [
            GoalEvents.started(subgoalSpec(SUB, undefined), undefined, { parent, call: "g" }),
            GoalEvents.escalated("g1", undefined, ASK.questions),
            GoalEvents.turnEnded(SESSION, 0, undefined),
          ])
          yield* seedLog(goals, parent, [GoalEvents.subgoalOpened("g", gated, "Gated")])
          yield* post(`/${parent}/act`, { _tag: "Chat", message: "Check on it." })
          yield* untilRunning(parent)
          const parentTurn = askedWith((yield* agentLog).requests, "Check on it.")
          expect(parentTurn?.prompt).toContain("traks 1 opened, 0 landed, 1 running")

          const message = { subgoal: sub, message: "The schema landed." }
          const unknown = yield* tool(parent, "message_subgoal", "m0", { ...message, subgoal: "x" })
          expect(unknown.text).toContain("is not a sub-goal this goal opened")
          const atItsGate = yield* tool(parent, "message_subgoal", "m1", {
            ...message,
            subgoal: gated,
          })
          expect(atItsGate.text).toContain("its person's to answer")
          expect((yield* tool(parent, "message_subgoal", "m2", message)).isError).toBe(false)
          yield* goalWhere(sub, isWatching)
          const subTurn = askedWith((yield* agentLog).requests, "The schema landed.")
          expect(subTurn?.prompt).toContain("from the composer of the parent goal **G**")
          expect(countOf(yield* goalTags(parent), "SubgoalMessaged")).toBe(1)

          // A sub-goal has no sub-goals to reach.
          yield* post(`/${sub}/act`, { _tag: "Chat", message: "Carry on." })
          yield* untilRunning(sub)
          const nested = yield* tool(sub, "drop_subgoal", "n1", { subgoal: sub, reason: "x" })
          expect(nested.text).toContain("has no sub-goals of its own")
        }),
      lib,
    )
  })

  it("drops a live sub-goal off the plan without waking itself, and refuses anything more for it", async () => {
    const parent = GoalId.make("dropping-parent")
    const sub = GoalId.make("dropped-sub")
    await runFlow(
      [hangsOn(/The person says/)],
      () =>
        Effect.gen(function* () {
          yield* parentWithSubgoalPlan(parent, SPEC)
          yield* watchingSubgoal(sub, parent, [])
          yield* post(`/${parent}/act`, { _tag: "Chat", message: "Rethink it." })
          yield* untilRunning(parent)

          const drop = { subgoal: sub, reason: "split differently" }
          expect((yield* tool(parent, "drop_subgoal", "d1", drop)).isError).toBe(false)
          expect(dropReason(yield* goalNow(sub))).toBe("split differently")
          const after = yield* goalWhere(parent, subDropped)
          expect(after.subgoalPlan).toEqual([])
          expect(after.wakes).toEqual([])
          yield* reconcileGoals
          expect(countOf(yield* goalTags(parent), "SubgoalWoke")).toBe(0)

          const again = yield* tool(parent, "drop_subgoal", "d2", drop)
          expect(again.text).toContain("is done or dropped")
          const message = { subgoal: sub, message: "Hello?" }
          expect((yield* tool(parent, "message_subgoal", "m1", message)).isError).toBe(true)
        }),
      lib,
    )
  })
})
