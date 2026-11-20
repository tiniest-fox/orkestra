/**
 * Store which terminal or editor a press on an opener control opens. **Spends
 * nothing, starts no drive and claims no custody**: one file on the engine's machine,
 * shared by every project that engine is pointed at.
 *
 * **Not scoped to a trak, and the only acting hook here that is not**: the pick is the
 * machine's, so its pending state and its refusal sentence stay true whichever trak the
 * drawer moves to — `useScopedTo` would drop a sentence that still applies.
 *
 * The two pending-guard halves still hold — disabled while its own mutation is in
 * flight, and a callback that refuses when disabled — for `useSetMode`'s reason: the
 * shape of an acting hook, not what this one's second press would cost.
 *
 * The one failure a working UI can earn is a 400 for an identifier the scan no longer
 * returns — an app uninstalled between fetch and pick. No refusal body comes with it,
 * so the sentence is this hook's own, and it names the kind because two of these are
 * on screen at once.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { chooseOpener } from "../api/openers"
import type { OpenerKindDto } from "../api/types"
import { queryKeys } from "../queryCache"

export interface OpenerChoosing {
  /** Store the pick. Silently does nothing while disabled, whatever the control did. */
  readonly choose: (id: string) => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

const SAID: Readonly<Record<OpenerKindDto, string>> = {
  terminal: "Could not set the terminal.",
  editor: "Could not set the editor.",
}

/** Injectable so the decisions here are reachable without React or a network. */
export const chooseOpenerMutationOptions = (
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  kind: OpenerKindDto,
  mutationFn: (kind: OpenerKindDto, id: string) => Promise<void> = chooseOpener,
) => ({
  mutationFn: (id: string) => mutationFn(kind, id),
  // The listing carries `chosen`, so the pick is not on screen until it re-answers —
  // and returning the promise keeps the rows disabled across that refetch. One key for
  // both kinds, so a pick of either re-asks the whole listing.
  onSuccess: () => cache.invalidateQueries({ queryKey: queryKeys.openers }),
})

export const useChooseOpener = (kind: OpenerKindDto): OpenerChoosing => {
  const cache = useQueryClient()
  const mutation = useMutation(chooseOpenerMutationOptions(cache, kind))
  const error = mutation.error ?? undefined

  return {
    choose: (id) => {
      if (mutation.isPending) return
      mutation.mutate(id)
    },
    isPending: mutation.isPending,
    disabled: mutation.isPending,
    said: error === undefined ? undefined : SAID[kind],
  }
}
