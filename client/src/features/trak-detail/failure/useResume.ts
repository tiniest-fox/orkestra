/**
 * Pick a stopped trak back up. **The fourth thing in this client that spends money**, and
 * the only one that is not a person answering a question.
 *
 * **It is the same contract as `useApprove`, and one difference.** Every rule
 * `client-style` sets for a hook that acts holds here unchanged — non-submittable while
 * in flight rather than merely spinning, disabled while `custody.holder` is set,
 * a callback that refuses when disabled, `onSuccess` returning the invalidation so the
 * press stays down across the refetch, and nothing auto-firing.
 *
 * The difference is what *nothing auto-fires* is protecting against here. An approval
 * cannot fire itself because no state asks for one twice; an interrupted trak, on the
 * other hand, is a standing condition — it is still interrupted on the next poll, and on
 * the one after that. A resume in an effect would therefore not be a stray double press,
 * it would be a loop spending on every render until the drive happened to claim custody
 * first. So this is a press, always, and the condition on screen is an invitation rather
 * than a trigger.
 *
 * **Both keys, for `useApprove`'s reason.** Resuming claims custody and re-issues a
 * command, which changes the detail behind this screen and the row in the list behind
 * that — `TrakSummaryDto` carries `state`, `running` and a projected `activity`, and this
 * press moves all three.
 *
 * **One refusal, and it is worth rendering anyway.** `409 Driving` is the only one the
 * route can answer with, and the button is already disabled while `running` — but
 * `running` is as fresh as the last poll, so a second tab or a `pnpm ork` claiming the
 * trak in between is exactly the race this sentence explains. `format/refusal.ts` owns
 * the wording, for the reason `useApprove` records.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { resume } from "../../../api/actions"
import { RefusedError } from "../../../api/http"
import { refusalSaid } from "../../../format/refusal"
import { queryKeys } from "../../../queryCache"
import { useScopedTo } from "../../../hooks/useScopedTo"

export interface Resumption {
  /** Pick it up. Silently does nothing while disabled, whatever the control did. */
  readonly resume: () => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const resumeMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: () => Promise<void> = () => resume(id),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/**
 * `running` is the detail's `custody.holder !== undefined` — read by the caller rather
 * than fetched here, for `useApprove`'s reason. It is doing double duty on this press:
 * the same fact decides whether the control exists at all, since a trak nobody is driving
 * is half of what interrupted means. `controls.ts` asks it there; this asks it again as a
 * guard, because a control that forgot to would still not be allowed to start a second
 * drive.
 */
export const useResume = (id: string, running: boolean): Resumption => {
  const cache = useQueryClient()
  const mutation = useMutation(resumeMutationOptions(id, cache))
  // The id moves under this hook twice over: the route param changes without the component
  // unmounting, and the notice this draws on is keyed to whichever trak owns the position —
  // so stepping from one stopped piece of a spawn to another is a change of subject with no
  // navigation at all. `useScopedTo` carries what would otherwise survive either.
  useScopedTo(id, mutation.reset)
  const disabled = mutation.isPending || running
  const error = mutation.error ?? undefined

  return {
    resume: () => {
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
          : "Could not pick that up.",
  }
}
