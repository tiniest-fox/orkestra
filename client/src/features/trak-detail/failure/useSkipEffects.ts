/**
 * Get a trak past the effect that stopped it without running it again. **Spends money**
 * where the next step runs an agent, because the trak enters that step at once.
 *
 * **`useResume`'s contract, for `useResume`'s reason.** A failed effect is a standing
 * condition — still there on the next poll — so a skip in an effect would enter the next
 * step on every render. This is a press, always: non-submittable while in flight, disabled
 * while `custody.holder` is set, a callback that refuses when disabled, `onSuccess`
 * returning the invalidation, nothing auto-firing.
 *
 * **Both keys**, for `useResume`'s reason: the detail and the list row both carry `state`.
 *
 * **Two refusals.** `409 Driving` is the race every acting hook has; `409 NoFailedEffect`
 * is this one's own — a restart from another tab moved the trak first. `format/refusal.ts`
 * owns the wording.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { skipEffects } from "../../../api/actions"
import { RefusedError } from "../../../api/http"
import { refusalSaid } from "../../../format/refusal"
import { queryKeys } from "../../../queryCache"
import { useScopedTo } from "../../../hooks/useScopedTo"

export interface EffectSkipping {
  /** Enter the next step. Silently does nothing while disabled, whatever the control did. */
  readonly skip: () => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const skipEffectsMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: () => Promise<void> = () => skipEffects(id),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/** `running` is the detail's `custody.holder !== undefined`, read by the caller. */
export const useSkipEffects = (id: string, running: boolean): EffectSkipping => {
  const cache = useQueryClient()
  const mutation = useMutation(skipEffectsMutationOptions(id, cache))
  useScopedTo(id, mutation.reset)
  const disabled = mutation.isPending || running
  const error = mutation.error ?? undefined

  return {
    skip: () => {
      if (disabled) return
      mutation.mutate()
    },
    isPending: mutation.isPending,
    disabled,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : "Could not skip that.",
  }
}
