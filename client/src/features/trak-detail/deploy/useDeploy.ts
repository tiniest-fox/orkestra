/**
 * What `deploy.sh` currently says about this trak's merge commit — the third read on this
 * screen that is not about the trak, beside the merge preview and the forge.
 *
 * **`enabled` rather than a poll predicate**, `usePullRequest`'s split: the finished
 * position is the only place a deploy is drawn, and there it polls unconditionally,
 * because a deploy goes live without anything happening to the trak and the poll is the
 * whole of how the block finds out. **The poll is `POLL_MS` and must not be made faster**:
 * every answer but `none` may run a script on the engine's machine, and the engine
 * reuses an answer for a short while precisely so several tabs are not several runs.
 *
 * Nothing invalidates this key: no press on the pane changes what a deploy would say.
 * Nothing remembers it across a reload either, unlike the forge's answers — a deploy's
 * status is a fact about a world that moves while nobody is looking, so the block asks
 * again the moment the page opens and draws the checking line until it hears.
 */

import { useQuery } from "@tanstack/react-query"
import { deploy } from "../../../api/trak"
import type { DeployDto } from "../../../api/types"
import { POLL_MS, queryKeys } from "../../../queryCache"

export const deployQueryOptions = (
  id: string,
  enabled: boolean,
  queryFn: () => Promise<DeployDto> = () => deploy(id),
) => ({
  queryKey: queryKeys.deploy(id),
  queryFn,
  enabled,
  refetchInterval: POLL_MS,
})

/**
 * Everything the block knows about the deploy at this moment.
 *
 * **`checking` is the first load and nothing else** — asked, and no answer in hand yet.
 * A read that failed is not checking: the block draws nothing there rather than a spinner
 * that never resolves, and the next poll is the retry.
 */
export interface Deploy {
  /** The engine's whole answer, `none` included, or `undefined` while none is in hand. */
  readonly answer: DeployDto | undefined
  readonly checking: boolean
  /** Whether a fetch is out right now, over an answer already drawn or not. */
  readonly fetching: boolean
}

/** `enabled` is the caller's — `deployAsked`, decided in `finishingLive`. */
export const useDeploy = (id: string, enabled: boolean): Deploy => {
  const query = useQuery(deployQueryOptions(id, enabled))
  return {
    answer: query.data,
    checking: enabled && query.isPending,
    fetching: query.isFetching,
  }
}
