/**
 * Archive a finished trak: the checkout goes, and so do the branch, its recorded base
 * ref and the branch's copy on GitHub. **The sixth acting hook, and the second that
 * spends nothing.**
 *
 * The same contract and the same reasoning as `useMerge` — free, still under every rule,
 * because the route claims custody and a second press races a `git worktree remove`. What
 * separates the two is what they mean rather than what they cost: archiving puts the trak
 * away, and the confirmation on the press is the only thing between a person and a
 * deletion that reaches GitHub.
 *
 * **One refusal beyond custody: `409 NotFinished`.** `closeRoute` — the wire's older name
 * for the archive — replays the log and checks the state itself, so a client that has
 * fallen behind is refused rather than landing an event `decide` would settle as
 * `Failed{engine}`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { archiveTrak } from "../../api/actions"
import { RefusedError } from "../../api/http"
import { refusalSaid } from "../../format/refusal"
import { queryKeys } from "../../queryCache"
import { useScopedTo } from "../../hooks/useScopedTo"

export interface Archiving {
  /** Archive it. Silently does nothing while disabled, whatever the control did. */
  readonly archive: () => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const archiveMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: () => Promise<void> = () => archiveTrak(id),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/** `running` is the detail's `custody.holder !== undefined`, for `useApprove`'s reason. */
export const useArchive = (id: string, running: boolean): Archiving => {
  const cache = useQueryClient()
  const mutation = useMutation(archiveMutationOptions(id, cache))
  useScopedTo(id, mutation.reset)
  const disabled = mutation.isPending || running
  const error = mutation.error ?? undefined

  return {
    archive: () => {
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
          : "Could not archive that.",
  }
}
