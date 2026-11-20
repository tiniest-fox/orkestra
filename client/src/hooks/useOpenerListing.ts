/**
 * The terminals and editors the engine's machine has, and the one of each a press on an
 * opener control opens — the read behind every `OpenerControl` on screen, in the top bar,
 * a trak's header band and a piece's alike.
 *
 * **`"unsupported"` is data, not an error**: it is the empty 204 every platform but
 * macOS answers, so the query settles on it and no control is drawn. A genuine error
 * hides them the same way — they are convenience presses, and a header explaining why a
 * shortcut is missing would cost more than the shortcut.
 *
 * **`enabled` is the phone breakpoint, and the reason is the engine rather than the
 * screen.** Below the breakpoint no control is drawn — the one viewer known not to
 * be at the engine's desk — and the route behind this spawns a `plutil` per installed
 * application, so a phone asking would run the scan for controls it cannot show. The
 * same cost is why the key does not poll; `queryCache` carries that half.
 */

import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { listOpeners } from "../api/openers"
import type { OpenersDto } from "../api/types"
import { queryKeys } from "../queryCache"

export type OpenersListing = OpenersDto | "unsupported"

/** Injectable so the decisions — the key, `enabled`, no interval — are reachable without React. */
export const openerListingQueryOptions = (
  enabled: boolean,
  queryFn: () => Promise<OpenersListing> = listOpeners,
) => ({
  queryKey: queryKeys.openers,
  queryFn,
  enabled,
})

export const useOpenerListing = (enabled: boolean): UseQueryResult<OpenersListing> =>
  useQuery(openerListingQueryOptions(enabled))
