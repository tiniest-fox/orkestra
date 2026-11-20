/**
 * Pick the method a finished trak's pull request merges by, from the menu beside the
 * band's merge press. **Spends nothing and merges nothing** — it records the pick on the
 * trak, which the press and auto-merge both read — so it takes no `running`, for
 * `useSetAutoMerge`'s reason.
 *
 * **`picking` is the method on its way**, so the press names it at once rather than after
 * the trak refetches. Two refusals, `Archived` and `ChildTrak`, neither of which the band can
 * produce.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { setMergeMethod } from "../../../../api/actions"
import { RefusedError } from "../../../../api/http"
import { refusalSaid } from "../../../../format/refusal"
import { queryKeys } from "../../../../queryCache"
import { useScopedTo } from "../../../../hooks/useScopedTo"
import type { MergeMethod } from "../../pull-request/pullRequest"

export interface MergeMethodPick {
  /** Record it. Silently does nothing while a pick is on its way. */
  readonly pick: (method: MergeMethod) => void
  /** The method being recorded, or `undefined` where none is. */
  readonly picking: MergeMethod | undefined
  /** Why the last pick did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const setMergeMethodMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (method: MergeMethod) => Promise<void> = (method) => setMergeMethod(id, method),
) => ({
  mutationFn,
  // Returned, so `picking` holds across the refetch and the press never flicks back.
  onSuccess: () => cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
})

export const useSetMergeMethod = (id: string): MergeMethodPick => {
  const cache = useQueryClient()
  const mutation = useMutation(setMergeMethodMutationOptions(id, cache))
  useScopedTo(id, mutation.reset)
  const error = mutation.error ?? undefined

  return {
    pick: (method) => {
      if (mutation.isPending) return
      mutation.mutate(method)
    },
    picking: mutation.isPending ? mutation.variables : undefined,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : "Could not change the merge method.",
  }
}
