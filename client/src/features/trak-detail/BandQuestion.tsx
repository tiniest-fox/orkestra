/**
 * The question one band's `⋯` asks before it acts: Archive, at whichever route is on offer,
 * or Rebuild. Drawn in the menu's popover at a desk by `TrakControls`, and on a phone as a
 * `ConfirmSheet` by the page, after the pane — a sheet mounted inside the band would be
 * painted under every later band of the drawer, `FinishedFoot` among them.
 *
 * The words live here rather than in the components: a confirmation is a primitive, and
 * *what will happen if you press this* is the caller's to say.
 */

import type { ReactNode } from "react"
import ConfirmSheet from "../../components/ConfirmSheet"
import Confirmation from "../../components/Confirmation"
import type { UnfinishedArchive } from "./useArchiveUnfinished"
import type { Archiving } from "./useArchive"
import type { Rebuilding } from "./useRebuildSandbox"

/** Which route the archive takes here. `controls.ts` decides. */
export interface Offers {
  readonly abandon: boolean
  readonly close: boolean
}

/** The one item, at whichever route is on offer — its words and the press behind them. */
interface Ending {
  readonly body: string
  readonly act: () => void
  readonly busy: boolean
  readonly disabled: boolean
  readonly said: string | undefined
}

/**
 * The close route wins where both are true, which is nowhere — `archiveOffered` is
 * `Finished` alone and `archiveUnfinishedOffered` is every state that is not at rest.
 * Written as an order anyway, because a `?:` that reads as a preference is honest about
 * what happens if one of them widens.
 */
export const endingOf = (
  offers: Offers,
  unfinished: UnfinishedArchive,
  archiving: Archiving,
): Ending | undefined => {
  if (offers.close)
    return {
      body: "The checkout goes, and so does the branch — here and on GitHub.",
      act: archiving.archive,
      busy: archiving.isPending,
      disabled: archiving.disabled,
      said: archiving.said,
    }
  if (offers.abandon)
    return {
      body: "The agent mid-turn is interrupted, and the trak is put away: the checkout goes, and so does the branch — here and on GitHub.",
      act: unfinished.archive,
      busy: unfinished.isPending,
      disabled: unfinished.disabled,
      said: unfinished.said,
    }
  return undefined
}

/** A sandboxed trak's Rebuild: where one owed stands, and the press. */
export interface RebuildOffer {
  readonly owed: "waiting" | "rebuilding" | undefined
  readonly press: Rebuilding
}

/** Which of the two the band is asking. */
export type BandAsk = "archive" | "rebuild"

/** What a band's menu acts on — the same for its items and for the question they ask. */
export interface BandOffer {
  readonly offers: Offers
  readonly unfinished: UnfinishedArchive
  readonly archiving: Archiving
  /** Only for a trak whose checkout is in a sandbox. */
  readonly rebuild: RebuildOffer | undefined
  /** Open the report pane — only where the host has a report destination. */
  readonly report: (() => void) | undefined
}

const BandQuestion = ({
  ask,
  offer,
  sheet,
  onCancel,
}: {
  readonly ask: BandAsk
  readonly offer: BandOffer
  /** A phone's sheet, rather than the panel in the popover. */
  readonly sheet: boolean
  readonly onCancel: () => void
}): ReactNode => {
  const Ask = sheet ? ConfirmSheet : Confirmation
  const { rebuild } = offer
  if (ask === "rebuild")
    return rebuild === undefined ? undefined : (
      <Ask
        heading="Rebuild this trak's sandbox?"
        press="Rebuild"
        busy={rebuild.press.isPending}
        disabled={rebuild.press.disabled}
        said={rebuild.press.said}
        onCancel={onCancel}
        // Shut only once the press has landed: a refusal stays inside the confirmation,
        // as the archive's does, rather than behind an item that reads as if nothing
        // was pressed.
        onConfirm={() => {
          rebuild.press.rebuild(onCancel)
        }}
      >
        The sandbox is made again with today&apos;s tools and set up. Uncommitted changes are
        carried across; files git ignores are not, and running processes stop. A turn running now
        finishes first.
      </Ask>
    )
  const ending = endingOf(offer.offers, offer.unfinished, offer.archiving)
  return ending === undefined ? undefined : (
    <Ask
      heading="Archive this trak?"
      press="Archive"
      busy={ending.busy}
      disabled={ending.disabled}
      said={ending.said}
      onCancel={onCancel}
      onConfirm={ending.act}
    >
      {ending.body}
    </Ask>
  )
}

export default BandQuestion
