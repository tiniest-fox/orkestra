/**
 * One trak's full projection — log, transcript, custody, the check — read once when the
 * drawer opens and patched from the stream after that.
 *
 * `refetchInterval` is `POLL_MS` for the reason `queryCache.ts` gives, and it is a
 * backstop rather than the transport: every patch the stream writes is a query update
 * that re-arms it, so it fires only once the stream has gone quiet. Nothing the drawer
 * draws may wait for it — which is why every derived field rides the `Appended` frame
 * and custody rides `Drive`. `useTrakDetail.test.ts` holds that.
 *
 * It exported `isRunning` — `custody.holder !== undefined`, the detail's version of the
 * summary's `running` — for the acting hooks to refuse a click with, and it is still not
 * exported now one is back. Custody answers *may I act*, never *should I poll*, so it
 * belongs to the press rather than to the query: `TrakDetailPage` reads `holder` off the
 * data it already has and hands it to `useApprove`. Polling stays unconditional.
 */

import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { trakDetail } from "../../api/trak"
import type { TrakDetailDto } from "../../api/types"
import { POLL_MS, queryKeys } from "../../queryCache"

export const trakDetailQueryOptions = (
  id: string,
  queryFn: () => Promise<TrakDetailDto> = () => trakDetail(id),
) => ({
  queryKey: queryKeys.trak(id),
  queryFn,
  refetchInterval: POLL_MS,
})

export const useTrakDetail = (id: string): UseQueryResult<TrakDetailDto> =>
  useQuery(trakDetailQueryOptions(id))
