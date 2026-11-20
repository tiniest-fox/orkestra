// The GoalStore port's contract, written once and run against every implementation —
// `store.ts`'s suite for `Store`, over a goal's log and transcript.
//
// The same promises: what round-trips, what stays isolated between goals, and — the file
// adapter's alone to break — what a line that will not decode does. Each case gets its own
// scratch directory, so state persists across calls within one test and never leaks.

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { NoteEntry, SpawnedEntry, ToolEntry } from "../../src/agent/types/transcript-entry.js"
import { SessionId } from "../../src/agent/types/session.js"
import { Events } from "../../src/workflow/domain/event.js"
import { GoalEvents, type GoalEvent, stampedGoal } from "../../src/workflow/domain/goal.js"
import { GoalId, TrakId } from "../../src/workflow/domain/trak.js"
import { GoalStore, type GoalStoreShape } from "../../src/workflow/ports/goal-store.js"
import { Store } from "../../src/workflow/ports/store.js"
import type { StoreFailed } from "../../src/workflow/ports/store-errors.js"

export interface GoalStoreUnderTest {
  readonly label: string
  readonly layer: (scratchDir: string) => Layer.Layer<GoalStore, StoreFailed>
  /**
   * The trak `Store` the goal store is deployed beside, over the same scratch directory.
   * Only the `remove` case reads it.
   */
  readonly store: (scratchDir: string) => Layer.Layer<Store, StoreFailed>
}

/** File only: what `storeCorruptionContract` asks of a trak's log, asked of a goal's. */
export interface GoalStoreCorruptionUnderTest extends GoalStoreUnderTest {
  readonly corrupt: (scratchDir: string, id: GoalId) => void
  readonly unreadable: (scratchDir: string, id: GoalId) => void
}

const freshId = (label: string): GoalId =>
  GoalId.make(`${label}-${Math.random().toString(36).slice(2)}`)

const inGoalStore = (
  layer: (scratchDir: string) => Layer.Layer<GoalStore, StoreFailed>,
  body: (store: GoalStoreShape, scratchDir: string) => Promise<void>,
): Promise<void> => {
  const scratchDir = mkdtempSync(join(tmpdir(), "orkestra-goal-store-"))
  return Effect.runPromise(
    Effect.flatMap(GoalStore, (store) => Effect.promise(() => body(store, scratchDir))).pipe(
      Effect.provide(layer(scratchDir)),
    ),
  )
}

const sid = SessionId.make("00000000-0000-4000-8000-000000000002")
const TRAK = TrakId.make("t-1")
const SPEC = { file: "goals/search.md", title: "Search", line: "l", finished: "done", limits: {} }
const PLANNED = { title: "Index", description: "build the index", mode: "smart" } as const
const WHICH = [{ question: "which?", options: [{ label: "this", recommended: true }] }] as const

/**
 * One instance of every `GoalEvent` variant that is written — round-tripping this proves
 * the whole union. `EscalatedOnce` is left out: it is an older shape that decodes and is
 * never encoded.
 */
const oneOfEach: readonly GoalEvent[] = [
  GoalEvents.started({ ...SPEC, branch: "goal/search" }),
  GoalEvents.asked("make search work", ["smart", "auto"], { from: TRAK, call: "c0" }),
  GoalEvents.drafted("c1", SPEC),
  GoalEvents.dismissed(),
  GoalEvents.turnEnded(sid, 3, undefined),
  GoalEvents.turnFailed(undefined, 0, "usage limit reached", undefined),
  GoalEvents.planProposed("c2", [PLANNED], "one trak"),
  GoalEvents.replanned("c3", [], "nothing left"),
  GoalEvents.trakOpened("c4", TRAK, "Index", "smart"),
  GoalEvents.trakMessaged("c5", TRAK, "also the docs"),
  GoalEvents.trakRecomposed("c6", TRAK, "wrong base"),
  GoalEvents.trakDropped(undefined, TRAK, "superseded"),
  GoalEvents.escalated("c7", TRAK, WHICH),
  GoalEvents.actionRequested("c8", {
    trak: undefined,
    title: "Rotate",
    steps: ["open the page"],
    why: "a key",
  }),
  GoalEvents.doneProposed("c9", "search works"),
  GoalEvents.trakWoke(TRAK, "landed", 4),
  GoalEvents.trakHandedOff(TRAK, 2, ["write the docs"]),
  GoalEvents.acted({ _tag: "Answer", answers: ["this"] }),
  GoalEvents.paused([TRAK]),
  GoalEvents.resumed([TRAK]),
  GoalEvents.settingsChanged({ parallel: 2, autoMerge: "never" }),
  GoalEvents.dropped("not needed"),
]

