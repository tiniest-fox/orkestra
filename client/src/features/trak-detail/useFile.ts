/**
 * Ask the step for what it has — kill the turn in flight where there is one, and re-enter
 * the step told to file. **The thirteenth acting hook, and `useStop`'s twin.**
 *
 * **The third exception to *disabled while `running` is true*, and it is the same
 * exception `useStop` is**: this press is the interruption. Mid-turn the route takes the
 * drive over and kills the agent, so a control greyed out while an agent is working would
 * be dead in exactly the case somebody reached for it. What it forks in the drive's place
 * is the difference from stopping — the step re-entered at once and asked to file, rather
 * than a gate to talk at.
 *
 * **At a step gate with nothing filed there is nothing to kill, and the same hook serves.**
 * A conversation it parked in, a question it asked, or an account of why it is stuck — the
 * route re-enters the step from any of them told to settle what is open and file, refusing
 * `409 Driving` if something else already holds the trak. `fileOffered` withholds the press
 * there while anything drives, so the refusal is a race rather than a press the surface
 * offered. That is why this takes **no `running` argument at all**, for `useStop`'s reason:
 * custody decides whether the control exists, in `controls.ts`, and one way up at each of
 * the two places.
 *
 * The other two halves of the contract hold and are not optional:
 *
 *   · **disabled while its own mutation is pending**, so a double press is one filing —
 *     and it is the visible half mid-turn, because the route waits for the kill before it
 *     answers, which is the grace period `killGroup` gives the agent;
 *   · **the callback refuses when disabled**, so a control that forgot to read it still
 *     cannot send twice.
 *
 * **Both keys, for `useApprove`'s reason** — a filing moves the trak, which changes the
 * detail on this screen and the row in the list behind it.
 *
 * **Two refusals, and `NothingToStop` is the one a correctly offered press can earn**: the
 * engine records a turn a moment after the state says one has begun, and nothing on the
 * wire can see the far side of that window. The sentence is what both cases are for.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { fileTrak } from "../../api/actions"
import { RefusedError } from "../../api/http"
import { refusalSaid } from "../../format/refusal"
import { queryKeys } from "../../queryCache"
import { useScopedTo } from "../../hooks/useScopedTo"

export interface Filing {
  /** Ask it to file. Silently does nothing while disabled, whatever the control did. */
  readonly file: () => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const fileMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: () => Promise<void> = () => fileTrak(id),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/** Takes no `running`, deliberately — see above. */
export const useFile = (id: string): Filing => {
  const cache = useQueryClient()
  const mutation = useMutation(fileMutationOptions(id, cache))
  // For `useSendChat`'s reason: this hook is keyed to whichever trak owns the position on
  // screen, and stepping to a piece of a spawn changes the subject with no navigation.
  useScopedTo(id, mutation.reset)
  const error = mutation.error ?? undefined

  return {
    file: () => {
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
          : "Could not ask for that.",
  }
}
