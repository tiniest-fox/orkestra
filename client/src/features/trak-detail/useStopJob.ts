/**
 * Stop one background job the agent left running — the press on the strip's rows and on
 * a job's card. **The fifth acting hook that spends nothing**, and it kills no turn:
 * the route writes one control line down the turn's own open pipe.
 *
 * **The third exception to *disabled while `running` is true***, and the reason is the
 * same shape `useStop`'s is: a background job only exists while something is driving
 * the trak, so a press greyed out under `running` would be dead in every case it is
 * drawn for. No `running` argument at all, for `useStop`'s reason.
 *
 * One mutation for every job rather than one hook per card, because the strip draws a
 * press per row and hooks cannot be called in a loop — the task id travels as the
 * mutation's variable instead. While one stop is in flight every press is disabled: the
 * route answers in milliseconds, and per-task pending state would buy a second stop of
 * a different job a person has not read the outcome of the first against.
 *
 * The `204` is not the outcome. What says the job is gone is the stream — the level
 * shrinks and the report lands `stopped` on the card — which is why success invalidates
 * the detail rather than trusting its own eyes.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { stopBackgroundTask } from "../../api/actions"
import { RefusedError } from "../../api/http"
import { refusalSaid } from "../../format/refusal"
import { queryKeys } from "../../queryCache"
import { useScopedTo } from "../../hooks/useScopedTo"

export interface StoppingJob {
  /** Stop the named job. Silently does nothing while disabled. */
  readonly stop: (taskId: string) => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const stopJobMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (taskId: string) => Promise<void> = (taskId) => stopBackgroundTask(id, taskId),
) => ({
  mutationFn,
  // The detail alone: the list's row reads custody, and no turn was killed here.
  onSuccess: () => cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
})

/** Takes no `running`, deliberately — see above. */
export const useStopJob = (id: string): StoppingJob => {
  const cache = useQueryClient()
  const mutation = useMutation(stopJobMutationOptions(id, cache))
  useScopedTo(id, mutation.reset)
  const error = mutation.error ?? undefined

  return {
    stop: (taskId: string) => {
      if (mutation.isPending) return
      mutation.mutate(taskId)
    },
    isPending: mutation.isPending,
    disabled: mutation.isPending,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : "Could not stop that job.",
  }
}
