/**
 * Tier 1: the folds over the log that every token figure on screen is read from.
 *
 * What would go wrong quietly is attribution — a turn's spend landing on the turn below
 * it, a piece's spend folded into its parent's, a session's earlier turns counted into a
 * step that joined it — because every one of those still draws a plausible number.
 */

import { describe, expect, it } from "vitest"
import type { EventDto, TrakDetailDto } from "../../../api/types"
import {
  makeAbandoned,
  makeAgentReturned,
  makeChildrenSpawned,
  makeComposerReturned,
  makeDetail,
  makeHumanActed,
  makeReadUsage,
  makeRestarted,
  makeStopped,
  makeTurnInFlight,
  makeUsage,
} from "../../../fixtures"
import { composeRow, stepRow } from "../family/map.fixtures"
import type { MapRow } from "../family/rows"
import type { Turn } from "../turns/turns"
import {
  carriedIn,
  type Context,
  liveSpend,
  NOTHING,
  occupancy,
  ownSpend,
  type Spend,
  tokens,
  total,
  trakUsage,
  turnSpends,
} from "./usage"

const turn = (session: string): Turn => ({ session, at: 1, entries: [] })

/** A step row at `at` with `n` turns, all under `session`. */
const rowAt = (at: number, n: number, session = "s-a"): MapRow => ({
  ...stepRow,
  at,
  turns: Array.from({ length: n }, () => turn(session)),
})

/** `n` uncached tokens in and nothing else — what an event carries. */
const spent = (n: number) =>
  makeUsage({ inputTokens: n, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })

/** The same, as the fold hands it back: the four counts, and never the cost beside them. */
const only = (n: number): Spend => ({ ...NOTHING, inputTokens: n })

describe("turnSpends", () => {
  it("puts each ending's usage on the turn it ended, and leaves an unmeasured one blank", () => {
    const log: EventDto[] = [
      makeAgentReturned({ step: 1, sessionId: "s-a", usage: spent(100) }),
      // The engine died mid-turn: an ending with nothing measured on it.
      makeRestarted({ step: 1, sessionId: "s-a" }),
      makeStopped({ step: 1, sessionId: "s-a", usage: spent(30) }),
    ]
    expect(turnSpends(log, rowAt(1, 3))).toEqual([
      { spend: only(100), context: undefined, cut: undefined },
      undefined,
      { spend: only(30), context: undefined, cut: "stopped" },
    ])
  })

  it("counts a turn a recompose or an archive killed, on the turn each ended", () => {
    // Both carry the killed turn's session, which is what makes each an ending; neither
    // is a cut the transcript stamps yet, so the figure reaches the meter and not the turn.
    const log: EventDto[] = [
      makeHumanActed({
        step: 1,
        action: { _tag: "Replan", reason: "other" },
        sessionId: "s-a",
        usage: spent(40),
      }),
      makeAgentReturned({ step: 1, sessionId: "s-a", usage: spent(100) }),
      makeAbandoned({ step: 1, sessionId: "s-a", usage: spent(25) }),
    ]
    expect(turnSpends(log, rowAt(1, 3))).toEqual([
      { spend: only(40), context: undefined, cut: undefined },
      { spend: only(100), context: undefined, cut: undefined },
      { spend: only(25), context: undefined, cut: undefined },
    ])
    expect(ownSpend(log)).toEqual(only(165))
  })

  it("reads only this position's endings, padded to the turns the transcript has", () => {
    const log: EventDto[] = [
      makeAgentReturned({ step: 2, usage: spent(500) }),
      makeAgentReturned({ step: 1, usage: spent(100) }),
    ]
    expect(turnSpends(log, rowAt(1, 2))).toEqual([
      { spend: only(100), context: undefined, cut: undefined },
      undefined,
    ])
  })

  it("keys a run of the composer by its session, which carries no position", () => {
    const log: EventDto[] = [
      makeComposerReturned({ sessionId: "s-plan", usage: spent(7) }),
      makeAgentReturned({ step: 1, sessionId: "s-plan", usage: spent(100) }),
    ]
    const row: MapRow = {
      ...composeRow,
      turns: [{ session: "s-plan", at: "composer", entries: [] }],
    }
    // The step that resumed the composer's session is that step's ending, not the run's.
    expect(turnSpends(log, row)).toEqual([{ spend: only(7), cut: undefined }])
  })
})

describe("occupancy", () => {
  const read = (n: number, window?: number): Context => ({ held: only(n), window })

  it("is the last reading any turn carries, never a figure made from the counts", () => {
    // A turn's spend is the conversation re-read at every call; the reading is what one
    // call saw. 2,000 spent over a 500 reading is the ordinary shape, not a contradiction.
    expect(
      occupancy([
        { spend: only(1), context: read(1), cut: undefined },
        { spend: only(2000), context: read(500, 200_000), cut: undefined },
        undefined,
      ]),
    ).toEqual({ held: only(500), window: 200_000 })
    expect(occupancy([undefined])).toBeUndefined()
    expect(occupancy([{ spend: only(2000), context: undefined, cut: undefined }])).toBeUndefined()
  })

  it("skips back over a turn measured for spend and not for its window", () => {
    expect(
      occupancy([
        { spend: only(1), context: read(1), cut: undefined },
        { spend: only(2000), context: undefined, cut: "stopped" },
      ]),
    ).toEqual(read(1))
  })

  it("comes off the ending's usage, with the provider's window where it gave one", () => {
    const held = { inputTokens: 8, outputTokens: 2, cacheReadTokens: 23_557, cacheWriteTokens: 178 }
    const log: EventDto[] = [
      makeAgentReturned({ step: 1, sessionId: "s-a", usage: makeReadUsage(held, 200_000) }),
      makeAgentReturned({ step: 1, sessionId: "s-a", usage: makeReadUsage(held) }),
    ]
    expect(turnSpends(log, rowAt(1, 2)).map((t) => t?.context)).toEqual([
      { held, window: 200_000 },
      { held, window: undefined },
    ])
  })
})

