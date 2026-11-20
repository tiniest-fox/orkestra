/**
 * Both bands' endings — the page's trak's in the header, the focused piece's in
 * `PieceBand` — and, on a phone, the question one of their `⋯` menus is asking.
 *
 * The archive route here is the one hook of the page's not given `running`: ending a trak
 * with an agent mid-turn is the point of it, so the route takes the drive over rather than
 * refusing — `useArchiveUnfinished` carries the exception and what still holds around it.
 * The piece's is keyed to the piece, so a press could never reach the parent under the
 * piece's name, and each band's Rebuild to its own trak the same way.
 *
 * **The question is held here, by the page, on a phone.** The sheet that asks it is drawn
 * after the pane: inside its band it would be painted under every later band of the drawer,
 * `FinishedFoot` among them, since each band is a stacking context at the same rung. So the
 * menu shuts as it asks and reports what it asked, and the page draws the rest.
 */

import { useState } from "react"
import type { BandAsk } from "./BandQuestion"
import { type UnfinishedArchive, useArchiveUnfinished } from "./useArchiveUnfinished"
import { type Rebuilding, useBandRebuilds } from "./useRebuildSandbox"

/** Which band asked, and what. */
export interface BandAsked {
  readonly band: "page" | "piece"
  readonly ask: BandAsk
}

export interface BandEndings {
  readonly unfinished: { readonly page: UnfinishedArchive; readonly piece: UnfinishedArchive }
  readonly rebuilds: { readonly page: Rebuilding; readonly piece: Rebuilding }
  /** The question a phone's sheet is asking, or `undefined` while none is. */
  readonly asked: BandAsked | undefined
  /** A phone's: a band's menu reports what it asks. `undefined` at a desk. */
  readonly ask: ((asked: BandAsked) => void) | undefined
  readonly cancel: () => void
}

type Band = { readonly id: string; readonly owed: string | undefined }

export const useBandEndings = (page: Band, piece: Band, phone: boolean): BandEndings => {
  const [asked, setAsked] = useState<BandAsked | undefined>(undefined)
  return {
    unfinished: { page: useArchiveUnfinished(page.id), piece: useArchiveUnfinished(piece.id) },
    rebuilds: useBandRebuilds(page, piece),
    asked: phone ? asked : undefined,
    ask: phone ? setAsked : undefined,
    cancel: () => {
      setAsked(undefined)
    },
  }
}
