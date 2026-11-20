/**
 * Every goal the project started, for the banners over the list — which draw every one not
 * dismissed — and the New Goal drawer and a trak's header. Polled like the list, and
 * re-read on every `Goal` frame.
 */

import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { listGoals } from "../../api/goals"
import type { GoalListDto } from "../../api/types"
import { POLL_MS, queryKeys } from "../../queryCache"

/** Injectable so the key and the interval are reachable without React or a network. */
export const goalsQueryOptions = (queryFn: () => Promise<GoalListDto> = listGoals) => ({
  queryKey: queryKeys.goals,
  queryFn,
  refetchInterval: POLL_MS,
})

export const useGoals = (): UseQueryResult<GoalListDto> => useQuery(goalsQueryOptions())
