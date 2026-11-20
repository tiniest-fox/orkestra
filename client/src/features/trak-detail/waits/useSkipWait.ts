/**
 * Start the step a resting trak is held at, with its wait unmet. **Spends money**, on
 * every kind of wait — a script's not-yet, one that gave up, `merged`, `deployed`, and a
 * clock — because the engine starts the held step's own turn at once.
 *
 * **`useResume`'s contract, for `useResume`'s reason.** A wait is a standing condition —
 * the trak is still held on the next poll, and the one after — so a skip in an effect
 * would not be a stray double press, it would be a `claude` per render. This is a press,
 * always: non-submittable while in flight, disabled while `custody.holder` is set, a
 * callback that refuses when disabled, `onSuccess` returning the invalidation, nothing
 * auto-firing.
 *
 * **Both keys.** Skipping claims custody and starts a drive, which changes the detail
 * behind this screen and the row in the list behind that — `TrakSummaryDto` carries
 * `state`, `running` and `waiting`, and this press moves all three.
 *
 * **Two refusals, and both are worth a sentence.** `409 Driving` is the race every acting
 * hook has; `409 NotWaiting` is this one's own — the trak stopped resting between the
 * poll that drew the press and the press, which a second tab or a sweep that found the
 * condition met can do. `format/refusal.ts` owns the wording.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { skipWait } from "../../../api/actions"
import { RefusedError } from "../../../api/http"
import { refusalSaid } from "../../../format/refusal"
import { queryKeys } from "../../../queryCache"
import { useScopedTo } from "../../../hooks/useScopedTo"

export interface Skipping {
  /** Run the held step now. Silently does nothing while disabled, whatever the control did. */
  readonly skip: () => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const skipWaitMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: () => Promise<void> = () => skipWait(id),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/**
 * `running` is the detail's `custody.holder !== undefined` — read by the caller, so this
 * hook holds no second opinion about a trak the page already has in hand.
 */
export const useSkipWait = (id: string, running: boolean): Skipping => {
  const cache = useQueryClient()
  const mutation = useMutation(skipWaitMutationOptions(id, cache))
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
          : "Could not start that step.",
  }
}
