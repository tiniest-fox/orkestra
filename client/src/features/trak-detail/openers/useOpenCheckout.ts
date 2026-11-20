/**
 * Open the chosen terminal or editor at this trak's checkout. **Spends nothing, starts
 * no drive and claims no custody**: one `open` process on the engine's machine, which
 * is where the window appears. Nothing on the wire moves, so success invalidates
 * nothing — the outcome is a window, and this client can never see it.
 *
 * **No `running` argument, for `useSetMode`'s reason**: there is no drive for the guard
 * to prevent, and a shell or an editor at the checkout is as useful while an agent
 * works as after. The two pending-guard halves still hold.
 *
 * **Dropped when `id` changes**, `useScopedTo`: the route param moves without the page
 * unmounting — and the piece band's copy is keyed to the position's owner, so stepping
 * between pieces moves it too. A refusal one trak's gone checkout earned must not follow
 * the reader to the next.
 *
 * The one failure a working UI can earn is the 404 for a checkout an archive deleted
 * between poll and press — the wire keeps naming it, so the control cannot always be
 * withheld in time. No refusal body comes with it; the sentence is this hook's own, and
 * it names the kind because both kinds are on screen at once.
 */

import { useMutation } from "@tanstack/react-query"
import { openCheckout } from "../../../api/openers"
import type { OpenerKindDto } from "../../../api/types"
import type { CheckoutOpening } from "../../../hooks/useOpenProjectCheckout"
import { useScopedTo } from "../../../hooks/useScopedTo"

const SAID: Readonly<Record<OpenerKindDto, string>> = {
  terminal: "Could not open a terminal here.",
  editor: "Could not open an editor here.",
}

/** Takes no `running`, deliberately — see above. */
export const useOpenCheckout = (id: string, kind: OpenerKindDto): CheckoutOpening => {
  // No options factory: there is no invalidation to decide, so the options are the one
  // line below and a factory would be testing a wrapper around nothing.
  const mutation = useMutation({ mutationFn: () => openCheckout(id, kind) })
  useScopedTo(id, mutation.reset)
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
