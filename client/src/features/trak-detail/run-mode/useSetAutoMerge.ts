/**
 * Turn auto-merge on or off for a trak, from the run-mode picker or the finished band.
 * `useSkipChecks`'s shape under `useSetMode`'s contract: **spends nothing and starts no
 * drive**, so it takes no `running` and is live while an agent works and at `Finished`.
 *
 * **One press, two directions, and the direction is the caller's**, for `useSetHold`'s
 * reason: which way the switch is pressed is a fact about `TrakDetailDto.autoMerge`, which
 * the caller has in hand. On is a fresh start on the engine's side, so a stopped auto-merge
 * is pressed *on* to try again.
 *
 * Three refusals — `Archived`, `ChildTrak` and `GoalForbidsAutoMerge`. The last is the one a
 * person can meet: nothing on the wire says a goal forbids auto-merge until a press asks.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { setAutoMerge } from "../../../api/actions"
import { RefusedError } from "../../../api/http"
import { refusalSaid } from "../../../format/refusal"
import { queryKeys } from "../../../queryCache"
import { useScopedTo } from "../../../hooks/useScopedTo"

export interface AutoMergeSetting {
  /** Turn it on or off. Silently does nothing while disabled. */
  readonly set: (on: boolean) => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const setAutoMergeMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (on: boolean) => Promise<void> = (on) => setAutoMerge(id, on),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/** Takes no `running`, deliberately — see `useSetMode`. */
export const useSetAutoMerge = (id: string): AutoMergeSetting => {
  const cache = useQueryClient()
  const mutation = useMutation(setAutoMergeMutationOptions(id, cache))
  useScopedTo(id, mutation.reset)
  const error = mutation.error ?? undefined

  return {
    set: (on) => {
      if (mutation.isPending) return
      mutation.mutate(on)
    },
    isPending: mutation.isPending,
    disabled: mutation.isPending,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : "Could not change auto-merge.",
  }
}
