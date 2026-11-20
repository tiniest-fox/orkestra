/**
 * Interrupt the turn in flight, so a person can say something else. **The tenth acting
 * hook, and the fourth that spends nothing.**
 *
 * **The second exception to *disabled while `running` is true*, and it needs the same
 * shape of reason `useArchiveUnfinished` has**: `client-style` says a second one is allowable only
 * where *this press is the interruption*, never where *this press is cheap*. It is the
 * first — the route takes the drive over and kills the agent, so a control greyed out
 * while an agent is working would be dead in exactly the case somebody reached for it.
 * The difference from abandoning is what it forks in the drive's place: an ending there,
 * a gate here, with the killed turn's conversation filed so whatever is typed next
 * resumes it.
 *
 * The other two halves of the contract hold and are not optional:
 *
 *   · **disabled while its own mutation is pending**, so a double press is one stop. The
 *     route answers once the stop is on the log, before the kill; from then the trak is
 *     `Stopping` and the page draws `stopPressTaken` in this press's place until it parks;
 *   · **the callback refuses when disabled**, so a control that forgot to read it still
 *     cannot send twice.
 *
 * **No `running` argument at all**, for `useArchiveUnfinished`'s reason: a hook that took the fact
 * and did nothing with it would read as an oversight at every call site. `stopOffered` is
 * where custody decides whether the control exists, and it decides the opposite way from
 * every other control — there is nothing to stop unless something is driving.
 *
 * **Both keys, for `useApprove`'s reason** — a stop parks the trak, which changes the
 * detail on this screen and the row in the list behind it.
 *
 * **One refusal, `409 NothingToStop`**, for a client that fell behind — the turn ended
 * before the press arrived. A press before the turn has spawned is accepted and cancels
 * the spawn. The sentence is what the refusal is for.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { stopTrak } from "../../api/actions"
import { RefusedError } from "../../api/http"
import { refusalSaid } from "../../format/refusal"
import { queryKeys } from "../../queryCache"
import { useScopedTo } from "../../hooks/useScopedTo"

export interface Stopping {
  /** Stop it. Silently does nothing while disabled, whatever the control did. */
  readonly stop: () => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/**
 * The press once it was taken: drawn busy and not pressable while the engine ends the
 * turn, so a stop that has answered still shows as under way — `stopTaken` says where.
 */
export const stopPressTaken: Stopping = {
  stop: () => undefined,
  isPending: true,
  disabled: true,
  said: undefined,
}

/** Injectable so the decisions here are reachable without React or a network. */
export const stopMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: () => Promise<void> = () => stopTrak(id),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/** Takes no `running`, deliberately — see above. */
export const useStop = (id: string): Stopping => {
  const cache = useQueryClient()
  const mutation = useMutation(stopMutationOptions(id, cache))
  // For `useSendChat`'s reason: this hook is keyed to whichever trak owns the position on
  // screen, and stepping to a piece of a spawn changes the subject with no navigation.
  useScopedTo(id, mutation.reset)
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
          ? refusalSaid(error.refusal)
          : "Could not stop that.",
  }
}