/**
 * A goal has no `remove`, and keeps no `run.json`: nothing wipes one. What the
 * `remove`/`run.json` rule asks of this port is the other side of it — a trak's `remove`
 * reaches the trak's own data and nothing beside it, so removing a trak under a goal's own
 * id leaves the goal whole. A database store keys the two in separate tables; this pins it.
 */
const removeCases = (c: GoalStoreUnderTest): void => {
  it("keeps a goal whole when a trak under the same id is removed", async () => {
    const goal = freshId("shared")
    const trak = TrakId.make(goal)
    const scratchDir = mkdtempSync(join(tmpdir(), "orkestra-goal-store-"))
    const after = await Effect.runPromise(
      Effect.gen(function* () {
        const goals = yield* GoalStore
        const traks = yield* Store
        yield* goals.append(goal, [GoalEvents.started(SPEC)], { after: 0 })
        yield* goals.appendTranscript(goal, NoteEntry.make({ text: "planning" }))
        yield* traks.append(trak, [Events.trakCreated("a")], { after: 0 })
        yield* traks.remove(trak)
        return {
          events: (yield* goals.events(goal)).length,
          transcript: (yield* goals.transcript(goal)).length,
          goals: yield* goals.list(),
          traks: yield* traks.list(),
        }
      }).pipe(Effect.provide(Layer.merge(c.layer(scratchDir), c.store(scratchDir)))),
    )
    expect(after).toStrictEqual({ events: 1, transcript: 1, goals: [goal], traks: [] })
  })
}

/** The refused half of `append`, and what it leaves the log as. */
const appendedAt = (store: GoalStoreShape, id: GoalId, after: number) =>
  Effect.runPromise(Effect.either(store.append(id, [GoalEvents.dismissed()], { after })))

/** `store.ts`'s conflict cases, over a goal's log: a stale `after` is refused whole. */
const conflictCases = (c: GoalStoreUnderTest): void => {
  it("refuses an append made from a read the log has moved past, and writes none of it", async () => {
    const id = freshId("conflict-behind")
    await inGoalStore(c.layer, async (store) => {
      await Effect.runPromise(store.append(id, [GoalEvents.started(SPEC)], { after: 0 }))
      const refused = await appendedAt(store, id, 0)
      expect(refused._tag === "Left" ? refused.left : undefined).toMatchObject({
        _tag: "StoreConflict",
        id,
        after: 0,
        found: 1,
      })
      expect(await Effect.runPromise(store.events(id))).toHaveLength(1)
    })
  })

  it("refuses an append ahead of the log, on a goal it has never seen", async () => {
    const id = freshId("conflict-ahead")
    await inGoalStore(c.layer, async (store) => {
      const refused = await appendedAt(store, id, 2)
      expect(refused._tag === "Left" ? refused.left : undefined).toMatchObject({
        _tag: "StoreConflict",
        after: 2,
        found: 0,
      })
      expect(await Effect.runPromise(store.events(id))).toEqual([])
    })
  })

  it("takes an append made from the count the log still holds", async () => {
    const id = freshId("conflict-none")
    await inGoalStore(c.layer, async (store) => {
      await Effect.runPromise(store.append(id, [GoalEvents.started(SPEC)], { after: 0 }))
      expect((await appendedAt(store, id, 1))._tag).toBe("Right")
      expect(await Effect.runPromise(store.events(id))).toHaveLength(2)
    })
  })
}

