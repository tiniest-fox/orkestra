/**
 * Merge a finished trak's pull request on the forge, by the method picked on the trak or the
 * repository's default.
 * **Spends nothing** — a `gh` read and a `gh pr merge`, no agent.
 *
 * **It takes no `running`, because the route takes no drive.** Nothing runs on the trak and
 * no custody is claimed, so no drive under way refuses it; the forge refusing a second merge
 * is what a race with the auto-merge sweep comes to. The other two guards hold: disabled
 * while its own press is in flight, and a callback that refuses when disabled — which here
 * includes a pull request GitHub's verdict does not give as `Mergeable`.
 *
 * **It invalidates the pull request as well as the trak**, and is the one press that does:
 * the forge's next answer is the only record of the merge, and until it arrives the pane
 * still reads `open` and the band still draws this press over work that has gone in.
 * Returned, so `isPending` covers the refetch and the press reads *Merging…* until the
 * band turns to Archive.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { mergePullRequest } from "../../../../api/actions"
import { RefusedError } from "../../../../api/http"
import { refusalSaid } from "../../../../format/refusal"
import { queryKeys } from "../../../../queryCache"
import { useScopedTo } from "../../../../hooks/useScopedTo"

export interface PullMerging {
  /** Merge it. Silently does nothing while disabled, whatever the control did. */
  readonly merge: () => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const mergePullRequestMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: () => Promise<void> = () => mergePullRequest(id),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
      cache.invalidateQueries({ queryKey: queryKeys.pullRequest(id) }),
    ]),
})

/** `ready` is GitHub's verdict on the pane's own answer being `Mergeable`, read by the caller. */
export const useMergePullRequest = (id: string, ready: boolean): PullMerging => {
  const cache = useQueryClient()
  const mutation = useMutation(mergePullRequestMutationOptions(id, cache))
  useScopedTo(id, mutation.reset)
  const disabled = mutation.isPending || !ready
  const error = mutation.error ?? undefined

  return {
    merge: () => {
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
          : // No answer the engine wrote, so the sentence does not pretend it did.
            "Could not merge the pull request.",
  }
}
