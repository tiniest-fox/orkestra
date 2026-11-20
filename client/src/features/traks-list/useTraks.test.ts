/**
 * Tier-1: that the list actually polls, and that it stops when nobody is watching.
 *
 * The durable guard is that a poll must not outlive its subscriber. **Not** "no
 * queryFn call after `running` flips false": that asserts a predicate this hook does
 * not have, and gating the interval on `running` makes the client keep a coarse copy
 * of the engine's state, blind to every change it did not cause. A hand-rolled
 * `setInterval` fails the durable guard; `refetchInterval` cannot.
 *
 * **This needs a `window`, and the package's happy-dom is where it comes from.** query-core
 * decides once, at module-evaluation time, whether it is running on a server —
 * `typeof window === "undefined"` — and a server schedules no refetch interval at all,
 * so under a `node` environment every assertion below would pass vacuously with the
 * interval never armed. Until the environment existed this file stubbed `window` and
 * imported dynamically, because a static import hoists above every statement; the
 * environment is now the stub, so the imports are ordinary again.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryObserver } from "@tanstack/react-query"
import type { TrakListDto } from "../../api/types"
import { makeTrak } from "../../fixtures"
import { POLL_MS, queryKeys } from "../../queryCache"
import { traksQueryOptions, useTraks } from "./useTraks"

describe("useTraks", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("keeps polling a parked engine, and stops when the last watcher leaves", async () => {
    vi.useFakeTimers()
    // `retry: false` so a thrown queryFn would surface as one failed call rather than
    // three — nothing here throws, but a future edit that does should say so plainly.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    let calls = 0
    const queryFn = async (): Promise<TrakListDto> => {
      calls += 1
      await Promise.resolve()
      // Nothing running, on every answer. The old predicate would have armed no
      // interval at all here and this test would have read one call, forever.
      return {
        traks: [makeTrak({ id: "a", state: { _tag: "AwaitingHuman", step: 2, kind: "approval" } })],
        archived: 0,
      }
    }

    const options = traksQueryOptions(queryFn)
    expect(options.queryKey).toEqual(queryKeys.traks)

    const observer = new QueryObserver(client, options)
    const unsubscribe = observer.subscribe(() => {})

    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toBe(1)

    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(calls).toBe(4)

    // The half worth keeping: a poll must not outlive its subscriber. This is what a
    // hand-rolled interval gets wrong, and it is free here only because the interval
    // belongs to the observer rather than to a component that has to remember it.
    unsubscribe()
    await vi.advanceTimersByTimeAsync(POLL_MS * 5)
    expect(calls).toBe(4)

    // The whole of `useTraks` is `useQuery(traksQueryOptions())`. What it does inside a
    // React tree is asserted where it is used, by `TraksListPage.test.tsx`.
    expect(useTraks).toBeInstanceOf(Function)

    client.clear()
  })
})