/** Run this against any GoalStore implementation. */
export const goalStoreContract = (c: GoalStoreUnderTest): void => {
  describe(`GoalStore contract: ${c.label}`, () => {
    removeCases(c)
    conflictCases(c)

    it("round-trips every goal event variant, in order", async () => {
      const id = freshId("roundtrip")
      await inGoalStore(c.layer, async (store) => {
        await Effect.runPromise(store.append(id, oneOfEach, { after: 0 }))
        const back = await Effect.runPromise(store.events(id))
        // `at` is the store's doing, as on a trak's log: require it, then compare exactly.
        const times = back.map((e) => e.at ?? 0)
        expect(times.every((t) => t > 0)).toBe(true)
        expect(back).toStrictEqual(oneOfEach.map((e, i) => stampedGoal(e, times[i] ?? 0)))
      })
    })

    it("stamps every event with the time it was appended", async () => {
      const id = freshId("stamped")
      await inGoalStore(c.layer, async (store) => {
        const before = Date.now()
        await Effect.runPromise(store.append(id, [GoalEvents.started(SPEC)], { after: 0 }))
        const [back] = await Effect.runPromise(store.events(id))
        expect(back?.at).toBeGreaterThanOrEqual(before)
        expect(back?.at).toBeLessThanOrEqual(Date.now())
      })
    })

    it("returns an empty log and transcript for an id that was never written", async () => {
      const id = freshId("unknown")
      await inGoalStore(c.layer, async (store) => {
        expect(await Effect.runPromise(store.events(id))).toEqual([])
        expect(await Effect.runPromise(store.transcript(id))).toEqual([])
      })
    })

    it("lists only goals that were actually appended", async () => {
      const a = freshId("list-a")
      const b = freshId("list-b")
      await inGoalStore(c.layer, async (store) => {
        expect(await Effect.runPromise(store.list())).toEqual([])
        await Effect.runPromise(store.append(a, [GoalEvents.started(SPEC)], { after: 0 }))
        await Effect.runPromise(store.append(b, [GoalEvents.started(SPEC)], { after: 0 }))
        expect(new Set(await Effect.runPromise(store.list()))).toEqual(new Set([a, b]))
      })
    })

    it("keeps two goals' logs and transcripts from seeing each other's", async () => {
      const a = freshId("isolate-a")
      const b = freshId("isolate-b")
      await inGoalStore(c.layer, async (store) => {
        await Effect.runPromise(
          store.append(a, [GoalEvents.started(SPEC), GoalEvents.dismissed()], { after: 0 }),
        )
        await Effect.runPromise(store.append(b, [GoalEvents.started(SPEC)], { after: 0 }))
        await Effect.runPromise(store.appendTranscript(a, NoteEntry.make({ text: "a" })))
        expect(await Effect.runPromise(store.events(a))).toHaveLength(2)
        expect(await Effect.runPromise(store.events(b))).toHaveLength(1)
        expect(await Effect.runPromise(store.transcript(b))).toEqual([])
      })
    })

    it("preserves transcript order and survives an embedded newline", async () => {
      const id = freshId("transcript")
      const entries = [
        SpawnedEntry.make({ pid: 4242 }),
        ToolEntry.make({ kind: "Bash", name: "Bash", detail: "cat <<'EOF'\nline two\nEOF" }),
        NoteEntry.make({ text: "Result(12 chars)" }),
      ]
      await inGoalStore(c.layer, async (store) => {
        // One `runPromise`: `forEach` is sequential, and order is what is asserted.
        await Effect.runPromise(Effect.forEach(entries, (e) => store.appendTranscript(id, e)))
        expect(await Effect.runPromise(store.transcript(id))).toEqual(entries)
      })
    })
  })
}

/** `storeUnfencedContract`, over a goal's log: the file and memory stores ignore `fence`. */
export const goalStoreUnfencedContract = (c: GoalStoreUnderTest): void => {
  describe(`GoalStore contract: ${c.label} — unfenced`, () => {
    it("takes an append whatever fence it carries, and still checks its count", async () => {
      const id = freshId("unfenced")
      await inGoalStore(c.layer, async (store) => {
        const fenced = (after: number, fence: number) =>
          Effect.runPromise(
            Effect.either(store.append(id, [GoalEvents.started(SPEC)], { after, fence })),
          )
        expect((await fenced(0, 7))._tag).toBe("Right")
        expect((await fenced(1, 3))._tag).toBe("Right")
        const refused = await fenced(0, 7)
        expect(refused._tag === "Left" ? refused.left._tag : undefined).toBe("StoreConflict")
      })
    })
  })
}

/** Run this only against implementations that persist to something moddable. */
export const goalStoreCorruptionContract = (c: GoalStoreCorruptionUnderTest): void => {
  describe(`GoalStore contract: ${c.label} — corruption`, () => {
    it("fails naming the goal when a stored line will not decode, without taking others down", async () => {
      const bad = freshId("corrupt-bad")
      const good = freshId("corrupt-good")
      await inGoalStore(c.layer, async (store, scratchDir) => {
        await Effect.runPromise(store.append(bad, [GoalEvents.started(SPEC)], { after: 0 }))
        await Effect.runPromise(store.append(good, [GoalEvents.started(SPEC)], { after: 0 }))
        c.corrupt(scratchDir, bad)

        const result = await Effect.runPromise(Effect.either(store.events(bad)))
        const failed = result._tag === "Left" ? result.left : undefined
        // The tag, not just the failure: it is what licenses leaving the goal out of a list.
        expect(failed?._tag).toBe("StoreUndecodable")
        expect(failed?.reason).toContain(bad)
        expect(await Effect.runPromise(store.events(good))).toHaveLength(1)
      })
    })

    it("reports a log it could not read at all as a failure, not as an undecodable one", async () => {
      const unread = freshId("unreadable")
      await inGoalStore(c.layer, async (store, scratchDir) => {
        await Effect.runPromise(store.append(unread, [GoalEvents.started(SPEC)], { after: 0 }))
        c.unreadable(scratchDir, unread)

        const result = await Effect.runPromise(Effect.either(store.events(unread)))
        expect(result._tag === "Left" ? result.left._tag : undefined).toBe("StoreFailed")
      })
    })
  })
}
