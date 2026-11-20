/**
 * Ask a running trak to run no checks on its next step, or take that back. `useSetHold`'s
 * twin with the opposite promise — a hold adds a stop, this removes the one a script would
 * have made — and under `useSetMode`'s contract for its reasons: **spends nothing and
 * starts no drive**, so it takes no `running` and is live while an agent works. That is
 * the case it exists for: the switch is flipped while the step whose checks are not worth
 * running is still being written.
 *
 * **One press, two directions, and the direction is the caller's**, for `useSetHold`'s
 * reason: which way the row is pressed is a fact about `TrakDetailDto.skippingChecks`,
 * which the picker has in hand and this hook does not.
 *
 * One refusal, `409 AtRest`. Unlike the hold there is no `OnManual`: every mode runs its
 * checks, so the row is offered on every mode and the route refuses none of them.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { setSkipChecks } from "../../../api/actions"
import { RefusedError } from "../../../api/http"
import { refusalSaid } from "../../../format/refusal"
import { queryKeys } from "../../../queryCache"
import { useScopedTo } from "../../../hooks/useScopedTo"

export interface SkipChecksSetting {
  /** Ask for the skip, or take it back. Silently does nothing while disabled. */
  readonly set: (skipping: boolean) => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const setSkipChecksMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (skipping: boolean) => Promise<void> = (skipping) => setSkipChecks(id, skipping),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/** Takes no `running`, deliberately — see `useSetMode`. */
export const useSkipChecks = (id: string): SkipChecksSetting => {
  const cache = useQueryClient()
  const mutation = useMutation(setSkipChecksMutationOptions(id, cache))
  useScopedTo(id, mutation.reset)
  const error = mutation.error ?? undefined

  return {
    set: (skipping) => {
      if (mutation.isPending) return
      mutation.mutate(skipping)
    },
    isPending: mutation.isPending,
    disabled: mutation.isPending,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : "Could not change the skip.",
  }
}
