/**
 * Commit the parent's checkout under the parent's own name, then merge the child into it.
 * **The second acting hook that spends nothing**, and the press behind both refusals a
 * dirty parent produces: the `Dirty` the Merge press earns before anything starts, and
 * the `Failed{merge}` a merge issued anyway lands in.
 *
 * **Free and still under the whole contract**, for `useMerge`'s reason: the route claims
 * custody exactly as `/act` does, so a second press races a `git commit` and a `git merge`
 * already under way. Non-submittable while in flight, disabled while `custody.holder` is
 * set, a callback that refuses when disabled, `onSuccess` returning the invalidation, and
 * nothing auto-firing.
 *
 * **Its own hook rather than a flag on `useMerge`.** They are two routes with two
 * meanings — one puts the work in, the other commits somebody's edits first — and one
 * press on a plate acting on one `said` is the whole of what a refusal here is worth.
 *
 * **When it lands, the Merge press forgets its refusal.** The files the pre-check named
 * are `useMerge`'s and would otherwise outlive this press on both of its exits: over a
 * merged trak the state gate hides them, but over a merge git *still declines* the trak is
 * back at `Failed{merge}` — a state the Merge press is offered at — and the plate would
 * read *there is uncommitted work there* about a checkout this press just committed, with
 * git's newer words under it hidden. `onLanded` is that reset, run as the route accepts
 * the press, before the drive it started can answer either way.
 *
 * **Declined, not conflicted.** `MergeWork` sorts a non-zero merge by whether the index has
 * unmerged paths: those are `Conflicted`, which aborts the merge and recomposes rather than
 * failing. So the second exit this plate can draw is always git refusing to *start* — a
 * checkout that has wandered off its branch, or one dirtied again since the commit.
 *
 * **Offered only where the preview names a parent.** The route answers `400` for a trak
 * with no parent, and nothing in the client draws the press there: a person's own working
 * directory keeps its refusal at the Merge press, which `format/refusal.ts` words.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { commitAndMergeTrak } from "../../../../api/actions"
import { RefusedError } from "../../../../api/http"
import { refusalSaid } from "../../../../format/refusal"
import { queryKeys } from "../../../../queryCache"
import { useScopedTo } from "../../../../hooks/useScopedTo"

export interface CommitAndMerge {
  /** Commit the parent and merge. Silently does nothing while disabled, whatever the control did. */
  readonly commit: () => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const commitAndMergeMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  /** `useMerge`'s `forget` — the pre-check's memory this press makes stale. */
  onLanded: () => void,
  mutationFn: () => Promise<void> = () => commitAndMergeTrak(id),
) => ({
  mutationFn,
  // The forget first, so no frame draws the old files over the refetched trak. Both keys,
  // for `useMerge`'s reason: the ending changes the detail on this screen and the row in
  // the list behind it.
  onSuccess: () => {
    onLanded()
    return Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ])
  },
})

/**
 * `running` is the detail's `custody.holder !== undefined` — read by the caller, so this
 * hook holds no second opinion about a trak the page already has in hand. `onLanded` is
 * the Merge press's `forget`, handed in by `useFinishing`, which holds both.
 */
export const useCommitAndMerge = (
  id: string,
  running: boolean,
  onLanded: () => void,
): CommitAndMerge => {
  const cache = useQueryClient()
  const mutation = useMutation(commitAndMergeMutationOptions(id, cache, onLanded))
  useScopedTo(id, mutation.reset)
  const disabled = mutation.isPending || running
  const error = mutation.error ?? undefined

  return {
    commit: () => {
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
          : "Could not commit and merge that.",
  }
}
