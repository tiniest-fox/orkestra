/**
 * Take a goal at rest off the traks list, for every device: the engine keeps the
 * dismissal on the goal's log. **Spends nothing**, and starts no drive.
 *
 * Still `client-style`'s acting-hook contract in its two halves that apply: disabled
 * while its own press is in flight, and a callback that refuses while it is. One mutation
 * for every goal in the stack, so two dismissals cannot race — but it says *which* goal is
 * in flight, so only that goal's row greys its Dismiss out.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { dismissGoal } from "../../api/goals"
import { queryKeys } from "../../queryCache"

export interface GoalDismiss {
  /** Dismiss `id`. Silently does nothing while any dismissal is in flight. */
  readonly dismiss: (id: string) => void
  /** The goal a dismissal is in flight for, or `undefined`. */
  readonly dismissing: string | undefined
}

/** Injectable so the invalidation is reachable without React or a network. */
export const dismissGoalMutationOptions = (
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (id: string) => Promise<void> = dismissGoal,
) => ({
  mutationFn,
  onSuccess: (_: void, id: string) =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.goals }),
      cache.invalidateQueries({ queryKey: queryKeys.goal(id) }),
    ]),
})

export const useDismissGoal = (): GoalDismiss => {
  const cache = useQueryClient()
  const mutation = useMutation(dismissGoalMutationOptions(cache))
  return {
    dismiss: (id) => {
      if (mutation.isPending) return
      mutation.mutate(id)
    },
    dismissing: mutation.isPending ? mutation.variables : undefined,
  }
}
