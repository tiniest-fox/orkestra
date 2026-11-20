// A top-level trak's composer that finishes and sees a larger effort ahead proposes a goal
// on its finish: a few paragraphs of markdown. The finish takes the plan gate for it —
// `manual`, `smart` and `decider` stop, `auto` goes past — and once the trak is finished
// the goal's watcher starts the goal once, from the proposal and every document the trak
// filed, and writes on the trak's log which goal it became. The goal then drafts its file
// and stops there, as every goal asked for in words does.
//
// The watcher is called by hand, as `goals.test.ts` calls it: the flow runs no feed.

import { Deferred, Effect, Schedule, Schema, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { toWeb } from "@effect/platform/HttpServerResponse"
import { McpToolResultDto } from "@orkestra/shared/dto/goals"
import { Drives } from "../../src/app/drive.js"
import { Lib } from "../../src/library/ports/library.js"
import { goalRoutes, reconcileGoals, startGoal, watchGoalTraks } from "../../src/app/goals.js"
import { Events } from "../../src/workflow/domain/event.js"
import {
  type Goal,
  GoalEvents,
  goalOwed,
  proposalCall,
  replayGoal,
} from "../../src/workflow/domain/goal.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import { type GoalId, slotAt, type TrakId } from "../../src/workflow/domain/trak.js"
import { Frame, type Framed } from "../../src/workflow/ports/feed.js"
import { GoalStore } from "../../src/workflow/ports/goal-store.js"
import { Store } from "../../src/workflow/ports/store.js"
import { composerStopping, onGit, runFlow, step } from "../support/flow.js"
import { mount } from "../support/http.js"
import {
  act,
  create,
  createAndStart,
  expectAwaitingProposal,
  expectState,
  human,
  idle,
  logTags,
} from "../support/scenario.js"
import { type AgentLog, onPrompt, onPromptAfter, reply } from "../support/scripted-agent.js"

const { call } = mount(goalRoutes)

/** What the composer proposes: the goal, and what the conversation settled about it. */
const GOAL =
  "Rebuild the importer around streaming.\n\nSettled: one pass over the file, no temporary copies."

/** What the trak's one step filed — the document the goal's drafting turn is handed. */
const SETTLED = "Streaming fits: the parser already yields rows one at a time."

const DRAFTED = {
  name: "streaming-importer",
  title: "A streaming importer",
  line: "Import any file in one pass",
  finished: "Every import streams.",
}

/** The composer, asked again at the entry it planned for itself, finishing with a goal. */
const proposesGoal = onPrompt(
  /You planned this turn yourself/,
  reply.finishedProposingGoal("The approach is settled.", GOAL),
  "compose proposes a goal",
)

/** The composer's first answer, finishing at once with a goal. */
const proposesGoalAtOnce = onPrompt(
  /Compose a pipeline/,
  reply.finishedProposingGoal("Nothing to build here.", GOAL),
  "compose proposes a goal at once",
)

/** The goal's drafting turn, held open until `until` so `draft_goal` lands inside it. */
const drafts = (until: Effect.Effect<void>) =>
  onPromptAfter(/A goal, asked for in a sentence/, until, "Drafted.", "goal drafts")

/** The trak's newest append, as the feed carries it. */
const frameOf = (id: TrakId) =>
  Effect.gen(function* () {
    const log = yield* (yield* Store).events(id)
    const framed: Framed = {
      id: 1,
      frame: Frame.Appended({
        id,
        seq: log.length,
        event: log[log.length - 1] ?? Events.closed(),
        trak: replayHistory(id, log),
      }),
    }
    return framed
  })

/** Every goal there is. */
const goals = Effect.gen(function* () {
  const store = yield* GoalStore
  const all: Goal[] = []
  for (const id of yield* store.list()) {
    const goal = replayGoal(id, yield* store.events(id))
    if (goal !== undefined) all.push(goal)
  }
  return all
})

/** The one goal there is, failing the test where there is not exactly one. */
const theGoal = Effect.gen(function* () {
  const all = yield* goals
  const [goal] = all
  if (goal === undefined || all.length > 1) {
    return yield* Effect.die(`${String(all.length)} goals started, not one`)
  }
  return goal
})

/** Wait until the goal satisfies `enough` — its turn runs on the worker, not this fiber. */
const goalWhere = (id: GoalId, enough: (goal: Goal) => boolean) =>
  Effect.gen(function* () {
    const store = yield* GoalStore
    const now = Effect.map(store.events(id), (log) => replayGoal(id, log))
    // `repeat` answers with the schedule's count, so the goal is read once more after it.
    yield* now.pipe(
      Effect.repeat({
        until: (g) => g !== undefined && enough(g),
        schedule: Schedule.spaced("1 millis"),
      }),
    )
    const goal = yield* now
    if (goal === undefined) return yield* Effect.die("the goal has no log")
    return goal
  }).pipe(Effect.timeout("20 seconds"), Effect.orDie)

const atGate = (g: Goal): boolean => g.state._tag === "AtGate"

/** The library rooted at the flow's repository, where `draft_goal` looks for the file. */
const rootedAt = (repoDir: string) =>
  Effect.provideServiceEffect(
    Lib,
    Effect.map(Lib, (held) => ({ ...held, root: repoDir })),
  )

/** Draft the goal file through the goal's tool route, as `orkestra goal-tools` would. */
const draftGoal = (goal: GoalId) =>
  Effect.gen(function* () {
    const response = yield* call(
      new Request(`http://localhost/api/goals/${goal}/tools/draft_goal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ call: "toolu_d", arguments: DRAFTED }),
      }),
    )
    const body: unknown = yield* Effect.promise(
      async (): Promise<unknown> => JSON.parse(await toWeb(response).text()),
    )
    return Schema.decodeUnknownSync(McpToolResultDto)(body)
  })

/** Run the plan to the composer's finish, which stops at the plan gate on `manual`. */
const atTheGate = (id: TrakId) =>
  Effect.gen(function* () {
    yield* createAndStart(id, "Think the importer through")
    const asked = yield* act(id, 1, human.approve())
    // The finish carries a goal, and on `manual` that is the plan gate — where a plain
    // finish would have rested at once.
    expectAwaitingProposal(asked)
    expect(slotAt(asked, 2).goal).toBe(GOAL)
    // A watcher that reads the trak at its gate starts nothing.
    yield* watchGoalTraks(Stream.make(yield* frameOf(id)))
    expect(yield* goals).toEqual([])
  })

/**
 * The watcher reads the finished trak: one goal, naming it, handed its words and its
 * document, and recorded on its log — and reading it again starts no second.
 */
const startedOnce = (id: TrakId, agentLog: Effect.Effect<AgentLog>) =>
  Effect.gen(function* () {
    yield* watchGoalTraks(Stream.make(yield* frameOf(id)))
    const goal = yield* theGoal
    expect(goal.openedBy).toEqual({ from: id, call: "finish-2" })
    expect(goal.asked).toBe(GOAL)
    expect(goal.askedModes).toEqual(["manual"])
    expect(goal.documents.map((d) => d.name)).toEqual(["1-work"])
    expect(goal.state._tag).toBe("Composing")
    const trak = replayHistory(id, yield* (yield* Store).events(id))
    expect((yield* logTags(id)).at(-1)).toBe("GoalOpened")
    expect(slotAt(trak, 2).goalOpened).toBe(goal.id)
    expect(trak.state._tag).toBe("Finished")

    // The drafting turn is handed the proposal and what the trak filed, whole.
    const prompt = (yield* agentLog).requests.at(-1)?.prompt ?? ""
    expect(prompt).toContain(GOAL)
    expect(prompt).toContain("## What the work that proposed it filed")
    expect(prompt).toContain("### 1-work")
    expect(prompt).toContain(SETTLED)

    // Read again, by a later frame and by the pass a restart runs: still one goal.
    yield* watchGoalTraks(Stream.make(yield* frameOf(id)))
    yield* reconcileGoals
    expect(yield* goals).toHaveLength(1)
    return goal
  })

/** The event an `auto` trak is born from, hoisted: one callback deeper is one too many. */
const bornAuto = (): ReturnType<typeof Events.trakCreated> =>
  Events.trakCreated("Think the importer through", undefined, "auto")

describe("a finished trak's proposed goal", () => {
  it("stops at the plan gate on manual, and approving starts one goal that drafts its file", async () => {
    const drafting = Effect.runSync(Deferred.make<void>())
    await onGit.runFlowWithAgentLog(
      [
        composerStopping("is this one effort or several", "work"),
        step(1, "work", reply.artifact(SETTLED)),
        proposesGoal,
        drafts(Deferred.await(drafting)),
      ],
      (id, agentLog, _checks, repoDir) =>
        Effect.gen(function* () {
          yield* atTheGate(id)
          const done = yield* act(id, 0, human.approve())
          expectState(done, "Finished")
          const goal = yield* startedOnce(id, agentLog)

          expect((yield* draftGoal(goal.id)).isError).toBe(false)
          yield* Deferred.succeed(drafting, undefined)
          const parked = yield* goalWhere(goal.id, atGate)
          expect(parked.state).toMatchObject({ _tag: "AtGate", gate: "file" })
        }).pipe(rootedAt(repoDir)),
    )
  })

  it("starts nothing where the finish proposes no goal", () =>
    runFlow(
      [
        composerStopping("is this one effort or several", "work"),
        step(1, "work", reply.artifact(SETTLED)),
        onPrompt(/You planned this turn yourself/, reply.finished("Settled."), "compose finishes"),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Think the importer through")
          expectState(yield* act(id, 1, human.approve()), "Finished")
          yield* watchGoalTraks(Stream.make(yield* frameOf(id)))
          yield* reconcileGoals
          expect(yield* goals).toEqual([])
        }),
    ))

  it("is started by the pass a restart runs, where no frame reached the watcher", () =>
    runFlow([proposesGoalAtOnce, drafts(Effect.void)], (id) =>
      Effect.gen(function* () {
        expectAwaitingProposal(yield* create(id, "Think the importer through"))
        expectState(yield* act(id, 0, human.approve()), "Finished")
        yield* reconcileGoals
        yield* reconcileGoals
        const goal = yield* theGoal
        expect(goal.openedBy?.from).toBe(id)
        // A trak that filed nothing hands the goal its proposal alone.
        expect(goal.documents).toEqual([])
      }),
    ))

  it.each(["smart", "decider"] as const)(
    "stops a finish on %s, which takes a plain finish unread",
    (mode) =>
      runFlow([proposesGoalAtOnce], (id) =>
        Effect.gen(function* () {
          const parked = yield* create(id, "Think the importer through", mode)
          expectAwaitingProposal(parked)
          expect(parked.marks.size).toBe(0)
        }),
      ),
  )

  it("goes past the gate on auto, and the goal's file gate is the first stop", async () => {
    const drafting = Effect.runSync(Deferred.make<void>())
    await onGit.runFlow(
      [proposesGoalAtOnce, drafts(Deferred.await(drafting))],
      (id, _a, _c, repoDir) =>
        Effect.gen(function* () {
          yield* (yield* Drives).start(id, bornAuto)
          yield* idle(id)
          // No `HumanActed`: the gate went past on the mode's account.
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "WorkCommitted",
          ])
          yield* watchGoalTraks(Stream.make(yield* frameOf(id)))
          const goal = yield* theGoal
          expect(goal.askedModes).toEqual(["auto"])
          expect((yield* draftGoal(goal.id)).isError).toBe(false)
          yield* Deferred.succeed(drafting, undefined)
          const parked = yield* goalWhere(goal.id, atGate)
          expect(parked.state).toMatchObject({ _tag: "AtGate", gate: "file" })
        }).pipe(rootedAt(repoDir)),
    )
  })
})

/**
 * The half a restart leaves: the finished trak's goal started on its own log, and the
 * trak's says nothing — then the pass a restart runs. Answers the goal started, the one
 * goal there is after the pass, and the goal the trak's log records.
 */
const startedButNotRecorded = (id: TrakId) =>
  Effect.gen(function* () {
    expectAwaitingProposal(yield* create(id, "Think the importer through"))
    const finished = yield* act(id, 0, human.approve())
    expectState(finished, "Finished")
    const [owed] = goalOwed(finished)
    if (owed === undefined) return yield* Effect.die("the finish owes no goal")
    const started = yield* startGoal(
      "goal",
      GoalEvents.asked(owed.asked, ["manual"], { from: id, call: proposalCall(owed.step) }),
    )
    yield* reconcileGoals
    const trak = replayHistory(id, yield* (yield* Store).events(id))
    return { started, only: (yield* theGoal).id, recorded: slotAt(trak, owed.step).goalOpened }
  })

describe("a proposed goal whose start a restart cut off", () => {
  it("is found and recorded, rather than opened a second time", () =>
    runFlow([proposesGoalAtOnce, drafts(Effect.void)], (id) =>
      Effect.gen(function* () {
        const { started, only, recorded } = yield* startedButNotRecorded(id)
        expect(only).toBe(started)
        expect(recorded).toBe(started)
      }),
    ))
})
