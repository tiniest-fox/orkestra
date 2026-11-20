// The Store port's contract, written once and run against every implementation.
//
// Everything here is about the promise the port makes: what round-trips,
// what stays isolated between traks, and — the one the file adapter alone can
// break — what happens when a line on disk cannot be decoded. Each case gets
// its own scratch directory, the same device `vcs.ts` uses for a repository:
// the point is state that persists across calls within one test and never
// leaks into another.

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { McpView } from "../../src/agent/types/mcp.js"
import { NoteEntry, SpawnedEntry, ToolEntry } from "../../src/agent/types/transcript-entry.js"
import { SessionId } from "../../src/agent/types/session.js"
import { BranchName, CommitSha, WorktreePath } from "../../src/vcs/index.js"
import { artifact } from "../../src/workflow/domain/outputs/artifact.js"
import { askPlainly } from "../../src/workflow/domain/outputs/questions.js"
import { proposal } from "../../src/workflow/domain/outputs/proposal.js"
import { Actions } from "../../src/workflow/domain/human-action.js"
import { Events, stamped } from "../../src/workflow/domain/event.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { Runs, type RunsShape } from "../../src/workflow/ports/runs.js"
import { Store, type StoreShape } from "../../src/workflow/ports/store.js"
import type { StoreFailed } from "../../src/workflow/ports/store-errors.js"

export interface StoreUnderTest {
  readonly label: string
  readonly layer: (scratchDir: string) => Layer.Layer<Store, StoreFailed>
  /**
   * The `Runs` the store is deployed beside, over the same scratch directory — the file
   * store beside `run.json`, the memory store beside a `Ref`. Only the `remove` case
   * reads it: that rule is about what a caller may rely on across the two ports.
   */
  readonly runs: (scratchDir: string) => Layer.Layer<Runs, StoreFailed>
}

/**
 * File only: mangle one line of `id`'s log on disk so decoding fails. Kept as
 * a second, separately-called contract (`storeCorruptionContract`) rather than
 * an optional field checked at runtime — a test suite that only exists for
 * some implementations is a static fact about the file, not a branch inside it.
 */
export interface StoreCorruptionUnderTest extends StoreUnderTest {
  readonly corrupt: (scratchDir: string, id: TrakId) => void
  /**
   * File only: make `id`'s log unreadable *as bytes*, without writing a line
   * into it. The other half of the pair — a store that cannot answer must not
   * be reported the way a store that answered with the wrong thing is.
   */
  readonly unreadable: (scratchDir: string, id: TrakId) => void
}

const freshId = (label: string): TrakId =>
  TrakId.make(`${label}-${Math.random().toString(36).slice(2)}`)

const inStore = (
  layer: (scratchDir: string) => Layer.Layer<Store, StoreFailed>,
  body: (store: StoreShape, scratchDir: string) => Promise<void>,
): Promise<void> => {
  const scratchDir = mkdtempSync(join(tmpdir(), "orkestra-store-"))
  return Effect.runPromise(
    Effect.flatMap(Store, (store) => Effect.promise(() => body(store, scratchDir))).pipe(
      Effect.provide(layer(scratchDir)),
    ),
  )
}

const sid = SessionId.make("00000000-0000-4000-8000-000000000001")

/**
 * `remove`, alone and beside `Runs`' record — `run.json`.
 *
 * `remove` promises the trak's log, transcript and views, and nothing about `Runs`. The
 * file store happens to delete `run.json` with the trak's directory; a database store
 * deletes no `run.json` at all, since that file stays on this machine. So a caller
 * clears custody itself, by closing its claim *before* `remove` — `server.ts`'s wipe
 * routes refuse while a drive holds the trak — and that order is what this case pins,
 * through the ports alone, so it holds whichever of the two the adapter does to the file.
 */
