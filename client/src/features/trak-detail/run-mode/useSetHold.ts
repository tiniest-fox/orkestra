/**
 * Ask a running trak to hold its current step until a person accepts it, whatever the
 * mode would do at its gates, or take that back. A spawn cannot be held — `holdOffered`
 * withholds the switch while one runs. **Spends nothing and starts no drive**, under `useSetMode`'s contract and for
 * its reasons — this is the other press meant to land while an agent is working.
 *
 * **One press, two directions, and the direction is the caller's.** The row in the picker
 * is a switch: pressed while nothing is pending it asks for the hold, pressed while one is
 * it takes the hold back. Which of the two is a fact about `TrakDetailDto.holding`, which
 * the picker has in hand and this hook does not, so `set` takes the value rather than
 * toggling something it would have to hold a second opinion about.
 *
 * Two refusals: `409 AtRest`, as the mode's, and `409 OnManual` — the picker does not
 * offer the row on `manual`, so the second is a stale screen's alone.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { setHold } from "../../../api/actions"
import { RefusedError } from "../../../api/http"
import { refusalSaid } from "../../../format/refusal"
import { queryKeys } from "../../../queryCache"
import { useScopedTo } from "../../../hooks/useScopedTo"

export interface HoldSetting {
  /** Ask for the hold, or take it back. Silently does nothing while disabled. */
  readonly set: (holding: boolean) => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const setHoldMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (holding: boolean) => Promise<void> = (holding) => setHold(id, holding),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/** Takes no `running`, deliberately — see `useSetMode`. */
export const useSetHold = (id: string): HoldSetting => {
  const cache = useQueryClient()
  const mutation = useMutation(setHoldMutationOptions(id, cache))
  useScopedTo(id, mutation.reset)
  const error = mutation.error ?? undefined

  return {
    set: (holding) => {
      if (mutation.isPending) return
      mutation.mutate(holding)
    },
    isPending: mutation.isPending,
    disabled: mutation.isPending,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : "Could not change the hold.",
  }
}
