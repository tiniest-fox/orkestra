// A plan entry that waits for a time, end to end: the composer writes `wait_until` on
// the step, the engine resolves it against the moment the plan was composed, a not-yet
// rests the trak at `Finished` holding the entry, and the sweep wakes it on the instant
// rather than on an interval — with no press, and with nothing a restart forgets.
//
// `conditions.test.ts` owns what a resting trak still lets a person do; nothing here
// re-asserts a door. What this theme adds is the clock: where the instant comes from,
// that the step does not start before it and starts within one tick after, that a time
// held beside a condition hands the step to the condition once it has passed, and that
// the instant is what crosses the wire.
//
// **Two clocks, deliberately.** The plan is composed under a settable clock set eight
// hours in the past, so the log's own anchor — the stamp on the event carrying the
// proposal — puts the instant a minute before the live clock's now. The sweep is then
// run at times of the test's choosing, and the ask it forks runs on the live clock, as
// it does in the daemon — so *not due* is the sweep's arithmetic and *met* is the
// engine's own reading of a real clock. `test/support/clock.ts` has why the settable
// one goes around single calls.

import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { TrakDetailDto } from "@orkestra/shared/dto/trak"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { composer, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import {
  checkoutSurvived,
  act,
  create,
  expectAwaiting,
  expectState,
  human,
  idle,
  logged,
  logTags,
  workWaitingOn,
} from "../support/scenario.js"
import { fail, pass } from "../support/scripted-checks.js"
import { settableClock, type SettableClock } from "../support/clock.js"
import { reply } from "../support/scripted-agent.js"
import { Conditions } from "../../src/app/conditions.js"
import { mount } from "../support/http.js"
import { actionRoutes } from "../../src/app/routes/actions.js"
import { trakRoutes } from "../../src/app/routes/trak.js"
import { FileStoreLayer } from "../../src/workflow/adapters/store-file.js"
import { type TrakId, waitingAt } from "../../src/workflow/domain/trak.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import { Store } from "../../src/workflow/ports/store.js"

const { get, post } = mount(actionRoutes, trakRoutes)

const HOUR = 3_600_000
const MINUTE = 60_000
const ASKED_EVERY = 60

/** The plan is composed this long before the live clock's now. */
const COMPOSED_AGO = 8 * HOUR + MINUTE

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

/**
 * The plan every test here runs: a step that runs at once, then one the composer holds
 * for eight hours from the moment it planned. The instruction is the one `step`
 * matches on, so the scripted turn is found whatever else the entry carries.
 */
const planned = [
  composer("plan", { agent: "work", instruction: "Produce the work.", wait_until: "PT8H" }),
  step(1, "plan", reply.artifact("the plan")),
  step(2, "work", reply.artifact("verified the nightly output")),
]

const notYet = fail("pull request #7 is open", 1)

const eventsOf = (id: TrakId) => Effect.flatMap(Store, (store) => store.events(id))

const trakOf = (id: TrakId) => Effect.map(eventsOf(id), (events) => replayHistory(id, events))

/** When the proposal landed — the stamp on the event that carried it. */
const composedAt = (id: TrakId) =>
  Effect.map(eventsOf(id), (events) => events.find((e) => e._tag === "ComposerReturned")?.at)

/** The stamp on the log's last event. */
const lastStampOf = (id: TrakId) => Effect.map(eventsOf(id), (events) => events.at(-1)?.at ?? 0)

/** What the log's compose turn returned, as the detail sends it. */
const proposalOf = (detail: TrakDetailDto) => {
  const event = detail.log.find((e) => e._tag === "ComposerReturned")
  return event?._tag === "ComposerReturned" ? event.output : undefined
}

/** The log through the wait — the shape `conditions.test.ts` reaches too. */
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

const stepLanded = (tags: readonly string[]): boolean =>
  tags.at(-1) === "ChecksPassed" && tags.length > RESTED.length

const grewPastRest = (tags: readonly string[]): boolean => tags.length > RESTED.length

/**
 * Compose and approve under `clock`, so every stamp — the anchor among them — is the
 * settable clock's. Lands at rest, holding the entry that waits.
 */
const restedUnder = (id: TrakId, clock: SettableClock) =>
  Effect.gen(function* () {
    yield* create(id, "Verify the nightly job's output tomorrow morning")
    const parked = yield* act(id, 0, human.approve())
    expectAwaiting(parked, "approval")
    return yield* act(id, 1, human.approve())
  }).pipe(Effect.withClock(clock.clock))

const sweepAt = (clock: SettableClock) =>
  Effect.flatMap(Conditions, (c) => c.sweep).pipe(Effect.withClock(clock.clock))

const nextAskOf = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    const events = yield* store.events(id)
    return yield* (yield* Conditions).nextAsk(replayHistory(id, events), events)
  })

const jsonOf = (response: HttpServerResponse): Effect.Effect<unknown> =>
  Effect.promise(async (): Promise<unknown> => JSON.parse(await toWeb(response).text()))