describe("carriedIn", () => {
  const joined: MapRow = {
    ...rowAt(3, 1, "s-a"),
    continues: { key: "1-builder", to: "step:1", fresh: false },
  }
  const log: EventDto[] = [
    makeAgentReturned({ step: 1, sessionId: "s-a", usage: spent(100) }),
    makeAgentReturned({ step: 1, sessionId: "s-a", usage: spent(20) }),
    makeAgentReturned({ step: 2, sessionId: "s-b", usage: spent(999) }),
    makeAgentReturned({ step: 3, sessionId: "s-a", usage: spent(5) }),
  ]

  it("is what the session spent at every position but this one", () => {
    expect(carriedIn(log, joined)).toEqual(only(120))
  })

  it("is nothing where the step started fresh, or where nothing earlier was measured", () => {
    expect(
      carriedIn(log, { ...joined, continues: { key: "1-builder", to: undefined, fresh: true } }),
    ).toBeUndefined()
    expect(carriedIn([makeAgentReturned({ step: 1, sessionId: "s-a" })], joined)).toBeUndefined()
  })
})

describe("trakUsage", () => {
  const child = (id: string, n: number): TrakDetailDto =>
    makeDetail({ id, log: [makeAgentReturned({ step: 0, usage: spent(n) })] })
  const log: EventDto[] = [
    makeComposerReturned({ sessionId: "s-plan", usage: spent(10) }),
    makeAgentReturned({ step: 1, sessionId: "s-a", usage: spent(100) }),
    makeRestarted({ step: 1, sessionId: "s-a" }),
    makeChildrenSpawned({ step: 2, ids: ["c-1", "c-2"] }),
  ]
  const rows: MapRow[] = [
    { ...composeRow, turns: [{ session: "s-plan", at: "composer", entries: [] }] },
    rowAt(1, 2),
    { ...stepRow, key: "step:2", at: 2, turns: [] },
  ]

  it("sums the trak's own endings and never a piece's, and slices the bar by position", () => {
    const usage = trakUsage(log, rows, new Map([["c-1", child("c-1", 1000)]]))
    expect(total(usage.own)).toBe(110)
    expect(usage.positions.map((p) => [p.key, total(p.spend)])).toEqual([
      ["c", 10],
      ["1", 100],
    ])
  })

  it("keeps the pieces apart, and says how many of them have answered", () => {
    const usage = trakUsage(log, rows, new Map([["c-1", child("c-1", 1000)]]))
    expect(usage.pieces).toEqual({ pieces: 2, read: 1, spend: only(1000) })
    expect(trakUsage(log.slice(0, 3), rows, new Map()).pieces).toBeUndefined()
  })
})

describe("tokens", () => {
  it("rounds for a glance, and rounds up into the next unit rather than printing 1000k", () => {
    expect(tokens(512)).toBe("512")
    expect(tokens(427_617)).toBe("428k")
    expect(tokens(999_600)).toBe("1.0m")
    expect(tokens(6_812_000)).toBe("6.8m")
  })
})

describe("liveSpend", () => {
  const live = makeTurnInFlight({
    step: 3,
    usage: makeReadUsage(
      { inputTokens: 0, cacheReadTokens: 80_000, cacheWriteTokens: 0, outputTokens: 10 },
      200_000,
      { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
    ),
    estimate: { inputTokens: 5, cacheReadTokens: 100_000, cacheWriteTokens: 300, outputTokens: 20 },
  })
  const running = { ...rowAt(3, 1), status: "running" as const }

  it("is one more turn of the row the record names while it runs: estimate added, reading kept apart", () => {
    // Claude has reported nothing yet, so the four counters are zero and the estimate is
    // the whole spend; the reading is what the window holds and is not part of it.
    expect(liveSpend(live, running)).toEqual({
      spend: { inputTokens: 5, cacheReadTokens: 100_000, cacheWriteTokens: 300, outputTokens: 20 },
      context: {
        held: { inputTokens: 0, cacheReadTokens: 80_000, cacheWriteTokens: 0, outputTokens: 10 },
        window: 200_000,
      },
      cut: undefined,
    })
  })

  it("lands on no other row, and on none once the row has stopped running", () => {
    // Another position's meter, a compose row, and the same position after its ending
    // moved the state — the last is what keeps the ending's usage from being counted
    // beside the record's in the gap before the release frame.
    expect(liveSpend(live, { ...rowAt(2, 1), status: "running" })).toBeUndefined()
    expect(liveSpend(live, { ...composeRow, status: "running" })).toBeUndefined()
    expect(liveSpend(live, { ...rowAt(3, 1), status: "gate" })).toBeUndefined()
    expect(liveSpend(undefined, running)).toBeUndefined()
  })

  it("lands on the compose row where the record names no step", () => {
    const composing = makeTurnInFlight({ step: undefined })
    expect(liveSpend(composing, { ...composeRow, status: "running" })?.spend).toEqual({
      inputTokens: 20,
      outputTokens: 1_000,
      cacheReadTokens: 50_000,
      cacheWriteTokens: 5_000,
    })
    expect(liveSpend(composing, running)).toBeUndefined()
  })
})
