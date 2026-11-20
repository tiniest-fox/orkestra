/**
 * Start a goal from a sentence. **Spends money**: the goal's composer starts at once and
 * drafts its file, which is a real `claude`.
 *
 * `client-style`'s acting-hook contract, as `useCreateTrak` keeps it: disabled while in
 * flight, a callback that refuses while disabled, the list invalidated in the promise the
 * mutation waits on, and nothing fired from an effect. There is no `running` to read: the
 * goal does not exist until this succeeds, and a 202 navigates to it.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { startGoal } from "../../api/goals"
import type { CreatedDto } from "../../api/types"
import { queryKeys } from "../../queryCache"
import type { GoalModes } from "./modes"

export interface GoalAsk {
  readonly asked: string
  readonly modes: GoalModes
  /** Upload ids for the files the sentence arrived with. */
  readonly attachments: readonly string[]
}

export interface GoalStarting {
  readonly start: (ask: GoalAsk) => void
  readonly isPending: boolean
  readonly error: Error | undefined
}

export const useStartGoal = (onStarted: (id: string) => void): GoalStarting => {
  const cache = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ asked, modes, attachments }: GoalAsk) => startGoal(asked, modes, attachments),
    onSuccess: async (created: CreatedDto) => {
      await cache.invalidateQueries({ queryKey: queryKeys.goals })
      onStarted(created.id)
    },
  })
  return {
    start: (ask) => {
      if (mutation.isPending) return
      mutation.mutate(ask)
    },
    isPending: mutation.isPending,
    error: mutation.error ?? undefined,
  }
}
