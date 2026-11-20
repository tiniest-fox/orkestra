/**
 * Each CLI's plan usage, as the engine last read it — the git bar's usage cells and the
 * phone's usage tab.
 *
 * **Polled though nothing here can make the engine read.** A read is the daemon's memory
 * and costs nothing; only a running turn on a CLI reports a reading for it, and each one arrives
 * as a `Usage` frame, which `useEngineStream` writes here. The poll is the backstop a
 * stream always has.
 */

import { useQuery } from "@tanstack/react-query"
import { usage } from "../../../api/usage"
import type { CliUsageDto, CliUsagesDto } from "../../../api/types"
import { POLL_MS, queryKeys } from "../../../queryCache"

/** `queryFn` injectable, so the key and the interval are reachable without React. */
export const usageQueryOptions = (queryFn: () => Promise<CliUsagesDto> = usage) => ({
  queryKey: queryKeys.usage,
  queryFn,
  refetchInterval: POLL_MS,
})

/** `undefined` until the first answer, and while none has ever come. */
export const useUsage = (): readonly CliUsageDto[] | undefined =>
  useQuery(usageQueryOptions()).data?.clis
