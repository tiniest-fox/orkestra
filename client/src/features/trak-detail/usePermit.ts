/**
 * Answer a step's request to run one command the CLI refused: a yes or a no. **Spends
 * money** — either resumes the step's session.
 *
 * Under `useAnswer`'s contract, and for its reasons: non-submittable while in flight,
 * disabled while `custody.holder` is set, the callback refusing when disabled, `onSuccess`
 * returning the invalidation, nothing auto-firing, and the mutation scoped to the trak id.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { permit } from "../../api/actions"
import { RefusedError } from "../../api/http"
import { refusalSaid } from "../../format/refusal"
import { queryKeys } from "../../queryCache"
import { useScopedTo } from "../../hooks/useScopedTo"

export interface Permitting {
  /** Allow the command, or refuse it. Silently does nothing while disabled. */
  readonly send: (granted: boolean) => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** `running` is the detail's `custody.holder !== undefined`, read by the caller. */
export const usePermit = (id: string, running: boolean): Permitting => {
  const cache = useQueryClient()
  const mutation = useMutation({
    mutationFn: (granted: boolean) => permit(id, granted),
    onSuccess: () =>
      Promise.all([
        cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
        cache.invalidateQueries({ queryKey: queryKeys.traks }),
      ]),
  })
  useScopedTo(id, mutation.reset)
  const disabled = mutation.isPending || running
  const error = mutation.error ?? undefined
  return {
    send: (granted) => {
      if (disabled) return
      mutation.mutate(granted)
    },
    isPending: mutation.isPending,
    disabled,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : "Could not send that.",
  }
}
