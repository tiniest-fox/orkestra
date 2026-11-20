/**
 * The four run modes as one strip of flush segments, one chosen — New Trak's mode band, and
 * the run mode a webhook caller's traks start in, in host settings. The caller owns the
 * band around it; this is the strip alone.
 *
 * **The strip owns the hairline between segments**, `[&>*+*]` as `TabBar` does it, because
 * whether a segment is first is a fact about the strip rather than about the segment.
 *
 * **Chosen is a fill, where New Trak's agent tiles above it mark one with an edge, and that
 * is deliberate.** A tile is a surface and moving its ground says *a different level*; a
 * segment has no ground of its own to move, and an edge inside a strip that already has
 * edges says nothing. Settled by looking at the two together.
 *
 * **Title case on screen, the identifier in the record.** A trak's mode is `manual`,
 * `smart`, `decider` or `auto` in its own log and on the wire, and both are unchanged — what moved
 * is that a name set at `text-base` beside a phrase is read rather than parsed. The trak
 * detail still prints the log's own lowercase value, which is the surface where being
 * raw is the point.
 *
 * **The phrase carries `accent-ink` undimmed on the chosen segment**, which is the whole
 * of what the token is for — it flips with the scheme, so naming a colour here would be
 * true in one of them. Dimming it is what fails: white at 80% on the light accent lands
 * near 4.2:1, under the bar this system holds.
 *
 * **A narrow window trails a phrase off rather than reflowing.** `truncate` is the
 * mechanism inside a band: the client's one responsive seam is the phone breakpoint —
 * `usePhone` and `max-sm:`, one 640px line. Its segments carry two lines and already
 * clear the 44px touch floor. **Below the breakpoint the mark goes**: four segments at
 * 390px leave about 89px each, and with the mark beside it *Decider* truncated too — a
 * name that trails off is a mode nobody can tell apart, where a phrase that trails off
 * still has its name above it.
 */

import type { ReactNode } from "react"
import type { RunModeDto } from "../api/types"
import { MODE_WORDS, MODES } from "../format/runMode"

/** The two states a segment has. Chosen plates; unchosen keeps the pane's row tint. */
const look = (chosen: boolean): string =>
  chosen ? "bg-accent text-accent-ink" : "text-fg-muted hover:bg-hover-row"

const ModeStrip = ({
  picked,
  onPick,
}: {
  readonly picked: RunModeDto
  readonly onPick: (picked: RunModeDto) => void
}): ReactNode => (
  <div className="flex overflow-hidden rounded-control border border-border bg-surface [&>*+*]:border-l [&>*+*]:border-border">
    {MODES.map((mode) => {
      const { name, phrase, mark: Mark } = MODE_WORDS[mode]
      const chosen = mode === picked
      return (
        <button
          key={mode}
          type="button"
          aria-pressed={chosen}
          onClick={() => {
            onPick(mode)
          }}
          // Left-aligned rather than centred: the phrase is on its own line and truncates,
          // and a line that trails off from a centre reads as damage rather than as more.
          className={`flex min-w-0 flex-1 basis-0 flex-col gap-0.5 px-3 py-1.5 text-left transition-colors ${look(chosen)}`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Mark size={13} className="shrink-0 max-sm:hidden" aria-hidden />
            <span className="truncate text-base font-medium">{name}</span>
          </span>
          <span className={`truncate text-sm ${chosen ? "" : "text-fg-subtle"}`}>{phrase}</span>
        </button>
      )
    })}
  </div>
)

export default ModeStrip
