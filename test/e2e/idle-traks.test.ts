// A trak left alone for three days goes idle by itself: its row says so, and neither the
// list nor the condition sweep opens its log again until something is appended to it.
//
// Time is the events' own: each log is seeded with `at` stamped days in the past, and the
// routes read the live clock. Reads are counted at the store, so what is asserted is the
// difference a second read makes, never the absolute count.

import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { TrakListDto } from "@orkestra/shared/dto/trak"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { SessionId } from "../../src/agent/types/session.js"
import { Conditions } from "../../src/app/conditions.js"
import { trakRoutes } from "../../src/app/routes/trak.js"
import { BranchName, CommitSha, WorktreePath } from "../../src/vcs/index.js"
import { IDLE_AFTER_MS } from "../../src/workflow/domain/activity.js"
import { type Event, Events, stamped } from "../../src/workflow/domain/event.js"
import { proposal } from "../../src/workflow/domain/outputs/proposal.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import { countingStore, noReads, timesRead } from "../support/counting-store.js"
import { runFlow } from "../support/flow.js"
import { mount } from "../support/http.js"
import { seedLog } from "../support/seed.js"

const { get } = mount(trakRoutes)

const DAY = 24 * 60 * 60 * 1000
const sid = SessionId.make("00000000-0000-4000-8000-000000000001")

/** A trak parked at its plan gate, every event stamped `ago` milliseconds back. */
const parkedSince = (ago: number): readonly Event[] =>
  [
    Events.trakCreated("d"),
    Events.worktreeReady({
      path: WorktreePath.make("/tmp/wt"),
      branch: BranchName.make("trak/t"),
      base: CommitSha.make("base000"),
    }),
    Events.composerReturned(
      sid,
      proposal("Add a --json flag", [{ agent: "plan", instruction: "Produce the plan." }]),
    ),
  ].map((e) => stamped(e, Date.now() - ago))

const listed = Effect.flatMap(get(""), (response: HttpServerResponse) =>
  Effect.promise(async () => Schema.decodeUnknownSync(TrakListDto)(await toWeb(response).json())),
)

const rowOf = (id: TrakId) => Effect.map(listed, (list) => list.traks.find((row) => row.id === id))

describe("an idle trak", () => {
  it("is idle once nothing has happened for three days, and active at two", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        const recent = TrakId.make("recent-trak")
        yield* seedLog(store, id, parkedSince(IDLE_AFTER_MS + DAY))
        yield* seedLog(store, recent, parkedSince(2 * DAY))

        const left = yield* rowOf(id)
        expect(left).toMatchObject({ idle: true, state: { _tag: "AwaitingProposal" } })
        expect(left?.active).toBeLessThan(Date.now() - IDLE_AFTER_MS)
        const worked = yield* rowOf(recent)
        expect(worked).not.toHaveProperty("idle")
        expect(worked?.active).toBeGreaterThan(Date.now() - IDLE_AFTER_MS)
      }),
    )
  })

  it("is served from memory, and read again after a person's press", async () => {
    const reads = noReads()
    await runFlow(
      [],
      (id) =>
        Effect.gen(function* () {
          const store = yield* Store
          const log = parkedSince(IDLE_AFTER_MS + DAY)
          yield* seedLog(store, id, log)
          const first = yield* rowOf(id)
          const opened = timesRead(reads.events, id)

          // The same row again, and the log was not opened for it.
          expect(yield* rowOf(id)).toStrictEqual(first)
          expect(timesRead(reads.events, id)).toBe(opened)

          // A press is activity: the next list reads the log, and the row is active. Appended
          // from the seeded count rather than through `seedLog`, whose read would count here.
          yield* store.append(id, [Events.modeChanged("manual")], { after: log.length })
          const woken = yield* rowOf(id)
          expect(timesRead(reads.events, id)).toBe(opened + 1)
          expect(woken).toMatchObject({ mode: "manual" })
          expect(woken).not.toHaveProperty("idle")
        }),
      undefined,
      countingStore(reads),
    )
  })

  it("is active again after a turn finishes on it", async () => {
    await runFlow([], (id) =>
      Effect.gen(function* () {
        const store = yield* Store
        const log = parkedSince(IDLE_AFTER_MS + DAY)
        yield* seedLog(store, id, log)
        expect(yield* rowOf(id)).toMatchObject({ idle: true })

        yield* store.append(id, [Events.turnFailed(undefined, sid, "the provider went")], {
          after: log.length,
        })
        const woken = yield* rowOf(id)
        expect(woken).toMatchObject({ state: { _tag: "Failed" } })
        expect(woken).not.toHaveProperty("idle")
      }),
    )
  })

  it("is skipped by the condition sweep without its log being opened", async () => {
    const reads = noReads()
    await runFlow(
      [],
      (id) =>
        Effect.gen(function* () {
          const store = yield* Store
          const recent = TrakId.make("recent-trak")
          yield* seedLog(store, id, parkedSince(IDLE_AFTER_MS + DAY))
          yield* seedLog(store, recent, parkedSince(2 * DAY))
          const conditions = yield* Conditions

          // The first sweep reads both, which is what classifies them.
          yield* conditions.sweep
          const idleOpened = timesRead(reads.events, id)
          const recentOpened = timesRead(reads.events, recent)

          // From then on the idle trak costs nothing, and the active one is read each tick.
          yield* conditions.sweep
          yield* conditions.sweep
          expect(timesRead(reads.events, id)).toBe(idleOpened)
          expect(timesRead(reads.events, recent)).toBe(recentOpened + 2)
        }),
      undefined,
      countingStore(reads),
    )
  })
})
