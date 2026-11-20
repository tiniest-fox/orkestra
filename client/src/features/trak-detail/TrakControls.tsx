/**
 * The menu one band carries: archive the trak that band speaks for, or rebuild its sandbox.
 *
 * **Drawn in two bands, for two traks, and that parallel is the rule.** The header's copy
 * speaks for the trak the page is of at every position; standing on a spawn's piece,
 * `PieceBand` carries a second copy speaking for the piece — so the ending a reader means
 * lands on the trak whose name is on the row they pressed. A press belongs in a band only
 * where its subject is that band's trak: picking a stopped trak back up is about the trak
 * that *stopped*, which at a spawn is a piece neither copy's row would pin down — so it is
 * drawn at the position that piece stopped on, by `TrakFailure`, with a sentence saying
 * what happened beside it.
 *
 * **One word, one item, two routes.** The menu offers Archive, and which route carries it
 * comes from `controls.ts` and from nowhere here: the abandon route while the trak is
 * still going, the close route at `Finished`, and nothing at all once the trak is at
 * rest. A spawn's piece is offered the same two — archiving one lands it on its parent
 * as a drop, so the spawn stops waiting on it. The two stay two mutations with two
 * refusal sets — `useArchive` and `useArchiveUnfinished` — and `endingOf` only picks
 * between them; what differs on screen is the body, which says whether an agent mid-turn
 * is interrupted on the way. The
 * deletion it describes is the same in both: the checkout, the branch and the branch's
 * copy on GitHub, whatever is on them, with this confirmation as the only guard.
 *
 * **A sandboxed trak's menu carries Rebuild as well**, above the archive: the sandbox made
 * again with today's tools, its uncommitted changes carried. It is here rather than among
 * the openers because it acts on the engine's sandbox, so a phone has it too. While one is
 * owed the item says what it waits on and cannot be pressed again — the engine queues a
 * press made under a running turn, and the detail's `rebuild` is what reports it.
 *
 * **The question is `BandQuestion`'s.** At a desk it replaces the items in the popover. On a
 * phone the page hands `onAsk`: the item shuts the popover and reports what it asks, and the
 * page draws the sheet after the pane, where no later band can paint over it.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import MenuItem from "../../components/MenuItem"
import OverflowMenu from "../../components/OverflowMenu"
import BandQuestion, {
  type BandAsk,
  type BandOffer,
  type RebuildOffer,
  endingOf,
} from "./BandQuestion"

/** The Rebuild item's words: the press, or the one owed and what it waits on. */
const rebuildSaid = (owed: RebuildOffer["owed"]): string =>
  owed === "waiting"
    ? "Rebuild waits for the running work to end"
    : owed === "rebuilding"
      ? "Rebuilding the sandbox…"
      : "Rebuild sandbox"

const TrakControls = ({
  offer,
  onAsk,
}: {
  readonly offer: BandOffer
  /** A phone's: the page asks, in a sheet. `undefined` asks in the popover. */
  readonly onAsk: ((ask: BandAsk) => void) | undefined
}): ReactNode => {
  // Which confirmation is showing in place of the items, at a desk. Held here rather than in
  // the panel, which unmounts its body while it is shut — `onDismiss` is what puts it back at
  // the items, so a menu reopened after a cancel is not a confirmation nobody asked for again.
  const [asking, setAsking] = useState<BandAsk | undefined>(undefined)
  const { rebuild } = offer
  const ending = endingOf(offer.offers, offer.unfinished, offer.archiving)

  if (ending === undefined && rebuild === undefined) return undefined

  const cancel = (): void => {
    setAsking(undefined)
  }

  return (
    <OverflowMenu label="More options" onDismiss={cancel}>
      {(shut) => {
        const ask = (what: BandAsk): void => {
          if (onAsk === undefined) {
            setAsking(what)
            return
          }
          shut()
          onAsk(what)
        }
        return asking === undefined ? (
          <>
            {rebuild !== undefined && (
              <MenuItem
                disabled={rebuild.owed !== undefined}
                onClick={() => {
                  ask("rebuild")
                }}
              >
                {rebuildSaid(rebuild.owed)}
              </MenuItem>
            )}
            {ending !== undefined && (
              <MenuItem
                onClick={() => {
                  ask("archive")
                }}
              >
                Archive this trak
              </MenuItem>
            )}
          </>
        ) : (
          <BandQuestion ask={asking} offer={offer} sheet={false} onCancel={cancel} />
        )
      }}
    </OverflowMenu>
  )
}

export default TrakControls
