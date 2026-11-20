// A plan entry that waits to start, end to end: an agent declares a condition, the
// engine asks it before the step runs, and a not-yet rests the trak at `Finished`
// holding the entry — with every door a finished trak has still open — until the
// daemon's sweep asks again and finds the world has moved.
//
// The theme is the three answers a condition script can give and what each does to
// the trak, plus the two things around them that are easy to get wrong: what a
// resting trak still lets a person do, and what a daemon restart forgets. What a
// script DOES is scripted per test, for `checks.test.ts`'s reason.
//
// Time is the one thing here the engine reads, and it is moved by hand: the sweep is
// run directly on a clock the test advances, so an interval of a minute costs no
// minute. The drive the sweep forks runs on the live clock, and `idle` waits for it.

import { existsSync, mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Deferred, Effect, Schedule } from "effect"
import { describe, expect, it } from "vitest"
import {
  afterReentry,
  composer,
  type FlowDeps,
  runFlowWithAgentLog,
  step,
  stepRuns,
} from "../support/flow.js"
import { worktreeOf } from "../support/git.js"
import {
  act,
  createAndStart,
  expectAwaiting,
  expectAwaitingProposal,
  expectState,
  human,
  idle,
  logged,
  logTags,
  workWaitingOn,
} from "../support/scenario.js"
import { fail, heldBack, pass } from "../support/scripted-checks.js"
import { settableClock } from "../support/clock.js"
import { countingStore, noReads, timesRead } from "../support/counting-store.js"
import { reply, type Turn } from "../support/scripted-agent.js"
import { Conditions } from "../../src/app/conditions.js"
import { FileStoreLayer } from "../../src/workflow/adapters/store-file.js"
import { Events } from "../../src/workflow/domain/event.js"
import { type Trak, type TrakId, waitingAt } from "../../src/workflow/domain/trak.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import { Runs } from "../../src/workflow/ports/runs.js"
import { Store } from "../../src/workflow/ports/store.js"
import { Drives } from "../../src/app/drive.js"
import { mount } from "../support/http.js"
import { actionRoutes } from "../../src/app/routes/actions.js"
import { mergeRoutes } from "../../src/app/routes/merge.js"
import { advance, type RuntimeError } from "../../src/workflow/runtime.js"

const { post } = mount(actionRoutes, mergeRoutes)

const ASKED_EVERY = 60

const SCRIPTS = new Map([
  [
    "pr-merged",
    {
      name: "pr-merged",
      description: "Whether this branch's pull request has merged.",
      timeoutSeconds: 30,
      askedEverySeconds: ASKED_EVERY,
      exclusive: false,
      cache: true,
      ignoresLinguistGenerated: false,
      units: undefined,
      cacheAcross: "platform" as const,
      path: "/repo/.orkestra/checks/pr-merged.sh",
    },
  ],
])

/** A fleet whose `work` agent waits on the given conditions. Policy, not plan. */
const waitingOn = (...conditions: readonly string[]) =>
  workWaitingOn(conditions, { checks: SCRIPTS })

/**
 * The plan every test here runs: a step that runs at once, then the one that waits.
 * `plan` declares no condition, so the wait is the second entry's alone and the first
 * gate is an ordinary one.
 */
const planned = [
  composer("plan", "work"),
  step(1, "plan", reply.artifact("the plan")),
  step(2, "work", reply.artifact("posted the update")),
]

/** Not yet, and never will be. */
const notYet = fail("pull request #7 is open", 1)
const gaveUp = fail("pull request #7 was closed without merging", 2)

/** The trak as its log replays. */
const trakOf = (id: TrakId) =>
  Effect.map(
    Effect.flatMap(Store, (store) => store.events(id)),
    (events) => replayHistory(id, events),
  )

/** The log through the wait, as every test here reaches it. */
const RESTED: readonly string[] = [
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
  "ConditionsUnmet",
  "WorkCommitted",
]

/** The held step ran to its checks after the rest — what a met answer lands. */
const stepLanded = (tags: readonly string[]): boolean =>
  tags.at(-1) === "ChecksPassed" && tags.length > RESTED.length

/** Something landed after the rest. Hoisted, with the one above: a callback too deep. */
const grewPastRest = (tags: readonly string[]): boolean => tags.length > RESTED.length

