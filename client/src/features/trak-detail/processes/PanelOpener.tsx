/**
 * The trak header's one way into the side panel: a panel glyph, the glyph of the worst
 * process state while anything is starting, up or broken, the pull request's state glyph
 * while there is one, and how many processes the panel holds — left out at none. No word —
 * it names the panel rather than a process, so a second process or an opened file does not
 * change what it is; and the pull request is marked rather than counted.
 *
 * Lit while the panel is open, and pressing it again shuts it. **Bordered at 30px**, the
 * header's one size for an action — `Button` quiet's edge and its hover — and it sits last
 * in the actions row.
 */

import type { ReactNode } from "react"
import { PanelRight } from "lucide-react"
import type { HostedStateDto } from "../../../api/types"
import PullRequestGlyph from "../pull-request/PullRequestGlyph"
import type { PanelPull } from "./panelItem"
import ProcessGlyph from "../../../components/ProcessGlyph"

const PanelOpener = ({
  worst,
  pull,
  count,
  open,
  onToggle,
}: {
  /** The state to wear, or `undefined` when nothing is up and nothing is broken. */
  readonly worst: HostedStateDto["_tag"] | undefined
  readonly pull: PanelPull | undefined
  /** The processes in the panel. */
  readonly count: number
  readonly open: boolean
  readonly onToggle: () => void
}): ReactNode => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={open}
    aria-label="Side panel"
    className={`flex h-[30px] shrink-0 items-center gap-1.5 rounded-control border border-border px-2 text-sm transition-colors max-sm:min-h-11 ${
      open
        ? "bg-surface-2 text-fg"
        : "bg-surface text-fg-muted hover:border-accent/60 hover:text-fg"
    }`}
  >
    <PanelRight size={14} aria-hidden />
    {worst !== undefined && <ProcessGlyph tag={worst} />}
    {pull !== undefined && <PullRequestGlyph pull={pull.heading} confirmed={pull.confirmed} />}
    {count > 0 && <span className="font-mono text-2xs text-fg-subtle">{count}</span>}
  </button>
)

export default PanelOpener
