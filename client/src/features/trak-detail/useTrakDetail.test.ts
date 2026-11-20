// Tier-1: the options one trak's view is fetched with. That the interval actually
// fires and stops with its subscriber is `../traks-list/useTraks.test.ts`, which
// explains why it needs a `window` stub and dynamic imports to assert it at all.

import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryObserver } from "@tanstack/react-query"
import type { EngineFrameDto, TrakDetailDto } from "../../api/types"
import {
  makeActivity,
  makeAgentStep,
  makeAppended,
  makeComposeEntry,
  makeComposerReturned,
  makeDetail,
  makeDrive,
  makeHumanActed,
  makePlan,
  makeTrakCreated,
} from "../../fixtures"
import { receiveFrame } from "../../hooks/useEngineStream"
import { POLL_MS, queryKeys } from "../../queryCache"
import { trakDetailQueryOptions, useTrakDetail } from "./useTrakDetail"

const ID = "1dd2b03b-a627-457d-a44c-43b1240d0528"

describe("trakDetailQueryOptions", () => {
  it("keys on the trak, so two open details do not share a cache entry", () => {
    // The shared vocabulary, not a literal: a detail hook that spelled its own key
    // would still work and would never be invalidated by an action.
    expect(trakDetailQueryOptions(ID).queryKey).toEqual(queryKeys.trak(ID))
    expect(trakDetailQueryOptions("other").queryKey).not.toEqual(queryKeys.trak(ID))
  })

  it("polls whatever the trak is doing, held or not", () => {
    // A plain number, deliberately. A predicate here would have to guess whether the
    // server has news, and the only honest guess is "it might".
    expect(trakDetailQueryOptions(ID).refetchInterval).toBe(POLL_MS)
  })
})

describe("useTrakDetail", () => {
  it("is the hook the options describe", () => {
    expect(useTrakDetail).toBeInstanceOf(Function)
  })
})

/**
 * A drawer left open on a trak that is working, and the property this whole change is
 * for: **nothing it draws waits on a re-read.**
 *
 * The re-read cannot be relied on, and making it fire is ruled out rather than pending.
 * Writing a message into the cache is a query update, `QueryObserver.onQueryUpdate`
 * re-arms the refetch interval on every one, and a turn writes transcript lines about a
 * second apart — so `POLL_MS` never reaches its end while a trak is busy. Made to fire
 * anyway it would re-read a trak's whole log and transcript, ~1.5MB, every fifteen
 * seconds throughout the turn. So `reads` staying at one is half of what is asserted
 * here, not an incidental detail of the setup.
 *
 * The other half is the two fields the symptoms are about, and they arrive by different
 * routes because they are different kinds of fact:
 *
 *   · **`plan` rides the append**, with the rest of the trak's projection. The publisher
 *     already holds the replayed trak it comes off, and a replan mid-trak is what moves
 *     it while a drawer is open.
 *   · **`custody` rides a message of its own**, because a drive is released *after* its
 *     last log line — so no append can carry the release, and every press on the screen
 *     is gated on it.
 *
 * `artifacts` is asserted nowhere on purpose: it is leaving `TrakDetailDto` in the same
 * change, so a test naming it would have to be rewritten to let that happen.
 */
