/**
 * Rebuild a sandboxed trak's sandbox: made again with today's tools, its uncommitted
 * changes carried across. **Spends nothing and takes no `running`**, for `useProcessPress`'s
 * reason: the route claims no custody and appends nothing, and a press made while a turn
 * runs is queued by the engine for the next gap rather than refused — the detail's
 * `rebuild` is what says it is waiting.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { rebuildSandbox } from "../../api/actions"
import { ApiError } from "../../api/http"
import { queryKeys } from "../../queryCache"
import { useScopedTo } from "../../hooks/useScopedTo"

export interface Rebuilding {
  /**
   * Press it, and run `landed` once the engine has taken the press and the detail is
   * fresh — which is when a confirmation shuts, so a refusal is read inside it. Silently
   * does nothing while disabled, whatever the control did.
   */
  readonly rebuild: (landed?: () => void) => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/**
 * Why the press did not land. A 409 is the engine refusing while an earlier remake's
 * changes are still kept, and its reason phrase names the ref — shown, never branched on.
 */
const saidOf = (error: Error | null): string | undefined =>
  error === null
    ? undefined
    : error instanceof ApiError && error.status === 409 && error.statusText !== ""
      ? error.statusText
      : "Could not rebuild the sandbox."

/** Injectable so the decisions here are reachable without React or a network. */
export const rebuildMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: () => Promise<void> = () => rebuildSandbox(id),
) => ({
  mutationFn,
  onSuccess: () => cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
})

/** `owed` is the detail's `rebuild`: a second press while one is owed would ask for nothing. */
export const useRebuildSandbox = (id: string, owed: boolean): Rebuilding => {
  const cache = useQueryClient()
  const mutation = useMutation(rebuildMutationOptions(id, cache))
  useScopedTo(id, mutation.reset)
  const disabled = mutation.isPending || owed

  return {
    rebuild: (landed) => {
      if (disabled) return
      mutation.mutate(undefined, landed === undefined ? {} : { onSuccess: landed })
    },
    isPending: mutation.isPending,
    disabled,
    said: saidOf(mutation.error),
  }
}

/** Both bands' Rebuild at once — the page's trak's and the focused piece's, each its own. */
export const useBandRebuilds = (
  page: { readonly id: string; readonly owed: string | undefined },
  piece: { readonly id: string; readonly owed: string | undefined },
): { readonly page: Rebuilding; readonly piece: Rebuilding } => ({
  page: useRebuildSandbox(page.id, page.owed !== undefined),
  piece: useRebuildSandbox(piece.id, piece.owed !== undefined),
})
