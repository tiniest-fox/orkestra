/**
 * Pause or resume a goal. Pausing spends nothing: the engine holds each live trak of the
 * goal at its next gate and the composer takes no turn. **Resuming spends** where the goal
 * owes a turn, which starts at once.
 *
 * **No `running` argument.** Neither route claims anything a turn holds — a pause is the
 * press somebody reaches for while the composer works — so the guard is the pending
 * flag alone, and a callback that refuses while it is set.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { pauseGoal } from "../../api/goals"
import { RefusedError } from "../../api/http"
import { refusalSaid } from "../../format/refusal"
import { queryKeys } from "../../queryCache"

export interface GoalPause {
  readonly pause: (paused: boolean) => void
  readonly isPending: boolean
  readonly said: string | undefined
}

/** Injectable so the invalidation is reachable without React or a network. */
export const pauseGoalMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (paused: boolean) => Promise<void> = (paused) => pauseGoal(id, paused),
) => ({
  mutationFn,
  // The traks too: a pause puts a hold on each live one, which their rows draw.
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.goal(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.goals }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

export const usePauseGoal = (id: string): GoalPause => {
  const cache = useQueryClient()
  const mutation = useMutation(pauseGoalMutationOptions(id, cache))
  const error = mutation.error ?? undefined
  return {
    pause: (paused) => {
      if (mutation.isPending) return
      mutation.mutate(paused)
    },
    isPending: mutation.isPending,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : "Could not send that.",
  }
}