const removeCases = (c: StoreUnderTest): void => {
  it("leaves nothing held or in flight once a claim closed before remove", async () => {
    const id = freshId("remove-claimed")
    const scratchDir = mkdtempSync(join(tmpdir(), "orkestra-store-"))
    const after = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store
        const runs = yield* Runs
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* runs.adopt(id)
            yield* runs.turn(id, {
              step: 0,
              sessionId: sid,
              agentPid: undefined,
              agentStart: undefined,
              usage: undefined,
              estimate: undefined,
            })
            yield* store.append(id, [Events.trakCreated("a")], { after: 0 })
            yield* store.appendTranscript(id, NoteEntry.make({ text: "hi" }))
          }),
        )
        yield* store.remove(id)
        return yield* readBack(store, runs, id)
      }).pipe(Effect.provide(Layer.merge(c.layer(scratchDir), c.runs(scratchDir)))),
    )
    expect(after).toStrictEqual({
      events: [],
      transcript: [],
      listed: false,
      holder: undefined,
      inFlight: undefined,
      // A trak made again under the id is not told a turn of the old one was cut off.
      interrupted: undefined,
    })
  })

  it("removes one trak and leaves the rest", async () => {
    const a = freshId("remove-a")
    const b = freshId("remove-b")
    await inStore(c.layer, async (store) => {
      await Effect.runPromise(store.append(a, [Events.trakCreated("a")], { after: 0 }))
      await Effect.runPromise(store.append(b, [Events.trakCreated("b")], { after: 0 }))
      await Effect.runPromise(store.remove(a))
      expect(await Effect.runPromise(store.events(a))).toEqual([])
      expect(await Effect.runPromise(store.events(b))).toHaveLength(1)
    })
  })

  it("removing an id that was never appended is a no-op, not a failure", async () => {
    const id = freshId("never-existed")
    await inStore(c.layer, async (store) => {
      await Effect.runPromise(store.remove(id))
      expect(await Effect.runPromise(store.events(id))).toEqual([])
    })
  })
}

/** What both ports say about `id` after it was removed — the last read being a new claim. */
const readBack = (store: StoreShape, runs: RunsShape, id: TrakId) =>
  Effect.all({
    events: store.events(id),
    transcript: store.transcript(id),
    listed: Effect.map(store.list(), (ids) => ids.includes(id)),
    holder: runs.holder(id),
    inFlight: runs.inFlight(id),
    interrupted: Effect.scoped(runs.adopt(id)),
  })

/** One instance of every `Event` variant — round-tripping this proves the whole union. */
const oneOfEach = [
  Events.trakCreated("do the thing"),
  Events.composerReturned(sid, proposal("do the thing", [{ agent: "work", instruction: "x" }])),
  Events.agentReturned(0, sid, artifact({ Summary: "v1" })),
  Events.humanActed(0, Actions.approve()),
  Events.checksPassed(0, ["verify"]),
  Events.checkFailed(0, "verify", "2 problems"),
  Events.worktreeReady({
    path: WorktreePath.make("/tmp/wt"),
    branch: BranchName.make("trak/t1"),
    base: CommitSha.make("base000"),
  }),
  Events.turnFailed(0, sid, "connection closed mid-response"),
  Events.turnFailed(undefined, undefined, "usage limit reached"),
  Events.worktreeFailed("no space left"),
  Events.workCommitted(undefined),
  Events.restarted(sid),
  Events.restarted(undefined),
  Events.agentReturned(0, sid, askPlainly("what now?")),
]

/**
 * A trak's versions across every kind of write, for the case below to assert on: taken
 * before anything, twice with nothing between, after a log append, after a second in
 * the same instant, after a transcript append, and after the remove. Outside the suite
 * because the suite's describe is one function and this many steps tip it over the cap.
 */
const versionsAcross = async (store: StoreShape, id: TrakId) => {
  const versions = () => Effect.runPromise(store.versions(id))
  const none = await versions()
  const unchanged = await versions()
  await Effect.runPromise(store.append(id, [Events.trakCreated("a")], { after: 0 }))
  const logged = await versions()
  await Effect.runPromise(store.append(id, [Events.worktreeFailed("x")], { after: 1 }))
  const loggedAgain = await versions()
  await Effect.runPromise(store.appendTranscript(id, NoteEntry.make({ text: "hi" })))
  const spoken = await versions()
  await Effect.runPromise(store.remove(id))
  const removed = await versions()
  return { none, unchanged, logged, loggedAgain, spoken, removed }
}

const KEPT = McpView.make({
  server: "metrics",
  tool: "show_dashboard",
  uri: "ui://metrics/dashboard.html",
  html: "<!DOCTYPE html>\n<p>one\nline per row</p>",
  policy: { connect: ["https://api.example.com"], resource: [], frame: [], baseUri: [] },
  arguments: { range: "7d" },
  result: { content: [{ type: "text", text: "ok" }], structured: { rows: 3 }, isError: false },
  callable: [{ name: "refresh", callName: "mcp__metrics__refresh" }],
  model: "codex/gpt",
})

/**
 * The views half of the contract. Its own function, called from the suite below,
 * because the suite's describe is one function and these cases tip it over the cap.
 */
