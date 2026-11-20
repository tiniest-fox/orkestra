/**
 * A person's press on a goal: approve the drafted file, answer an escalation, report on work asked
 * of them by hand, confirm done, say something to the composer, or retry a turn the provider lost. **Spends money** for every
 * action but `Confirm` — each owes the composer a turn, which runs at once unless the goal
 * is paused.
 *
 * `client-style`'s contract for an acting hook: disabled while in flight and while a
 * composer turn runs, a callback that refuses when disabled, both keys invalidated in the
 * promise the mutation waits on, nothing fired from an effect, and a refusal handed back
 * as a sentence. **`say` is the one press a running turn does not disable**, for
 * `useSendChat`'s reason: the engine keeps what is said then, and the running composer
 * reads it — so it refuses only while a press is in flight. Which presses a goal offers is `GoalDto.offers`, the engine's own list —
 * a control draws only where its action is in it.
 *
 * Scoped to the goal by its caller, which keys the screen on the id.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { actOnGoal } from "../../api/goals"
import { RefusedError } from "../../api/http"
import type { GoalActionDto, RefusalDto } from "../../api/types"
import { refusalSaid } from "../../format/refusal"
import { queryKeys } from "../../queryCache"
import { type Attachments, useAttachments } from "../../hooks/useAttachments"

export interface GoalAct {
  /** Press it; `sent` runs once the engine has taken it. Does nothing while disabled. */
  readonly act: (action: GoalActionDto, sent?: () => void) => void
  /**
   * Say `message` to the composer, with the files `attached` holds, running or not; `sent`
   * runs once the engine has it. Refuses while a file is still uploading.
   */
  readonly say: (message: string, sent?: () => void) => void
  /** The files attached to the chat bar's draft, emptied once a `say` lands. */
  readonly attached: Attachments
  readonly isPending: boolean
  readonly disabled: boolean
  readonly said: string | undefined
  /** Which refusal the last press earned, where a surface draws more than `said` for it. */
  readonly refused: RefusalDto["_tag"] | undefined
}

/** One press: the action, and the upload ids a `Chat` carries — none for the rest. */
interface GoalPress {
  readonly action: GoalActionDto
  readonly attachments: readonly string[]
}

/** Injectable so the invalidation is reachable without React or a network. */
export const goalActMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (press: GoalPress) => Promise<void> = ({ action, attachments }) =>
    actOnGoal(id, action, attachments),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.goal(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.goals }),
    ]),
})

/** `running` is `GoalDto.running`, read by the caller off the goal it already holds. */
export const useGoalAct = (id: string, running: boolean): GoalAct => {
  const cache = useQueryClient()
  const mutation = useMutation(goalActMutationOptions(id, cache))
  const attached = useAttachments(id)
  const disabled = mutation.isPending || running
  const error = mutation.error ?? undefined
  return {
    act: (action, sent) => {
      if (disabled) return
      mutation.mutate({ action, attachments: [] }, { onSuccess: sent })
    },
    say: (message, sent) => {
      if (mutation.isPending || attached.uploading) return
      mutation.mutate(
        { action: { _tag: "Chat", message }, attachments: attached.ids },
        {
          onSuccess: () => {
            attached.clear()
            sent?.()
          },
        },
      )
    },
    isPending: mutation.isPending,
    disabled,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : "Could not send that.",
    refused: error instanceof RefusedError ? error.refusal._tag : undefined,
    attached,
  }
}
