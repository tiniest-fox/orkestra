/**
 * Answer what a turn asked. **The fourth thing in this client that spends money**, and the
 * first whose payload is a shape rather than a sentence.
 *
 * `client-style`'s contract for a hook that acts holds here exactly as it does for
 * `useApprove` — non-submittable while in flight, disabled while `custody.holder` is set,
 * the callback refusing when disabled, `onSuccess` returning the invalidation, and nothing
 * auto-firing. That file carries the argument for each; what is new here is the payload.
 *
 * **One hook for two gates, because `AnswerQuestions` is one action.** The composer's
 * questions and a step's are the same shape on the wire and go to the same route — `/act`
 * reads which gate it lands at off the log, and this file must not hold a second opinion
 * about that. Which gates *offer* it is `controls.ts`, and it is two exhaustive switches
 * rather than one because the two gates are two states.
 *
 * **The draft is not here, and that is the difference from `useSendChat`.** The chat bar's
 * draft moved into its hook because *when to clear it* is a decision only the mutation can
 * make. This one has nothing to clear: the answers gate is left the moment the answers
 * land, so the form unmounts with the card it is in rather than being emptied. What is
 * typed stays where a field's state belongs — in the component — and survives a refusal
 * for the ordinary reason that nothing takes it away. It does **not** survive a step to
 * another gate, which would be one piece's answers in another's fields: `DrawerPane` keys
 * the turns to the position, so the form there is that position's form.
 *
 * **The tuple is the caller's to narrow, and that is deliberate.** `AnswerQuestionsActionDto`
 * declares `answers` non-empty and only the form knows whether every question has one, so
 * the check that produces the non-empty tuple and the check that enables the button are the
 * same check, made once. A hook accepting a plain array would push a `throw` or an
 * assertion to whichever end of the wire noticed second.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { answer } from "../../api/actions"
import { RefusedError } from "../../api/http"
import { refusalSaid } from "../../format/refusal"
import { queryKeys } from "../../queryCache"
import { useScopedTo } from "../../hooks/useScopedTo"

/** The whole of what one send carries: the positional answers, and the note framing them. */
export interface Sent {
  readonly answers: readonly [string, ...string[]]
  /** Absent where the box was left alone. Never blank — the form does not send one. */
  readonly note?: string
}

export interface Answering {
  /**
   * Send them, in the order the questions were asked. Silently does nothing while
   * disabled, whatever the form did.
   */
  readonly send: (sent: Sent) => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last send did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const answerMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (sent: Sent) => Promise<void> = (sent) => answer(id, sent.answers, sent.note),
) => ({
  mutationFn,
  // Both, in one promise the mutation waits on — answering starts a turn, so the detail on
  // this screen and the row behind it both change.
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/**
 * `running` is the detail's `custody.holder !== undefined` — read by the caller rather than
 * fetched here, because this hook must not hold a second opinion about a trak the page
 * already has in hand.
 */
export const useAnswer = (id: string, running: boolean): Answering => {
  const cache = useQueryClient()
  const mutation = useMutation(answerMutationOptions(id, cache))
  useScopedTo(id, mutation.reset)
  const disabled = mutation.isPending || running
  const error = mutation.error ?? undefined

  return {
    send: (sent) => {
      if (disabled) return
      mutation.mutate(sent)
    },
    isPending: mutation.isPending,
    disabled,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : // A status with no explanation, or no answer at all. Deliberately not dressed
            // up as a refusal: the engine did not say this, so the sentence does not
            // pretend it did.
            "Could not send that.",
  }
}