/** Approve the plan and the first step, which is what reaches the waiting entry. */
const untilWaiting = (id: TrakId) =>
  Effect.gen(function* () {
    const parked = yield* createAndStart(id, "Add a --json flag")
    expectAwaiting(parked, "approval")
    return yield* act(id, 1, human.approve())
  })

/**
 * One sweep, at a time of the test's choosing. The clock is provided around this call
 * and nothing else — see `test/support/clock.ts`.
 */
const sweepAt = (clock: ReturnType<typeof settableClock>) =>
  Effect.flatMap(Conditions, (c) => c.sweep).pipe(Effect.withClock(clock.clock))

const nextAskOf = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    const events = yield* store.events(id)
    return yield* (yield* Conditions).nextAsk(replayHistory(id, events), events)
  })

/**
 * Wait until the condition has been asked `times` times — the script may be held open,
 * so `idle` cannot say when it started, and the fake records a run as it begins.
 */
const askedTimes = (checks: Effect.Effect<{ readonly ran: readonly string[] }>, times: number) =>
  Effect.repeat(
    Effect.map(checks, (log) => log.ran.filter((name) => name === "pr-merged").length),
    { until: (n) => n >= times, schedule: Schedule.spaced("1 millis") },
  ).pipe(Effect.timeout("20 seconds"), Effect.orDie, Effect.asVoid)

describe("a condition that is not met", () => {
  it("rests the trak at Finished holding the entry, and does not run the step", async () => {
    await runFlowWithAgentLog(
      planned,
      (id, agent, checks) =>
        Effect.gen(function* () {
          const rested = yield* untilWaiting(id)
          expectState(rested, "Finished")
          expect(waitingAt(rested)).toStrictEqual({ step: 2, name: "pr-merged", stopped: false })
          // The step was not entered: one turn, the plan's. The condition was asked
          // once, on the way in, and the checkout is still there for whatever runs.
          expect(stepRuns(yield* agent)).toHaveLength(1)
          expect((yield* checks).ran).toEqual(["pr-merged"])
          expect(existsSync(worktreeOf(rested).path)).toBe(true)
          // The first not-yet is on the log, and it rested the trak through the same
          // commit a plan running out takes. Nothing after it is a poll.
          expect(yield* logTags(id)).toEqual(RESTED)
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet] },
    )
  })

  it("is asked on the interval the script declares, and nothing is written for a not-yet", async () => {
    await runFlowWithAgentLog(
      planned,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const rested = yield* untilWaiting(id)
          const clock = settableClock(Date.now())

          // Not due: the answer that rested the trak is seconds old, and the interval
          // counts from it — the log's own record, which is also what a restart reads.
          yield* sweepAt(clock)
          yield* idle(id)
          expect((yield* checks).ran).toEqual(["pr-merged"])

          clock.advance(ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* askedTimes(checks, 2)
          yield* idle(id)
          // Asked, still not: a poll is memory, and the log is exactly as it was.
          expect((yield* checks).ran).toEqual(["pr-merged", "pr-merged"])
          expect(yield* logTags(id)).toEqual(RESTED)
          expectState(yield* trakOf(id), "Finished")

          // The next ask is one interval past that poll, and a person can read it.
          expect(yield* nextAskOf(id)).toBe(
            clock.clock.unsafeCurrentTimeMillis() + ASKED_EVERY * 1000,
          )
          expect(waitingAt(rested)).toMatchObject({ name: "pr-merged" })
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet] },
    )
  })
})

