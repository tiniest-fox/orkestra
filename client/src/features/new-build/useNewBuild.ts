/**
 * Whether to offer a reload into a newer client, and the two answers a person can give.
 *
 * The engine reports which build `client/dist` holds now on `/api/health`; the page asks
 * on a slow poll while the tab is visible, when the tab becomes visible again, and each
 * time the stream connects (`useEngineStream` invalidates the key). A hidden tab does not
 * poll, which TanStack gives for nothing.
 *
 * **The page never reloads by itself.** Nothing saves a half-typed message, so the
 * reload happens only when somebody presses it. *Later* sets the offered id aside for the
 * life of the page, and a build after that one is offered again.
 *
 * **A page with no build id of its own never asks** — Vite's dev page, where the engine's
 * `client/dist` says nothing about the code on screen.
 */

import { useCallback, useState } from "react"
import { queryOptions, useQuery } from "@tanstack/react-query"
import { engineBuild } from "../../api/engine"
import { queryKeys } from "../../queryCache"
import { OWN_BUILD, newerBuild } from "./newBuild"

/** Five minutes: a rebuild is not urgent, and tab return and a reconnect ask sooner. */
export const BUILD_POLL_MS = 5 * 60_000

export const buildQueryOptions = (
  read: () => Promise<string | undefined>,
  own: string | undefined,
) =>
  queryOptions({
    queryKey: queryKeys.build,
    queryFn: read,
    enabled: own !== undefined,
    refetchInterval: BUILD_POLL_MS,
    // The tab-return check. TanStack's focus is `visibilitychange`, and the answer is
    // always stale, so every return asks.
    refetchOnWindowFocus: true,
    // A failed read is *could not tell*, and the next poll is the retry.
    retry: false,
  })

export interface NewBuildOffer {
  readonly open: boolean
  readonly reload: () => void
  readonly later: () => void
}

export const useNewBuild = (
  read: () => Promise<string | undefined> = engineBuild,
  own: string | undefined = OWN_BUILD,
): NewBuildOffer => {
  const reported = useQuery(buildQueryOptions(read, own)).data
  const [dismissed, setDismissed] = useState<string | undefined>()
  const offered = newerBuild(own, reported, dismissed)
  const later = useCallback(() => {
    setDismissed(offered)
  }, [offered])
  const reload = useCallback(() => {
    window.location.reload()
  }, [])
  return { open: offered !== undefined, reload, later }
}
