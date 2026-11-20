/**
 * Open the chosen terminal or editor at the project checkout — the repository the engine
 * drives, which the git bar acts on too. `useOpenCheckout`'s contract, with no trak:
 * spends nothing, starts no drive, claims no custody, and invalidates nothing.
 *
 * **Not scoped to an id**, because there is none: the project is the same on every
 * screen, so a refusal stays until the next press rather than being dropped on a move.
 */

import { useMutation } from "@tanstack/react-query"
import { openProject } from "../api/openers"
import type { OpenerKindDto } from "../api/types"

/** What an opener control's open press needs, whichever checkout it opens. */
export interface CheckoutOpening {
  /** Open it. Silently does nothing while disabled, whatever the control did. */
  readonly open: () => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

const SAID: Readonly<Record<OpenerKindDto, string>> = {
  terminal: "Could not open a terminal here.",
  editor: "Could not open an editor here.",
}

export const useOpenProjectCheckout = (kind: OpenerKindDto): CheckoutOpening => {
  const mutation = useMutation({ mutationFn: () => openProject(kind) })
  const error = mutation.error ?? undefined

  return {
    open: () => {
      if (mutation.isPending) return
      mutation.mutate()
    },
    isPending: mutation.isPending,
    disabled: mutation.isPending,
    said: error === undefined ? undefined : SAID[kind],
  }
}
