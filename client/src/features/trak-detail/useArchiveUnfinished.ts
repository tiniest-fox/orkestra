/**
 * Archive a trak that has not finished: the agent mid-turn is interrupted, what exists is
 * committed, and then the checkout, the branch, its recorded base ref and the branch's
 * copy on GitHub all go — work that exists nowhere else goes with them, and the
 * confirmation on the press is the only guard. **The eighth acting hook, and the third
 * that spends nothing.**
 *
 * **It is the one exception to *disabled while `running` is true*, and the exception is
 * the feature.** That rule exists to stop a second drive racing the first — every other
 * press here would be starting a turn beside one already going. This press exists to end
 * the one already going: the route interrupts whatever holds the trak and forks the
 * ending in its place, so a control greyed out while an agent is working would be dead in
 * exactly the case somebody reached for it. `client-style`'s hook contract records the
 * exception; the other two halves of it still hold here, and neither is optional:
 *
 *   · **disabled while its own mutation is pending**, so a double click is one archive,
 *   · **the callback refuses when disabled**, so a control that forgot to read it still
 *     cannot send twice.
 *
 * **No `running` argument at all**, rather than one this ignores: a hook that took the fact
 * and did nothing with it would read as an oversight at every call site, and the next
 * person to add a guard would add the wrong one.
 *
 * **Both keys, for `useApprove`'s reason** — an ending changes the detail behind this
 * screen and the row in the list behind that.
 *
 * **One refusal, and it is not `Driving`.** `409 AtRest` is a trak that has already
 * ended. The surface does not offer the press there — `controls.ts` decides that — so a
 * refusal here is a client that fell behind, which is what the sentence is for.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { archiveUnfinishedTrak } from "../../api/actions"
import { RefusedError } from "../../api/http"
import { refusalSaid } from "../../format/refusal"
import { queryKeys } from "../../queryCache"
import { useScopedTo } from "../../hooks/useScopedTo"

export interface UnfinishedArchive {
  /** End it and put it away. Silently does nothing while disabled, whatever the control did. */
  readonly archive: () => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const archiveUnfinishedMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: () => Promise<void> = () => archiveUnfinishedTrak(id),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/** Takes no `running`, deliberately — see above. */
export const useArchiveUnfinished = (id: string): UnfinishedArchive => {
  const cache = useQueryClient()
  const mutation = useMutation(archiveUnfinishedMutationOptions(id, cache))
  // For `useResume`'s reason: the page's own trak changes under this hook whenever the route
  // param does, which is every link from the list.
  useScopedTo(id, mutation.reset)
  const error = mutation.error ?? undefined

  return {
    archive: () => {
      if (mutation.isPending) return
      mutation.mutate()
    },
    isPending: mutation.isPending,
    disabled: mutation.isPending,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : "Could not end that.",
  }
}
