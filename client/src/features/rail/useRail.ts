/**
 * One window's rail, as the shell or a host has it, and the presses on it.
 *
 * Read through the seam and written straight into the cache each time the seam says it
 * changed — `useRecents`'s shape. **Not polled, on either transport**: the shell pushes
 * every change over its bridge, and a host over its rail stream, each sending the rail
 * whole. A poll would put an engine's action seconds behind the pane beside it.
 *
 * **The presses are not mutations.** Each is a one-way message whose result is the next
 * state the seam pushes — a tile reads `starting`, a project leaves the rail — so there
 * is no pending flag here to hold, and nothing for a second press to race: the shell
 * starts one engine per project however many times it is asked, and a turn that would be
 * killed is the shell's own question. None of them spends.
 */

import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import {
  projectMenu,
  readRail,
  removeProject,
  retryProject,
  selectProject,
  watchRail,
} from "../../api/rail"
import type { RailStateDto } from "../../api/types"
import { queryKeys } from "../../queryCache"
import { hostTransport } from "../../slots"

export interface RailPresses {
  readonly select: (path: string) => void
  readonly retry: (path: string) => void
  readonly remove: (path: string) => void
  readonly menu: (path: string) => void
}

const presses: RailPresses = {
  select: (path) => selectProject(path, hostTransport),
  retry: retryProject,
  remove: removeProject,
  menu: projectMenu,
}

/** `queryFn` is injectable for `useTraks`'s reason: the decisions are reachable without React. */
const railQueryOptions = (
  queryFn: () => Promise<RailStateDto> = () => readRail(hostTransport),
) => ({
  queryKey: queryKeys.rail,
  queryFn,
  // A page coming back reopens the host's stream, whose first message is the whole rail;
  // a read on focus as well would ask every engine for its list in the same moment.
  refetchOnWindowFocus: false,
})

export const useRail = (): {
  readonly state: UseQueryResult<RailStateDto>
  readonly presses: RailPresses
} => {
  const client = useQueryClient()
  useEffect(
    () =>
      watchRail(
        (state) => client.setQueryData<RailStateDto>(queryKeys.rail, state),
        // The host's stream shut for good: read over HTTP, so a refusal is the query's error.
        () => void client.invalidateQueries({ queryKey: queryKeys.rail }),
        hostTransport,
      ),
    [client],
  )
  return { state: useQuery(railQueryOptions()), presses }
}