const viewCases = (c: StoreUnderTest): void => {
  it("keeps a view under its call and reads it back whole", async () => {
    const id = freshId("view")
    await inStore(c.layer, async (store) => {
      await Effect.runPromise(store.saveView(id, "toolu_01", KEPT))
      expect(await Effect.runPromise(store.view(id, "toolu_01"))).toEqual(KEPT)
    })
  })

  it("has no view for a call that left none, on a trak it has never seen", async () => {
    await inStore(c.layer, async (store) => {
      expect(await Effect.runPromise(store.view(freshId("no-view"), "toolu_01"))).toBeUndefined()
    })
  })

  it("keeps one trak's views from another's, and removes them with their trak", async () => {
    const a = freshId("view-a")
    const b = freshId("view-b")
    await inStore(c.layer, async (store) => {
      await Effect.runPromise(store.saveView(a, "toolu_01", KEPT))
      expect(await Effect.runPromise(store.view(b, "toolu_01"))).toBeUndefined()
      await Effect.runPromise(store.remove(a))
      expect(await Effect.runPromise(store.view(a, "toolu_01"))).toBeUndefined()
    })
  })
}

/** The refused half of `append`, and what it leaves the log as. */
const appendedAt = (store: StoreShape, id: TrakId, after: number) =>
  Effect.runPromise(Effect.either(store.append(id, [Events.worktreeFailed("late")], { after })))

/**
 * `after` is the count the caller read, and an append whose count the log no longer holds
 * is refused whole: nothing of it is written, and the refusal names both counts, so a
 * second writer is reported rather than interleaved.
 */