describe("a drawer left open on a working trak", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("follows the turn on messages alone", async () => {
    vi.useFakeTimers()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    // The one read a person's press pays for: a turn in flight at the first step, under
    // the plan the trak was cut with.
    let reads = 0
    const queryFn = async (): Promise<TrakDetailDto> => {
      reads += 1
      await Promise.resolve()
      return makeDetail({
        id: ID,
        state: { _tag: "AgentWorking", step: 1 },
        custody: { holder: { since: 1_000 } },
        plan: makePlan({ title: "Close the stale-state gap", steps: [makeComposeEntry()] }),
        log: [makeTrakCreated()],
      })
    }

    const observer = new QueryObserver(client, trakDetailQueryOptions(ID, queryFn))
    const unsubscribe = observer.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(reads).toBe(1)

    // The turn, as the engine publishes it. Interleaved with time rather than sent as a
    // burst, because a burst followed by silence is the case that heals on its own;
    // recursion rather than a loop because `no-await-in-loop` bans the readable form and
    // these are ordered.
    const recut = makePlan({
      title: "Close the stale-state gap",
      steps: [makeComposeEntry(), makeAgentStep({ agent: "builder" })],
    })
    const turn: readonly EngineFrameDto[] = [
      makeActivity({ trak: ID, seq: 1 }),
      makeActivity({ trak: ID, seq: 2 }),
      // The composer re-cuts the plan. `state` has always ridden here; `plan` is what
      // the drawer draws the step's agent and instruction from, and it moves with it.
      makeAppended({
        trak: ID,
        seq: 2,
        event: makeComposerReturned(),
        state: { _tag: "AgentWorking", step: 2 },
        plan: recut,
      }),
      makeActivity({ trak: ID, seq: 3 }),
      // The drive lets go. There is no log line after this one and none before it that
      // could have said so.
      makeDrive({ trak: ID, custody: {} }),
    ]
    const stream = async (i: number): Promise<void> => {
      const frame = turn[i]
      if (frame === undefined) return
      receiveFrame(client, frame)
      await vi.advanceTimersByTimeAsync(5_000)
      return stream(i + 1)
    }
    await stream(0)

    const held: TrakDetailDto | undefined = client.getQueryData(queryKeys.trak(ID))
    // The three together rather than one at a time, so a single run shows the whole gap
    // instead of stopping at the first of them. `holder` is the one every press on the
    // screen is gated on — `TrakDetailPage` refuses while one stands.
    expect({
      holder: held?.custody.holder,
      steps: held?.plan?.steps.length,
      state: held?.state,
    }).toStrictEqual({
      holder: undefined,
      steps: 2,
      state: { _tag: "AgentWorking", step: 2 },
    })
    // And none of it came from asking the server again.
    expect(reads).toBe(1)

    unsubscribe()
    client.clear()
  })
})

/**
 * Approving a plan, and the read the press pays for racing the drive it started.
 *
 * `useApprove`'s `onSuccess` invalidates the detail the moment `/act` answers `202`, which
 * is the moment the forked drive is taking custody. `detailFor` can read `run.json` before
 * `adopt` has written it, and its answer — a whole log and transcript — reaches the tab
 * after the small `Drive` frame that followed. Nothing on `custody` says which is newer, so
 * the answer replaces the frame. The append that comes next is contiguous with that answer,
 * so it patches rather than refetching, and the drawer holds a turn in flight with nobody
 * carrying it — *nothing is carrying this trak* — until it is closed and reopened.
 */
describe("a plan approved while its detail is being re-read", () => {
  it("keeps the custody the drive published", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const created = makeTrakCreated()
    const composed = makeComposerReturned()

    // The engine, as a read would find it at the moment the read is made. Each answer is
    // held until the test lets it go, which is what puts it on the wire behind a frame.
    let engine = makeDetail({
      id: ID,
      state: { _tag: "AwaitingProposal" },
      log: [created, composed],
    })
    const answers: (() => void)[] = []
    const queryFn = (): Promise<TrakDetailDto> => {
      const found = engine
      return new Promise((resolve) => {
        answers.push(() => {
          resolve(found)
        })
      })
    }
    const deliver = async (): Promise<void> => {
      for (const answer of answers.splice(0)) answer()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const observer = new QueryObserver(client, trakDetailQueryOptions(ID, queryFn))
    const unsubscribe = observer.subscribe(() => {})
    await deliver()

    // Approve answered `202`: the press re-reads, and the read finds nobody holding it yet.
    void client.invalidateQueries({ queryKey: queryKeys.trak(ID) })

    // `adopt` writes the holder and the drive says so.
    engine = { ...engine, custody: { holder: { since: 1_000 } } }
    receiveFrame(client, makeDrive({ trak: ID }))

    // The re-read lands behind the frame — and so does any read the frame itself asked for.
    await deliver()

    // `advance` appends the approval, and the first step's turn is in flight.
    const approved = makeHumanActed({ step: 0 })
    engine = {
      ...engine,
      state: { _tag: "AgentWorking", step: 1 },
      log: [created, composed, approved],
    }
    receiveFrame(
      client,
      makeAppended({
        trak: ID,
        seq: 3,
        event: approved,
        state: { _tag: "AgentWorking", step: 1 },
      }),
    )
    await deliver()

    const held: TrakDetailDto | undefined = client.getQueryData(queryKeys.trak(ID))
    expect({ state: held?.state, holder: held?.custody.holder }).toStrictEqual({
      state: { _tag: "AgentWorking", step: 1 },
      holder: { since: 1_000 },
    })

    unsubscribe()
    client.clear()
  })
})
