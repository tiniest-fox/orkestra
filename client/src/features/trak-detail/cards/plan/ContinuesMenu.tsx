/**
 * Which conversation a proposed step picks up, as a readout that opens: the key it
 * continues, or *new session*.
 *
 * **The run-mode picker's control, not a new one** — `OverflowMenu` with a face, and
 * rows in `ModeRow`'s shape: the name, a quiet phrase, a check on the chosen row. The
 * app's own affordance rather than a bare select.
 *
 * The keys drawn are the ones the person is reading on the card — as proposed, with a
 * swapped step's new agent in its name — and the key picked is the one the composer wrote;
 * the engine re-points them if a removal renumbers the plan or a swap renames a step.
 */

import type { ReactNode } from "react"
import { Check, CornerDownRight, MessageSquarePlus } from "lucide-react"
import MenuItem from "../../../../components/MenuItem"
import OverflowMenu from "../../../../components/OverflowMenu"
import type { Continuable } from "./planEdits"

/** What a step that continues nothing reads — the person's word, over *fresh*. */
const NEW_SESSION = "new session"

const Row = ({
  chosen,
  name,
  phrase,
}: {
  readonly chosen: boolean
  readonly name: string
  readonly phrase: string
}): ReactNode => (
  // **A width of its own, and it is what makes `truncate` below cut anything.** The shared
  // panel has a floor and no ceiling, so a row sized by its content grows the panel to the
  // whole instruction — which, anchored at the readout's right edge, runs off the left of
  // a phone. 224px leaves the panel at its own 256px floor, which stays on a 358px screen
  // from the narrowest readout; the desk takes 320.
  <span className="flex w-56 items-center gap-1.5 sm:w-80">
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className={`whitespace-nowrap font-mono ${chosen ? "font-medium text-accent" : ""}`}>
        {name}
      </span>
      {/* The row's width cuts it, and draws the one ellipsis. */}
      <span className="min-w-0 truncate text-sm text-fg-subtle">{phrase}</span>
    </span>
    {chosen ? <Check size={13} aria-hidden className="shrink-0 text-accent" /> : undefined}
  </span>
)

const ContinuesMenu = ({
  mark,
  now,
  options,
  onPick,
}: {
  /** The step's number on the card, for the name a screen reader gives the control. */
  readonly mark: string
  /** The key it continues now, or `undefined` for a new session. */
  readonly now: string | undefined
  /** The earlier agent steps still in the plan. */
  readonly options: readonly Continuable[]
  /** A key, or `undefined` for a new session. */
  readonly onPick: (key: string | undefined) => void
}): ReactNode => {
  // What `now` names, as drawn. A key naming no option is drawn as written.
  const words = options.find((o) => o.key === now)?.shown ?? now ?? NEW_SESSION
  return (
    <OverflowMenu
      label={`Step ${mark} conversation: ${words}`}
      icon={now === undefined ? MessageSquarePlus : CornerDownRight}
      face={<span>{words}</span>}
    >
      {(shut) => (
        <>
          <MenuItem
            role="menuitemradio"
            checked={now === undefined}
            onClick={() => {
              onPick(undefined)
              shut()
            }}
          >
            <Row chosen={now === undefined} name={NEW_SESSION} phrase="its own conversation" />
          </MenuItem>
          {options.map((o) => (
            <MenuItem
              key={o.key}
              role="menuitemradio"
              checked={now === o.key}
              onClick={() => {
                onPick(o.key)
                shut()
              }}
            >
              <Row chosen={now === o.key} name={o.shown} phrase={o.instruction} />
            </MenuItem>
          ))}
        </>
      )}
    </OverflowMenu>
  )
}

export default ContinuesMenu