const detailOf = (id: TrakId) =>
  Effect.map(Effect.flatMap(get(`/${id}`), jsonOf), Schema.decodeUnknownSync(TrakDetailDto))

describe("a step that waits for a time", () => {
  it("rests the trak holding the entry, with the instant resolved from when the plan was composed", async () => {
    await runFlowWithAgentLog(planned, (id, agent, checks) =>
      Effect.gen(function* () {
        const clock = settableClock(Date.now() - COMPOSED_AGO)
        const rested = yield* restedUnder(id, clock)
        expectState(rested, "Finished")
        expect(waitingAt(rested)).toStrictEqual({ step: 2, name: "wait_until", stopped: false })
        expect(stepRuns(yield* agent)).toHaveLength(1)
        // No script ran: the engine answered the clock itself.
        expect((yield* checks).ran).toEqual([])
        expect(yield* logTags(id)).toEqual(RESTED)

        // The anchor is the stamp on the event carrying the proposal, and the instant
        // is eight hours past it — the same number the sweep will wake on.
        const composed = yield* composedAt(id)
        expect(composed).toBeDefined()
        expect(rested.planAt).toBe(composed)
        expect(yield* nextAskOf(id)).toBe((composed ?? 0) + 8 * HOUR)
      }),
    )
  })

  it("does not start before the instant, and starts within one sweep after it — with nobody pressing", async () => {
    await runFlowWithAgentLog(planned, (id, agent) =>
      Effect.gen(function* () {
        const clock = settableClock(Date.now() - COMPOSED_AGO)
        yield* restedUnder(id, clock)
        const until = (yield* nextAskOf(id)) ?? 0

        // A minute before: not due, so nothing is asked and nothing runs.
        clock.advance(8 * HOUR - MINUTE)
        yield* sweepAt(clock)
        yield* idle(id)
        expect(stepRuns(yield* agent)).toHaveLength(1)
        expect(yield* logTags(id)).toEqual(RESTED)

        // The instant: due, and the engine's own clock agrees the time has come. The
        // step runs and stands at its gate exactly as one entered by an approval.
        clock.advance(MINUTE)
        expect(clock.clock.unsafeCurrentTimeMillis()).toBe(until)
        yield* sweepAt(clock)
        yield* logged(id, stepLanded)
        yield* idle(id)
        const parked = yield* trakOf(id)
        expectAwaiting(parked, "approval")
        expectState(parked, "AwaitingHuman", 2)
        expect(waitingAt(parked)).toBeUndefined()
        expect(stepRuns(yield* agent)).toHaveLength(2)
        expect(yield* logTags(id)).toEqual([
          ...RESTED,
          "ConditionsMet",
          "AgentReturned",
          "ChecksPassed",
        ])
      }),
    )
  })

  it("crosses the wire as the instant — on the waiting trak, on the plan's held entry, and on the proposal", async () => {
    await runFlowWithAgentLog(planned, (id) =>
      Effect.gen(function* () {
        const clock = settableClock(Date.now() - COMPOSED_AGO)
        yield* restedUnder(id, clock)
        const until = yield* nextAskOf(id)
        const detail = yield* detailOf(id)
        expect(detail.waiting).toStrictEqual({ step: 2, name: "wait_until", stopped: false, until })
        expect(detail.nextAsk).toBe(until)
        // The held entry carries it; the entry that ran carries nothing — its anchor is
        // a compose turn the trak no longer names — and a proposal carries it on every
        // step, anchored on the event that carried the proposal.
        expect(detail.plan?.steps[2]).toMatchObject({ agent: "work", waitUntil: until })
        expect(detail.plan?.steps[1]).not.toHaveProperty("waitUntil")
        expect(proposalOf(detail)).toMatchObject({
          type: "proposal",
          steps: [{ agent: "plan" }, { agent: "work", waitUntil: until }],
        })
      }),
    )
  })

  it("enters the step in the same drive the plan lands in, and still knows when it was composed", async () => {
    // On `auto` the plan is not read by anyone: the proposal lands and its first step
    // is entered in one call of `advance`, before the store has written the event. The
    // anchor has to be on the trak the commands are handed, not only on the log.
    await runFlowWithAgentLog(planned, (id) =>
      Effect.gen(function* () {
        const clock = settableClock(Date.now() - COMPOSED_AGO)
        const rested = yield* create(
          id,
          "Verify the nightly job's output tomorrow morning",
          "auto",
        ).pipe(Effect.withClock(clock.clock))
        expectState(rested, "Finished")
        expect(waitingAt(rested)).toMatchObject({ step: 2, name: "wait_until" })
        expect(yield* nextAskOf(id)).toBe(clock.clock.unsafeCurrentTimeMillis() + 8 * HOUR)
      }),
    )
  })
})

