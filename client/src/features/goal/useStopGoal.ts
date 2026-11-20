/**
 * Stop the goal's composer turn in flight. **Spends nothing**: the turn is killed and the
 * goal stands where it would have ended — at the gate the turn asked for, at the file gate
 * while a draft waits, or watching — owing no turn until somebody chats or presses.
 *
 * **No `running` argument**, for `useStop`'s reason: this press is the interruption, so a
 * control greyed out while the composer works would be dead in the one case it exists
 * for. The bar decides whether the control is drawn, off `GoalDto.running`. The guard is
 * the pending flag, and a callback that refuses while it is set.
 *
 * **One refusal, `409 NothingToStop`**: the turn ended between the render and the press.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { stopGoal } from "../../api/goals"
import { RefusedError } from "../../api/http"
import { refusalSaid } from "../../format/refusal"
import { queryKeys } from "../../queryCache"
import type { Stopping } from "../trak-detail/useStop"

/** Injectable so the invalidation is reachable without React or a network. */
export const stopGoalMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: () => Promise<void> = () => stopGoal(id),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.goal(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.goals }),
    ]),
})

export const useStopGoal = (id: string): Stopping => {
  const cache = useQueryClient()
  const mutation = useMutation(stopGoalMutationOptions(id, cache))
  const error = mutation.error ?? undefined
  return {
    stop: () => {
      if (mutation.isPending) return
      mutation.mutate()
    },
    isPending: mutation.isPending,
    disabled: mutation.isPending,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? error.refusal._tag === "NothingToStop"
            ? "The composer had already finished."
            : refusalSaid(error.refusal)
          : "Could not stop that.",
  }
}
