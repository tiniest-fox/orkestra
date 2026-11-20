/**
 * Change a running goal's limits, modes and auto-merge. **Spends nothing**: the engine
 * replaces the goal's limits on its log and starts no turn, so there is no confirmation.
 * Setting auto-merge to Never or Always reaches the goal's live traks too, so their rows
 * are asked again.
 *
 * **No `running` argument**, for `usePauseGoal`'s reason: no turn holds anything this
 * route claims, and a change is wanted while the composer works. The guard is the pending
 * flag alone, and a callback that refuses while it is set — so a tap made before the last
 * one landed is dropped rather than racing it.
 *
 * `pending` is what was sent, while it is in flight, so the strips draw the press at once
 * rather than after the refetch; once it settles the goal's own limits are the truth again.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { setGoalSettings } from "../../api/goals"
import { RefusedError } from "../../api/http"
import { refusalSaid } from "../../format/refusal"
import { queryKeys } from "../../queryCache"
import { limitsOf, type Settings } from "./settings"

export interface GoalSettingsChange {
  readonly send: (settings: Settings) => void
  readonly pending: Settings | undefined
  readonly said: string | undefined
}

/** Injectable so the invalidation is reachable without React or a network. */
export const goalSettingsMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (settings: Settings) => Promise<void> = (settings) =>
    setGoalSettings(id, limitsOf(settings)),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.goal(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.goals }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

export const useGoalSettings = (id: string): GoalSettingsChange => {
  const cache = useQueryClient()
  const mutation = useMutation(goalSettingsMutationOptions(id, cache))
  const error = mutation.error ?? undefined
  return {
    send: (settings) => {
      if (mutation.isPending) return
      mutation.mutate(settings)
    },
    pending: mutation.isPending ? mutation.variables : undefined,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : "Could not save that.",
  }
}
