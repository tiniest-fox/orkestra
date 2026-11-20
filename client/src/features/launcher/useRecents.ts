/**
 * The recent projects, as the shell has them — or a host's projects, where there is no
 * shell: read once through the seam, then written straight into the cache each time the
 * shell says the list changed. No interval — the list is the shell's own file and the
 * bridge reports every change to it, so a poll would ask a process on the same machine
 * for a fact it has already pushed, and a host reads its list once at boot.
 */

import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { readRecents, watchRecents } from "../../api/launcher"
import type { RecentProjectDto } from "../../api/types"
import { queryKeys } from "../../queryCache"
import { hostTransport } from "../../slots"

type Recents = readonly RecentProjectDto[]

/** `queryFn` is injectable for `useTraks`'s reason: the decisions are reachable without React. */
export const recentsQueryOptions = (
  queryFn: () => Promise<Recents> = () => readRecents(hostTransport),
) => ({
  queryKey: queryKeys.recents,
  queryFn,
})

export const useRecents = (): UseQueryResult<Recents> => {
  const client = useQueryClient()
  useEffect(
    () => watchRecents((recents) => client.setQueryData<Recents>(queryKeys.recents, recents)),
    [client],
  )
  return useQuery(recentsQueryOptions())
}
