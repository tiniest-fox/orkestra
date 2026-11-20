/**
 * Put a finished trak's branch into the one the host is standing on. **The fifth acting
 * hook, and the first that spends nothing.**
 *
 * **Free and still under the whole contract**, which is the thing worth saying here. No
 * agent runs — `Events.merged()` is a `git merge` and a log line — but the route claims
 * custody exactly as `/act` does, so a second press races a merge already under way and
 * earns `409 Driving`. `client-style`'s rules for an acting hook are about *a second
 * drive*, not about money: non-submittable while in flight, disabled while
 * `custody.holder` is set, a callback that refuses when disabled, `onSuccess` returning
 * the invalidation, and nothing auto-firing.
 *
 * **Its own hook rather than a `useFinish(kind)`.** Merging, closing and asking for changes
 * are three routes with three refusal vocabularies and three sets of states that offer
 * them; one hook behind a discriminator would put all three behind one `said`, and the
 * sentence a person reads is the whole value of a refusal. `useApprove` is one hook for two
 * gates because `Approve` is one action — this is the opposite case.
 *
 * **`Dirty` is the refusal this one exists to render.** It is only knowable after the
 * press — `MergePreviewDto` says nothing about the tree the merge would go into — so a
 * person who has uncommitted work in the checkout `serve` is running in presses, is told,
 * commits, and presses again with everything the position said still on screen and still
 * true. A child's is the parent's checkout instead, and there the files land on the plate
 * `FinishedView` draws above the card, with `useCommitAndMerge`'s press through them.
 *
 * **The same press from a merge git already refused.** `mergeRoute` takes `Failed{merge}`
 * and re-issues the merge, so the card's press is the way to run it again; nothing here
 * has to know which of the two states it was pressed at.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { mergeTrak } from "../../../../api/actions"
import { RefusedError } from "../../../../api/http"
import { refusalSaid } from "../../../../format/refusal"
import { queryKeys } from "../../../../queryCache"
import { useScopedTo } from "../../../../hooks/useScopedTo"

export interface Merge {
  /** Merge it. Silently does nothing while disabled, whatever the control did. */
  readonly merge: () => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
  /** The files a `Dirty` refusal named, so the sentence can be acted on rather than read. */
  readonly files: readonly string[]
  /** Drop the last refusal. For the press that answers it — `useCommitAndMerge` — so
   *  what the pre-check remembered never stands over a merge it re-issued. */
  readonly forget: () => void
}

/** Injectable so the decisions here are reachable without React or a network. */
export const mergeMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: () => Promise<void> = () => mergeTrak(id),
) => ({
  mutationFn,
  // Both, for `useApprove`'s reason: the ending changes the detail on this screen and the
  // row in the list behind it — `TrakSummaryDto` carries `state` and `running`.
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
export const useMerge = (id: string, running: boolean): Merge => {
  const cache = useQueryClient()
  const mutation = useMutation(mergeMutationOptions(id, cache))
  useScopedTo(id, mutation.reset)
  const disabled = mutation.isPending || running
  const error = mutation.error ?? undefined
  const refusal = error instanceof RefusedError ? error.refusal : undefined

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
        : refusal === undefined
          ? // A status with no explanation, or no answer at all. Deliberately not dressed
            // up as a refusal: the engine did not say this, so the sentence does not
            // pretend it did.
            "Could not merge that."
          : refusalSaid(refusal),
    // `format/refusal` deliberately does not name them — how many of them fit is a
    // question about the surface drawing it, so the list comes through untouched.
    files: refusal?._tag === "Dirty" ? refusal.files : [],
    forget: mutation.reset,
  }
}
