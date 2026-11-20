/**
 * One goal, whole — the goal, its log and its composer's transcript — for its screen.
 *
 * **Re-read on every `Goal` frame rather than patched**: the frame says only that the
 * goal moved (`useEngineStream`). The poll is the backstop, as it is for a trak.
 */

import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { goalDetail } from "../../api/goals"
import type { GoalDetailDto } from "../../api/types"
import { POLL_MS, queryKeys } from "../../queryCache"

/** Injectable so the key and the interval are reachable without React or a network. */
export const goalQueryOptions = (
  id: string,
  queryFn: () => Promise<GoalDetailDto> = () => goalDetail(id),
) => ({
  queryKey: queryKeys.goal(id),
  queryFn,
  refetchInterval: POLL_MS,
})

export const useGoal = (id: string): UseQueryResult<GoalDetailDto> => useQuery(goalQueryOptions(id))