describe("a condition that comes to be met", () => {
  it("runs the step by itself, with nobody pressing anything", async () => {
    await runFlowWithAgentLog(
      planned,
      (id, agent, checks) =>
        Effect.gen(function* () {
          yield* untilWaiting(id)
          const clock = settableClock(Date.now())

          clock.advance(ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* logged(id, stepLanded)
          yield* idle(id)

          // The step ran and stands at its own gate, exactly as one entered by an
          // approval would. `ConditionsMet` is what moved the resting trak, and no
          // `HumanActed` sits between the rest and the turn.
          const parked = yield* trakOf(id)
          expectAwaiting(parked, "approval")
          expectState(parked, "AwaitingHuman", 2)
          expect(waitingAt(parked)).toBeUndefined()
          expect(stepRuns(yield* agent)).toHaveLength(2)
          expect((yield* checks).ran).toEqual(["pr-merged", "pr-merged"])
          expect(yield* logTags(id)).toEqual([
            ...RESTED,
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
          ])

          // And the rest of the plan runs out as it always did.
          expectState(yield* act(id, 2, human.approve()), "Finished")
          expect(waitingAt(yield* trakOf(id))).toBeUndefined()
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet, pass] },
    )
  })

  it("is asked only on a step's first entry — a resume never asks again", async () => {
    await runFlowWithAgentLog(
      planned,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          yield* untilWaiting(id)
          const clock = settableClock(Date.now())
          clock.advance(ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* logged(id, stepLanded)
          yield* idle(id)
          expectAwaiting(yield* trakOf(id), "approval")

          // A chat resumes the step's session. Were the condition asked again here the
          // script would say not-yet and the step's conversation would be lost to a rest.
          yield* act(id, 2, human.chat("say more"))
          expect((yield* checks).ran).toEqual(["pr-merged", "pr-merged"])
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet, pass, notYet] },
    )
  })
})

describe("a condition that gives up", () => {
  it("stops the asking and leaves the trak at Finished with its checkout, not failed", async () => {
    await runFlowWithAgentLog(
      planned,
      (id, agent, checks) =>
        Effect.gen(function* () {
          const rested = yield* untilWaiting(id)
          const clock = settableClock(Date.now())

          clock.advance(ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* logged(id, grewPastRest)
          yield* idle(id)

          const stopped = yield* trakOf(id)
          expectState(stopped, "Finished")
          expect(waitingAt(stopped)).toStrictEqual({ step: 2, name: "pr-merged", stopped: true })
          // What the script said is on the event, where a surface can quote it.
          expect(yield* logTags(id)).toEqual([...RESTED, "ConditionsUnmet"])
          expect(existsSync(worktreeOf(rested).path)).toBe(true)
          expect(stepRuns(yield* agent)).toHaveLength(1)

          // Asked no more, however long it rests — and nothing to count down to.
          clock.advance(ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* Effect.sleep("20 millis")
          expect((yield* checks).ran).toEqual(["pr-merged", "pr-merged"])
          expect(yield* nextAskOf(id)).toBeUndefined()
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet, gaveUp] },
    )
  })
})

describe("every door a finished trak has stays open while it waits", () => {
  it("sent back: the composer is asked, and the held entry is what it re-cuts", async () => {
    await runFlowWithAgentLog(
      [...planned, afterReentry("work")],
      (id) =>
        Effect.gen(function* () {
          yield* untilWaiting(id)
          const replanned = yield* advance(id, Events.reentered("the pull request needs a rebase"))
          expectAwaitingProposal(replanned)
          // The wait went with the entry it held: the plan is re-cut from that index,
          // and nothing reads a fact left on an index that now names the composer.
          expect(waitingAt(replanned)).toBeUndefined()
          expect(replanned.plan?.steps[2]).toMatchObject({ type: "compose" })
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet] },
    )
  })

  it("asked: the engine's own agent answers, on an entry standing where the wait was", async () => {
    await runFlowWithAgentLog(
      [...planned, step(2, "generic", reply.artifact("no — the parser is untouched"))],
      (id) =>
        Effect.gen(function* () {
          yield* untilWaiting(id)
          const answered = yield* advance(
            id,
            Events.reentered("does this touch the parser?", "generic"),
          )
          expectAwaiting(answered, "approval")
          expect(waitingAt(answered)).toBeUndefined()
          expect(answered.plan?.steps[2]).toMatchObject({ agent: "generic", conversational: true })
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet] },
    )
  })

  it("merged: the branch goes in and the pending step goes with the trak", async () => {
    await runFlowWithAgentLog(
      planned,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          yield* untilWaiting(id)
          const merged = yield* advance(id, Events.merged())
          expectState(merged, "Merged")
          expect(waitingAt(merged)).toBeUndefined()
          // Nothing is left for the sweep to find.
          const clock = settableClock(Date.now() + ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* idle(id)
          expect((yield* checks).ran).toEqual(["pr-merged"])
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet] },
    )
  })

  it("archived: the checkout goes and the pending step is dropped", async () => {
    await runFlowWithAgentLog(
      planned,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const rested = yield* untilWaiting(id)
          const closed = yield* advance(id, Events.closed())
          expectState(closed, "Closed")
          expect(waitingAt(closed)).toBeUndefined()
          expect(existsSync(worktreeOf(rested).path)).toBe(false)
          const clock = settableClock(Date.now() + ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* idle(id)
          expect((yield* checks).ran).toEqual(["pr-merged"])
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet] },
    )
  })
})

