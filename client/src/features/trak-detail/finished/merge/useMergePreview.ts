/**
 * Where a merge would put this trak's work — the one read on this screen that is not about
 * the trak.
 *
 * **It cannot be derived from the detail, and that is the whole reason it exists.**
 * `worktree.base` is where the branch was cut from; where it would *go* is whatever branch
 * the machine running `serve` is standing on right now, which is a fact about somebody
 * else's checkout. The rule for a merge is that the destination is shown
 * and confirmed, so the button cannot name it without asking.
 *
 * **`enabled` rather than a poll predicate, and the two are not the same rule.**
 * `queryCache` bans a `refetchInterval` gated on *is anything happening*, because a query
 * that stops asking never learns it was wrong. This is gated on whether the trak still has
 * a destination at all — a merged, closed or working one does not — and while it has, it
 * polls unconditionally, which is what keeps the label true after somebody switches branch
 * over there.
 */

import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { mergePreview } from "../../../../api/actions"
import type { MergePreviewDto } from "../../../../api/types"
import { POLL_MS, queryKeys } from "../../../../queryCache"

export const mergePreviewQueryOptions = (
  id: string,
  enabled: boolean,
  queryFn: () => Promise<MergePreviewDto> = () => mergePreview(id),
) => ({
  queryKey: queryKeys.mergePreview(id),
  queryFn,
  enabled,
  refetchInterval: POLL_MS,
})

/** `enabled` is `destinationAsked(state)`, asked by the caller off the state it holds. */
export const useMergePreview = (id: string, enabled: boolean): UseQueryResult<MergePreviewDto> =>
  useQuery(mergePreviewQueryOptions(id, enabled))
