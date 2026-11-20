/**
 * The band a spawn's piece gets under the header while a reader is standing on it: the
 * piece's name and the controls that act on the piece alone — its run-mode picker, the
 * openers at its checkout, and its ending menu.
 *
 * **The piece's controls start right after its name, and its `⋯` sits at the far right**:
 * hung from the name rather
 * than the right edge, so they never line up under the header's right-aligned row and read
 * as one toolbar that slipped.
 *
 * **Not where the piece stands**, for `TrakHeader`'s reason: the pane under this band
 * says it in more detail, and nothing may put a state phrase back here.
 *
 * **It exists so that a press whose subject is the piece sits in the row that names the
 * piece.** The header speaks for the trak the page is of at every position, so its
 * controls act on that trak wherever a reader has stepped — and a piece has its own mode,
 * its own checkout and its own ending, each of which a press in the header's row would
 * quietly take on the parent instead. So this band carries the piece's, on a recessed
 * ground — inside and subordinate to the header, which is what `surface-2` means.
 * **The header keeps the trak's own picker while this band carries the piece's**,
 * so two pickers are on screen, each in the row that names its trak; only the trak's
 * carries auto-merge, since a piece's branch merges into its parent's.
 *
 * **It grows and collapses over 200ms rather than appearing and vanishing**, and the
 * mechanism is a grid row going `0fr → 1fr`. An element removed from the tree cannot animate
 * out, which is the whole of why an animation library gets reached for; a collapsing grid
 * row sidesteps it — the band stays mounted, its height is what transitions, and the content
 * it had is held one render longer so there is something to watch leave. The cost is that it
 * is always in the DOM at zero height, which is why it carries `aria-hidden` and `inert` by
 * hand while shut: a collapsed thing is still in the focus order and still hit-testable, and
 * a test asks whether it is *collapsed*, never whether it is there.
 *
 * **The clip the animation needs comes off once the band has finished opening**, because
 * the controls in here open panels that hang below the band's edge, and a band that stays
 * `overflow-hidden` cuts them at that edge. The clip is only load-bearing while the height is
 * actually changing, so it lifts on the opening transition's end and is back on the frame a
 * close starts — the content held for the leave must not spill while it shrinks. Under
 * `motion-reduce` the transition runs at 1ms rather than not at all, so `transitionend`
 * still fires and the unclip still lands; `transition-none` never fires it, which left the
 * panel cut for exactly those readers.
 *
 * **`z-20`, `TrakHeader`'s rank and for its reason**: the panels in here reach down over
 * a card's pinned `z-10` header, and the rank goes on the band it hangs from, never on the
 * panel — `components/README.md`'s layering ladder carries the rule.
 *
 * `py-1.5`, the header's actions row's rhythm: it hangs off the band above rather than
 * standing clear of anything.
 *
 * **No model token.** The piece's step's model sits under the chat box, in the place the
 * trak's does — `chat-bar/TrakChatBar`.
 */

import type { ReactNode, TransitionEvent } from "react"
import { useRef, useState } from "react"
import { CornerDownRight } from "lucide-react"

/** What the band says about the piece, and the presses that act for it. */
export interface Piece {
  readonly name: string
  /** The piece's run-mode picker and openers, composed by the page, right after the name. */
  readonly actions: ReactNode
  /** The piece's ending `⋯`, at the band's far right. */
  readonly menu: ReactNode
}

const PieceBand = ({ piece }: { readonly piece: Piece | undefined }): ReactNode => {
  // What to draw while collapsing. Without it the band empties on the same frame it starts
  // to close, so what leaves is a shrinking blank rather than the piece you stepped out of.
  const last = useRef<Piece | undefined>(undefined)
  const open = piece !== undefined
  if (open) last.current = piece
  const shown = open ? piece : last.current

  // Whether the band has finished growing, which is when the clip below comes off. Starts
  // true where the band mounts already open — no transition runs, so no `transitionend`
  // would ever lift it. Reset during render rather than in a handler so the clip is back
  // on the very frame a close starts.
  const [grown, setGrown] = useState(open)
  if (!open && grown) setGrown(false)
  const clip = grown ? "" : " overflow-hidden"

  return (
    <div
      className={`relative z-20 grid shrink-0 transition-[grid-template-rows] duration-200 ease-out motion-reduce:duration-[1ms]${clip} ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
      aria-hidden={!open}
      inert={!open}
      data-collapsed={!open}
      onTransitionEnd={(event: TransitionEvent<HTMLDivElement>) => {
        // Its own rows transition and nothing bubbling up from a control inside.
        if (event.target === event.currentTarget && event.propertyName === "grid-template-rows")
          setGrown(open)
      }}
    >
      {/* `min-w-0` outright, because the clip used to supply it: an `overflow-hidden`
          grid item's automatic minimum size is zero, so lifting the clip silently
          returned the minimum to content size and the name stopped truncating. */}
      <div className={`min-h-0 min-w-0${clip}`}>
        {shown === undefined ? undefined : (
          <div
            role="group"
            aria-label="Piece"
            className="flex min-w-0 items-center gap-2 bg-surface-2 px-4 py-1.5"
          >
            <span className="flex min-w-0 shrink items-center gap-1.5 text-base text-fg">
              <CornerDownRight size={13} aria-hidden className="shrink-0 text-fg-subtle" />
              <span className="truncate">{shown.name}</span>
            </span>
            {shown.actions}
            <span className="ml-auto flex shrink-0">{shown.menu}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default PieceBand
