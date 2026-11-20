/**
 * A finished row's *Archive*, which asks right here rather than opening the drawer.
 *
 * **The one press on this list that acts.** Every other word `rowAction` gives is a link
 * into the trak, because what it names needs the drawer's context to do. Archive does
 * not: the drawer's own confirmation is one sentence and two presses, and nothing else
 * on the pane bears on it — so it opens the same `Confirmation`, with the same line
 * (`archiveScope`), against the same `useArchive`. It spends nothing.
 *
 * **The panel is drawn on `document.body`, not inside the row.** A row is drawn by
 * three screens — the list, the ⌘K palette and the goal screen — and the goal screen's
 * groups are `overflow-hidden` for their rounded corners. A panel floated out of the row
 * was clipped there, and the focus `Confirmation` takes on its press scrolled the group
 * until the row itself was out of sight. Outside the row's ancestors, no container can
 * clip it or be scrolled by it, on any screen that draws a row now or later.
 *
 * **It is anchored to the press as the press stood when it was pressed**, on a layer over
 * the whole window at `z-40`, as every overlay is — `TileMenu`'s shape. The layer is what
 * keeps that measurement true: nothing under it can be scrolled while the panel is open,
 * and a press on it shuts the panel. The panel opens below the press, or above it where
 * the window has more room above, so the whole panel is in view beside the row.
 *
 * **React carries a portal's events up the component tree, not the DOM**, so a click or
 * key in the panel still reaches the row's ancestors. Clicks stop at the press's own
 * span, because the palette's list shuts on any click inside it, the press's included;
 * keys stop at the layer, because the palette's dialog shuts on Escape.
 */

import type { KeyboardEvent, MouseEvent, ReactNode } from "react"
import { useRef, useState } from "react"
import { createPortal } from "react-dom"
import Button from "../../components/Button"
import Confirmation from "../../components/Confirmation"
import type { TrakSummaryDto } from "../../api/types"
import { archiveScope } from "../trak-detail/finished/finished"
import { useArchive } from "../trak-detail/useArchive"

/** The gap between the press and the panel, in pixels — the drawer's `mb-1.5`. */
const GAP = 6

/** Where the panel stands, in the window's coordinates: its right edge on the press's,
 *  and its top below the press or its bottom above it. */
type Anchor =
  | { readonly right: number; readonly top: number }
  | { readonly right: number; readonly bottom: number }

/** The side with more room wins, so the panel is not cut by the window's edge. */
const anchorTo = (press: DOMRect): Anchor => {
  const right = window.innerWidth - press.right
  return window.innerHeight - press.bottom >= press.top
    ? { right, top: press.bottom + GAP }
    : { right, bottom: window.innerHeight - press.top + GAP }
}

const RowArchive = ({
  trak,
  name,
  merged,
}: {
  readonly trak: TrakSummaryDto
  /** What the row is called, for the press's accessible name. */
  readonly name: string
  /** The forge says the branch is in — the row's rung is the merged one. `undefined`
   *  where the row's screen does not ask the forge, which `archiveScope` words for. */
  readonly merged: boolean | undefined
}): ReactNode => {
  const archiving = useArchive(trak.id, trak.running)
  const [anchor, setAnchor] = useState<Anchor | undefined>(undefined)
  const press = useRef<HTMLSpanElement>(null)
  const shut = (): void => {
    setAnchor(undefined)
  }

  return (
    <span
      ref={press}
      className="flex"
      onClick={(event) => {
        event.stopPropagation()
      }}
    >
      <Button
        variant="primary"
        size="sm"
        aria-label={`Archive — ${name}`}
        onClick={() => {
          const box = press.current?.getBoundingClientRect()
          if (box !== undefined) setAnchor(anchorTo(box))
        }}
      >
        Archive
      </Button>
      {anchor !== undefined &&
        createPortal(
          <div
            className="fixed inset-0 z-40"
            onClick={(event: MouseEvent<HTMLDivElement>) => {
              if (event.target === event.currentTarget) shut()
            }}
            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
              event.stopPropagation()
              if (event.key === "Escape") shut()
            }}
          >
            {/* A dialog by role, and Escape on the container — `ArchiveActs` in the drawer
                says why both. */}
            <div
              role="dialog"
              aria-label="Archive this trak?"
              className="absolute w-fit rounded-surface border border-border bg-surface shadow-modal"
              style={anchor}
            >
              <Confirmation
                heading="Archive this trak?"
                press="Archive"
                busy={archiving.isPending}
                disabled={archiving.disabled}
                said={archiving.said}
                onCancel={shut}
                onConfirm={archiving.archive}
              >
                {archiveScope(merged, trak.branchMoved, false)}
              </Confirmation>
            </div>
          </div>,
          document.body,
        )}
    </span>
  )
}

export default RowArchive