describe("a person runs a waiting step now", () => {
  it("starts the step before the instant, and the turn is told the clock had not come round", async () => {
    // The two halves of this work meet here: the press knows only that the position
    // holds a wait, and a time wait is one — recorded under `wait_until`, which is the
    // name the forced turn is given. Named rather than passed over in silence, because
    // what the clock stands in for is the thing that has not happened yet: a step told
    // to check the nightly job's output and started early must not report on a run that
    // has not been made.
    await runFlowWithAgentLog(planned, (id, agent, checks) =>
      Effect.gen(function* () {
        const clock = settableClock(Date.now() - COMPOSED_AGO)
        const rested = yield* restedUnder(id, clock)
        expect(waitingAt(rested)).toMatchObject({ step: 2, name: "wait_until" })

        const response = yield* post(id, "run-now", {})
        expect(response.status).toBe(202)
        yield* logged(id, stepLanded)
        yield* idle(id)

        const parked = yield* trakOf(id)
        expectAwaiting(parked, "approval")
        expectState(parked, "AwaitingHuman", 2)
        expect(waitingAt(parked)).toBeUndefined()
        // Still no script: the clock is the engine's own answer, and the press asks
        // nothing behind it either.
        expect((yield* checks).ran).toEqual([])
        expect(yield* logTags(id)).toEqual([
          ...RESTED,
          "WaitSkipped",
          "AgentReturned",
          "ChecksPassed",
        ])

        const runs = stepRuns(yield* agent)
        expect(runs).toHaveLength(2)
        expect(runs[1]?.prompt).toContain("This step was held until `wait_until` was met")
        expect(runs[1]?.prompt).toContain("started the step anyway")
      }),
    )
  })
})

describe("a time held beside a condition", () => {
  it("is asked first, and hands the step to the condition once it has passed", async () => {
    await runFlowWithAgentLog(
      planned,
      (id, agent, checks) =>
        Effect.gen(function* () {
          const clock = settableClock(Date.now() - COMPOSED_AGO)
          const rested = yield* restedUnder(id, clock)
          // The time is the wait, and the script was never run: nothing behind an
          // unmet condition is asked.
          expect(waitingAt(rested)).toMatchObject({ name: "wait_until" })
          expect((yield* checks).ran).toEqual([])

          // The instant passes. The time is met, the script says not yet — and that
          // not-yet lands, so the trak now waits on the script by name and the sweep
          // asks it on its own interval rather than on every tick past the instant.
          clock.advance(8 * HOUR)
          yield* sweepAt(clock)
          yield* logged(id, grewPastRest)
          yield* idle(id)
          const handed = yield* trakOf(id)
          expectState(handed, "Finished")
          expect(waitingAt(handed)).toStrictEqual({ step: 2, name: "pr-merged", stopped: false })
          expect((yield* checks).ran).toEqual(["pr-merged"])
          expect(yield* logTags(id)).toEqual([...RESTED, "ConditionsUnmet"])
          expect(stepRuns(yield* agent)).toHaveLength(1)

          // From here it is a polled wait: the next ask is one interval past the answer
          // the log holds, which was stamped on the live clock the ask ran on.
          const answered = yield* lastStampOf(id)
          expect(yield* nextAskOf(id)).toBe(answered + ASKED_EVERY * 1000)
          const sweepClock = settableClock(answered + ASKED_EVERY * 1000)
          yield* sweepAt(sweepClock)
          yield* logged(id, stepLanded)
          yield* idle(id)
          expect((yield* checks).ran).toEqual(["pr-merged", "pr-merged"])
          expectAwaiting(yield* trakOf(id), "approval")
        }),
      workWaitingOn(["pr-merged"], { checks: SCRIPTS }),
      { "pr-merged": [notYet, pass] },
    )
  })
})

const newRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "orkestra-time-wait-"))
  mkdirSync(join(dir, ".orkestra"), { recursive: true })
  return dir
}

describe("a daemon restarted while a trak waits for a time", () => {
  it("wakes it on the instant from the log alone, with no memory of the first process", async () => {
    const dir = newRepo()
    await runFlowWithAgentLog(
      planned,
      (id) =>
        Effect.gen(function* () {
          const clock = settableClock(Date.now() - COMPOSED_AGO)
          expectState(yield* restedUnder(id, clock), "Finished")
        }),
      undefined,
      undefined,
      FileStoreLayer(dir),
    )
    await runFlowWithAgentLog(
      [step(2, "work", reply.artifact("verified the nightly output"))],
      (id, agent) =>
        Effect.gen(function* () {
          yield* checkoutSurvived(id)
          const found = yield* trakOf(id)
          expect(waitingAt(found)).toStrictEqual({ step: 2, name: "wait_until", stopped: false })
          const until = (yield* nextAskOf(id)) ?? 0
          expect(until).toBe((found.planAt ?? 0) + 8 * HOUR)

          // Before the instant nothing happens, however long the process was down.
          yield* sweepAt(settableClock(until - 1))
          yield* idle(id)
          expect(stepRuns(yield* agent)).toHaveLength(0)

          yield* sweepAt(settableClock(until))
          yield* logged(id, stepLanded)
          yield* idle(id)
          expect(stepRuns(yield* agent)).toHaveLength(1)
          expectAwaiting(yield* trakOf(id), "approval")
        }),
      undefined,
      undefined,
      FileStoreLayer(dir),
    )
  })
})
