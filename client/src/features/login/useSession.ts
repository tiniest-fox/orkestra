/**
 * Whether this browser is in.
 *
 * The first thing the app asks, and the one answer that decides whether anything else is
 * drawn: without a session every other route is a 401, and a page of refusals is worse
 * than a login screen. An engine started with no passphrase answers yes to everyone, so
 * on a `pnpm ui` this resolves on the first frame and nothing is visible.
 *
 * **Polled, like everything the engine owns.** An engine restart forgets every session it
 * issued, and nothing else in the cache would notice — the queries behind the screen
 * would start failing one by one. Fifteen seconds is the longest a stale tab draws
 * refusals before the login comes back.
 *
 * `false` is data, not an error: the seam answers it for a 401, so the query settles
 * rather than retrying a refusal three times.
 */

import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { session } from "../../api/http"
import { POLL_MS, queryKeys } from "../../queryCache"

/** Injectable, for the reason every query here is: the decisions are reachable bare. */
export const sessionQueryOptions = (queryFn: () => Promise<boolean> = session) => ({
  queryKey: queryKeys.session,
  queryFn,
  refetchInterval: POLL_MS,
})

export const useSession = (): UseQueryResult<boolean> => useQuery(sessionQueryOptions())