const conflictCases = (c: StoreUnderTest): void => {
  it("refuses an append made from a read the log has moved past, and writes none of it", async () => {
    const id = freshId("conflict-behind")
    await inStore(c.layer, async (store) => {
      await Effect.runPromise(store.append(id, [Events.trakCreated("a")], { after: 0 }))
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

  it("refuses an append ahead of the log, on a trak it has never seen", async () => {
    const id = freshId("conflict-ahead")
    await inStore(c.layer, async (store) => {
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
    await inStore(c.layer, async (store) => {
      await Effect.runPromise(store.append(id, [Events.trakCreated("a")], { after: 0 }))
      expect((await appendedAt(store, id, 1))._tag).toBe("Right")
      expect(await Effect.runPromise(store.events(id))).toHaveLength(2)
    })
  })
}

/** Run this against any Store implementation. */
export const storeContract = (c: StoreUnderTest): void => {
  describe(`Store contract: ${c.label}`, () => {
    viewCases(c)
    removeCases(c)
    conflictCases(c)

    it("round-trips every event variant, in order", async () => {
      const id = freshId("roundtrip")
      await inStore(c.layer, async (store) => {
        await Effect.runPromise(store.append(id, oneOfEach, { after: 0 }))
        const back = await Effect.runPromise(store.events(id))
        // `at` is the store's own doing — see `stamped` — so it is the one field
        // that comes back on an event that was handed over without it. Read the
        // times, require them, then compare exactly: absent optional keys have to
        // still be absent, which is what this case is for and what a subset match
        // would stop catching.
        const times = back.map((e) => e.at ?? 0)
        expect(times.every((t) => t > 0)).toBe(true)
        expect(back).toStrictEqual(oneOfEach.map((e, i) => stamped(e, times[i] ?? 0)))
      })
    })

    it("stamps every event with the time it was appended", async () => {
      const id = freshId("stamped")
      await inStore(c.layer, async (store) => {
        const before = Date.now()
        await Effect.runPromise(
          store.append(id, [Events.trakCreated("do the thing")], { after: 0 }),
        )
        const [back] = await Effect.runPromise(store.events(id))
        // A real reading rather than any number: a unit that turns out wrong reads
        // as 1970, and a stamp taken from the wrong clock reads as the epoch or as
        // next century. Both are caught here and nowhere else.
        expect(back?.at).toBeGreaterThanOrEqual(before)
        expect(back?.at).toBeLessThanOrEqual(Date.now())
      })
    })

    it("returns an empty log for an id that was never appended", async () => {
      await inStore(c.layer, async (store) => {
        const back = await Effect.runPromise(store.events(freshId("unknown")))
        expect(back).toEqual([])
      })
    })

    it("lists only traks that were actually appended", async () => {
      const a = freshId("list-a")
      const b = freshId("list-b")
      await inStore(c.layer, async (store) => {
        await Effect.runPromise(store.append(a, [Events.trakCreated("a")], { after: 0 }))
        await Effect.runPromise(store.append(b, [Events.trakCreated("b")], { after: 0 }))
        const ids = await Effect.runPromise(store.list())
        expect(new Set(ids)).toEqual(new Set([a, b]))
      })
    })

    it("keeps two traks' logs from seeing each other's events", async () => {
      const a = freshId("isolate-a")
      const b = freshId("isolate-b")
      await inStore(c.layer, async (store) => {
        await Effect.runPromise(
          store.append(a, [Events.trakCreated("a"), Events.worktreeFailed("x")], { after: 0 }),
        )
        await Effect.runPromise(store.append(b, [Events.trakCreated("b")], { after: 0 }))
        expect(await Effect.runPromise(store.events(a))).toHaveLength(2)
        expect(await Effect.runPromise(store.events(b))).toHaveLength(1)
      })
    })

    // The heredoc case, and the reason a transcript is one value per line rather than
    // one line per line: a `Bash` detail carries the command as the agent wrote it.
    it("preserves transcript order and survives an embedded newline", async () => {
      const id = freshId("transcript")
      const entries = [
        SpawnedEntry.make({ pid: 4242 }),
        ToolEntry.make({ kind: "Bash", name: "Bash", detail: "cat <<'EOF'\nline two\nEOF" }),
        ToolEntry.make({ kind: "Todo", name: "TodoWrite" }),
        NoteEntry.make({ text: "Result(12 chars)" }),
      ]
      await inStore(c.layer, async (store) => {
        // One `runPromise`: `forEach` is sequential, and order is what is asserted.
        await Effect.runPromise(Effect.forEach(entries, (e) => store.appendTranscript(id, e)))
        expect(await Effect.runPromise(store.transcript(id))).toEqual(entries)
      })
    })

    it("moves a file's version on every write to it, and only then", async () => {
      await inStore(c.layer, async (store) => {
        const v = await versionsAcross(store, freshId("versions"))
        expect(v.unchanged).toStrictEqual(v.none)
        expect(v.logged.log).not.toBe(v.none.log)
        expect(v.logged.transcript).toBe(v.none.transcript)
        // The second append can land in the same instant as the first: size moves it.
        expect(v.loggedAgain.log).not.toBe(v.logged.log)
        expect(v.spoken.transcript).not.toBe(v.loggedAgain.transcript)
        expect(v.spoken.log).toBe(v.loggedAgain.log)
        expect(v.removed.log).not.toBe(v.spoken.log)
        expect(v.removed.transcript).not.toBe(v.spoken.transcript)
      })
    })
  })
}

/**
 * Run this only against implementations that hold no lease, and so take any `fence`
 * and check nothing against it — the file and memory stores. One that keeps leases
 * refuses a stale fence as `StoreFenced` instead.
 */
export const storeUnfencedContract = (c: StoreUnderTest): void => {
  describe(`Store contract: ${c.label} — unfenced`, () => {
    it("takes an append whatever fence it carries, and still checks its count", async () => {
      const id = freshId("unfenced")
      await inStore(c.layer, async (store) => {
        const fenced = (after: number, fence: number) =>
          Effect.runPromise(
            Effect.either(store.append(id, [Events.trakCreated("a")], { after, fence })),
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
export const storeCorruptionContract = (c: StoreCorruptionUnderTest): void => {
  describe(`Store contract: ${c.label} — corruption`, () => {
    it("fails naming the trak when a stored line will not decode, without taking others down", async () => {
      const bad = freshId("corrupt-bad")
      const good = freshId("corrupt-good")
      await inStore(c.layer, async (store, scratchDir) => {
        await Effect.runPromise(store.append(bad, [Events.trakCreated("bad")], { after: 0 }))
        await Effect.runPromise(store.append(good, [Events.trakCreated("good")], { after: 0 }))
        c.corrupt(scratchDir, bad)

        const result = await Effect.runPromise(Effect.either(store.events(bad)))
        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          // The tag, not just the failure: a caller may leave an undecodable
          // trak out of a list, and this is the only thing licensing that.
          expect(result.left._tag).toBe("StoreUndecodable")
          expect(result.left.reason).toContain(bad)
        }

        expect(await Effect.runPromise(store.events(good))).toHaveLength(1)
      })
    })

    it("reports a log it could not read at all as a failure, not as an undecodable one", async () => {
      const unread = freshId("unreadable")
      await inStore(c.layer, async (store, scratchDir) => {
        await Effect.runPromise(
          store.append(unread, [Events.trakCreated("unreadable")], { after: 0 }),
        )
        c.unreadable(scratchDir, unread)

        const result = await Effect.runPromise(Effect.either(store.events(unread)))
        expect(result._tag).toBe("Left")
        // The whole point of the split. A surface that drops `StoreUndecodable`
        // rows must still fail on this one — a disk that will not answer is not
        // a trak that is fine to omit.
        if (result._tag === "Left") expect(result.left._tag).toBe("StoreFailed")
      })
    })
  })
}
