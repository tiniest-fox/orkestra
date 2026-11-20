/**
 * Drop a goal that is still going. **Spends nothing**: a composer turn in flight is
 * killed, the holds a pause put on come off, and the goal comes to rest as Dropped. Its
 * traks keep running as the person's own, and Dismiss on its rest row takes it off the list.
 *
 * **No `running` argument**, for `usePauseGoal`'s reason: a drop is the press somebody
 * reaches for while the composer works. The guard is the pending flag alone, and a
 * callback that refuses while it is set.
 *
 * The route takes a reason and the press asks for none — `Confirmation` takes no field —
 * so the reason is fixed, worded to follow `Dropped:` on the goal's rest card.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { dropGoal } from "../../api/goals"
import { RefusedError } from "../../api/http"
import { refusalSaid } from "../../format/refusal"
import { queryKeys } from "../../queryCache"

const REASON = "no longer wanted"

export interface GoalDrop {
  readonly drop: () => void
  readonly isPending: boolean
  readonly said: string | undefined
}

/** Injectable so the invalidation is reachable without React or a network. */
export const dropGoalMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: () => Promise<void> = () => dropGoal(id, REASON),
) => ({
  mutationFn,
  // The traks too: dropping a paused goal takes its holds off them, which their rows draw.
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.goal(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.goals }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

export const useDropGoal = (id: string): GoalDrop => {
  const cache = useQueryClient()
  const mutation = useMutation(dropGoalMutationOptions(id, cache))
  const error = mutation.error ?? undefined
  return {
    drop: () => {
      if (mutation.isPending) return
      mutation.mutate()
    },
    isPending: mutation.isPending,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? // The goal came to rest between the render and the press; the shared
            // sentence names a trak.
            error.refusal._tag === "AtRest"
            ? "This goal has already come to rest."
            : refusalSaid(error.refusal)
          : "Could not send that.",
  }
}
