/**
 * The three handles each opener control needs, for the two bands that draw one — the
 * header's pair opening the page's trak's checkout, and the piece band's pair opening
 * the focused piece's. One control consumes all three handles, so a caller holding them
 * separately would be three chances to key one differently; both kinds and both bands
 * from one call, because everything but the open press is shared.
 *
 * **The listing and the pick are the machine's; only the open press is a trak's.** One
 * query answers what the engine's machine has, and one mutation per kind stores which
 * app a press opens — calling `useChooseOpener` once per band would be two mutations
 * writing one setting, with two pending states and two refusal sentences for one fact.
 * The top bar's pair is the exception, with its own `useChooseOpener` per kind: an open
 * drawer covers the bar's right end, so the two are never pressable side by side.
 * `useOpenCheckout` is the split's other side: a window opens at one trak's checkout,
 * so the press is keyed per band, and a piece's press reaches the piece's worktree
 * rather than its parent's.
 *
 * `phone` reaches the query as its gate — below the breakpoint no opener control is
 * drawn, and the route behind the listing runs a scan per request, so a phone must not
 * ask. Away from a piece, `piece` is `id` itself and the two bundles agree; only the
 * header's is on screen then, so the duplicate open press is never drawn.
 */

import type { OpenerKindDto, OpenerListDto } from "../../../api/types"
import { type OpenerChoosing, useChooseOpener } from "../../../hooks/useChooseOpener"
import { type OpenersListing, useOpenerListing } from "../../../hooks/useOpenerListing"
import type { CheckoutOpening } from "../../../hooks/useOpenProjectCheckout"
import { useOpenCheckout } from "./useOpenCheckout"

export interface OpenerHandles {
  /** This kind's half of what the engine's machine has, `"unsupported"` off macOS, `undefined` unanswered. */
  readonly listing: OpenerListDto | "unsupported" | undefined
  readonly choosing: OpenerChoosing
  readonly opening: CheckoutOpening
}

/** One band's controls: each kind's handles, with the open press keyed to that band's trak. */
export type OpenerBand = Readonly<Record<OpenerKindDto, OpenerHandles>>

const handlesOf = (
  kind: OpenerKindDto,
  listing: OpenersListing | undefined,
  choosing: OpenerChoosing,
  opening: CheckoutOpening,
): OpenerHandles => ({
  listing: listing === undefined || listing === "unsupported" ? listing : listing[kind],
  choosing,
  opening,
})

export const useOpeners = (
  id: string,
  /** The trak that owns the position — a piece of a spawn, or `id` itself away from one. */
  piece: string,
  phone: boolean,
): { readonly header: OpenerBand; readonly piece: OpenerBand } => {
  const listing = useOpenerListing(!phone).data
  const terminal = useChooseOpener("terminal")
  const editor = useChooseOpener("editor")
  return {
    header: {
      terminal: handlesOf("terminal", listing, terminal, useOpenCheckout(id, "terminal")),
      editor: handlesOf("editor", listing, editor, useOpenCheckout(id, "editor")),
    },
    piece: {
      terminal: handlesOf("terminal", listing, terminal, useOpenCheckout(piece, "terminal")),
      editor: handlesOf("editor", listing, editor, useOpenCheckout(piece, "editor")),
    },
  }
}