/** A fresh directory that looks like a project — `orkestraDir` needs a marker. */
/** One press on a route, accepted and driven to its end. Hoisted: a callback too deep. */
const pressed = (id: TrakId, path: string, body: unknown) =>
  Effect.gen(function* () {
    const response = yield* post(id, path, body)
    expect([path, response.status]).toEqual([path, 202])
    yield* idle(id)
  })

/** How many of one event a log holds — hoisted for the same reason. */
const countOf = (tags: readonly string[], tag: string): number =>
  tags.filter((t) => t === tag).length

/** The prompt the held step's first turn was given — the second step run of the flow. */
const forcedPrompt = (runs: readonly { readonly prompt: string }[]): string | undefined =>
  runs[1]?.prompt

describe("a person runs the held step now", () => {
  it("enters the step without asking the script again, and tells it what was skipped", async () => {
    await runFlowWithAgentLog(
      planned,
      (id, agent, checks) =>
        Effect.gen(function* () {
          yield* untilWaiting(id)
          yield* pressed(id, "run-now", {})
          yield* logged(id, stepLanded)
          yield* idle(id)

          // The step ran and stands at its own gate, as one the sweep entered would —
          // with the press on the log where a met answer would be, and no second ask.
          const parked = yield* trakOf(id)
          expectAwaiting(parked, "approval")
          expectState(parked, "AwaitingHuman", 2)
          expect(waitingAt(parked)).toBeUndefined()
          expect((yield* checks).ran).toEqual(["pr-merged"])
          expect(yield* logTags(id)).toEqual([
            ...RESTED,
            "WaitSkipped",
            "AgentReturned",
            "ChecksPassed",
          ])
          const store = yield* Store
          expect((yield* store.events(id)).at(-3)).toMatchObject({
            _tag: "WaitSkipped",
            step: 2,
            name: "pr-merged",
          })
          // No pull request on the branch, so the re-asked `merged` landed nothing.
          expect(parked.landed).toBeUndefined()

          // The turn is told which condition it was waiting on, and that it does not hold.
          const prompt = forcedPrompt(stepRuns(yield* agent))
          expect(prompt).toContain("This step was held until `pr-merged` was met, and it is not")
          expect(prompt).toContain("started the step anyway")

          expectState(yield* act(id, 2, human.approve()), "Finished")
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet] },
    )
  })

  it("is the way out of a wait that has given up", async () => {
    await runFlowWithAgentLog(
      planned,
      (id, agent) =>
        Effect.gen(function* () {
          yield* untilWaiting(id)
          const clock = settableClock(Date.now())
          clock.advance(ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* logged(id, grewPastRest)
          yield* idle(id)
          expect(waitingAt(yield* trakOf(id))).toMatchObject({ stopped: true })

          yield* pressed(id, "run-now", {})
          yield* logged(id, stepLanded)
          yield* idle(id)
          expectState(yield* trakOf(id), "AwaitingHuman", 2)
          expect(stepRuns(yield* agent)).toHaveLength(2)
          expect(forcedPrompt(stepRuns(yield* agent))).toContain("held until `pr-merged`")
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet, gaveUp] },
    )
  })
})

describe("a person's press wins over an ask in flight", () => {
  /**
   * A waiting trak with its condition script running and held open, so a press lands
   * while the ask is in flight. The script answers *met* once released — the answer
   * that would enter the step, and the one a press has to beat.
   */
  const pressWhileAsking = (
    press: (id: TrakId) => Effect.Effect<void, RuntimeError, FlowDeps>,
    turns: readonly Turn[] = [],
  ) => {
    const release = Effect.runSync(Deferred.make<void>())
    return runFlowWithAgentLog(
      [...planned, ...turns],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          yield* untilWaiting(id)
          const clock = settableClock(Date.now())
          clock.advance(ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* askedTimes(checks, 2)

          // The ask holds neither the drive key nor custody, so a route that refuses
          // a driven trak with 409 accepts the press, and a pane reading custody draws
          // nothing disabled.
          expect(yield* Effect.flatMap(Drives, (d) => d.driving(id))).toBe(false)
          expect(yield* Effect.flatMap(Runs, (r) => r.holder(id))).toBeUndefined()
          yield* press(id)
          const before = yield* logTags(id)

          // Released, the script says met — and the answer finds a trak that has moved
          // on, and lands nothing: the press won, and the log is exactly as the press
          // left it. The answer's drive is forked once the script returns, so a moment
          // is given for it to begin before the wait for it to end.
          yield* Deferred.succeed(release, undefined)
          yield* Effect.sleep("50 millis")
          yield* idle(id)
          expect(yield* logTags(id)).toEqual(before)
          expect(countOf(before, "ConditionsMet")).toBe(1)
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet, heldBack(Deferred.await(release), pass)] },
    )
  }

  it("archive: the route accepts, the checkout goes, and the late answer lands nothing", () =>
    pressWhileAsking((id) =>
      Effect.gen(function* () {
        yield* pressed(id, "close", {})
        expect((yield* trakOf(id)).state._tag).toBe("Closed")
      }),
    ))

  it("merge: the branch goes in under the ask", () =>
    pressWhileAsking((id) =>
      Effect.gen(function* () {
        yield* pressed(id, "merge", {})
        expect((yield* trakOf(id)).state._tag).toBe("Merged")
      }),
    ))

  it("send it back: the composer is asked, and the held entry is what it re-cuts", () =>
    pressWhileAsking(
      (id) =>
        Effect.gen(function* () {
          yield* pressed(id, "reenter", { what: "the pull request needs a rebase" })
          expect((yield* trakOf(id)).state._tag).toBe("AwaitingProposal")
        }),
      [afterReentry("work")],
    ))
})

const newRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "orkestra-conditions-"))
  mkdirSync(join(dir, ".orkestra"), { recursive: true })
  return dir
}

describe("a daemon restarted while a trak waits", () => {
  it("asks the condition again on its first sweep past the interval, with no press", async () => {
    const dir = newRepo()
    // The first process: the trak rests, and the process goes away with everything it
    // held in memory — which is when it last asked.
    await runFlowWithAgentLog(
      planned,
      (id) =>
        Effect.gen(function* () {
          expectState(yield* untilWaiting(id), "Finished")
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet] },
      FileStoreLayer(dir),
    )
    // The second: the same log, a fresh layer set, and a sweep. The interval is read
    // off the answer the log holds, so the trak is asked once it has elapsed and not
    // before — a restart re-arms every wait without asking every one at once.
    await runFlowWithAgentLog(
      [],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const found: Trak = yield* trakOf(id)
          expect(waitingAt(found)).toMatchObject({ step: 2, name: "pr-merged", stopped: false })

          const clock = settableClock(Date.now())
          yield* sweepAt(clock)
          yield* idle(id)
          expect((yield* checks).ran).toEqual([])

          clock.advance(ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* askedTimes(checks, 1)
          expect((yield* checks).ran).toEqual(["pr-merged"])
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet] },
      FileStoreLayer(dir),
    )
  })
})

/**
 * The memory store, with every read of a log written down by trak — what a sweep
 * opened, which nothing else records.
 */
describe("a trak that is put away", () => {
  it("is not opened by the sweep once its log has said so", async () => {
    const reads = noReads()
    await runFlowWithAgentLog(
      planned,
      (id) =>
        Effect.gen(function* () {
          yield* untilWaiting(id)
          const clock = settableClock(Date.now())
          clock.advance(ASKED_EVERY * 1000)

          // Live, a tick opens the log to see what it is waiting on.
          const before = timesRead(reads.events, id)
          yield* sweepAt(clock)
          yield* idle(id)
          expect(timesRead(reads.events, id)).toBeGreaterThan(before)

          // Closed, the append that ended it put it in the archived set, and a tick
          // does not open it again — it is not waiting, and nothing has to read the
          // log to know that.
          expect((yield* post(id, "close", {})).status).toBe(202)
          yield* idle(id)
          expectState(yield* trakOf(id), "Closed")
          const closed = timesRead(reads.events, id)
          clock.advance(ASKED_EVERY * 1000)
          yield* sweepAt(clock)
          yield* idle(id)
          expect(timesRead(reads.events, id)).toBe(closed)
        }),
      waitingOn("pr-merged"),
      { "pr-merged": [notYet, notYet] },
      countingStore(reads),
    )
  })
})
