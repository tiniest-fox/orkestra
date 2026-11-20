/**
 * The hosted processes the project declares, at one trak's checkout — or with no trak at
 * the project checkout, which the git bar draws.
 *
 * Polled unconditionally, as everything the engine owns is, even while nothing shows the
 * list: the side panel's opener and the git bar's cell each wear the worst state, so the
 * answer is on screen either way. The process family of frames patches it between polls —
 * `applyProcessFrame`.
 */

import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { hostedProcesses } from "../api/trak"
import type { HostedProcessDto } from "../api/types"
import { POLL_MS } from "../queryCache"
import { processesKey } from "./useProcessPress"

export const processesQueryOptions = (
  id: string | undefined,
  queryFn: () => Promise<readonly HostedProcessDto[]> = () => hostedProcesses(id),
) => ({
  queryKey: processesKey(id),
  queryFn,
  refetchInterval: POLL_MS,
})

export const useProcesses = (id: string | undefined): UseQueryResult<readonly HostedProcessDto[]> =>
  useQuery(processesQueryOptions(id))
