/**
 * The trak list, kept current by the engine's stream and re-read on a slow interval
 * whenever anyone is looking at it.
 *
 * **Unconditionally, and that is the decision.** Gating the interval on "does the last
 * answer show anything running" makes the client keep a coarse copy of the engine's own
 * state, and gets it wrong in the obvious way: a trak nobody held when we last asked can
 * be claimed a moment later by `pnpm ork`, by another tab, or by this tab's own action,
 * and a query that stopped asking never finds out. The
 * predicate needed a fetch to learn that fetching was warranted. Assume any trak can
 * change and ask; make the *answer* cheap when it needs to be, not the question rare.
 *
 * What is left of the "poll forever" guard is TanStack's, and it is the half that
 * matters: no mounted observer means no polling, and a hidden tab does not poll either
 * (`refetchIntervalInBackground` defaults false). A hand-rolled `setInterval` has
 * neither property, which is why there is none anywhere in this package.
 *
 * **The interval is a backstop, not the transport.** `useEngineStream` invalidates this
 * key whenever the engine appends anything, so the list follows a running turn without
 * waiting for a tick. What is left covers what a stream cannot: a connection that
 * dropped and has not noticed, a suspended tab, a frame lost between the two. What a
 * poll costs the engine is a replay of the live logs alone — the archived traks are a
 * count it already holds.
 */

import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { listTraks } from "../../api/trak"
import type { TrakListDto } from "../../api/types"
import { POLL_MS, queryKeys } from "../../queryCache"

type Traks = TrakListDto

/**
 * `queryFn` is injectable so the polling behaviour can be driven in a tier-1 test
 * without React or a network — the hook itself is then thin enough to have nothing
 * left to test. This is the port/adapter split `client-style` asks of a hook, at the
 * smallest size that works.
 */
export const traksQueryOptions = (queryFn: () => Promise<Traks> = listTraks) => ({
  queryKey: queryKeys.traks,
  queryFn,
  refetchInterval: POLL_MS,
})

export const useTraks = (): UseQueryResult<Traks> => useQuery(traksQueryOptions())
