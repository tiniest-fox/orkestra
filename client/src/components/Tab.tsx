/**
 * One segment of a `TabBar` — a surface you can be on.
 *
 * **Lit is ink plus the `Marker`, never a plate.** The dividers already say the bar is in
 * parts, which is a cheaper claim than plating one of them, so nothing is plated at rest.
 * Unlit hovers toward the lit ink: that is where the affordance comes from.
 *
 * **Disabled means the bar has nothing behind it, not that this tab is unavailable.** A
 * drawer with no map yet draws its segments anyway, so that nothing moves when the map
 * arrives — and they say so by being unpressable rather than by being absent.
 *
 * **`opacity-45`, which is `Button`'s, and the contrast bar does not apply to it.** These
 * labels were `text-fg-subtle` while they were `<span>`s, because at 2.36:1 an opacity put
 * them under the 4.5 this system holds — right for dim text, and the reason it stopped
 * being right is the whole of this change: WCAG 1.4.3 exempts an *inactive user interface
 * component*, and a faded `<span>` is not one where a `<button disabled>` is. A step apart
 * in the ink scale is also not a difference anyone sees, which is what the two spent.
 *
 * **The three inks are chosen here rather than left to `disabled:` and `hover:`.** Which
 * variant wins when two set the same property is the order they land in the stylesheet,
 * and that is not a thing a component should be relying on.
 */

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import Marker from "./Marker"

const Tab = ({
  label,
  icon: Glyph,
  current = false,
  disabled = false,
  grow = false,
  bare = false,
  onClick,
}: {
  readonly label: string
  /** A `lucide-react` component, not a name. */
  readonly icon: LucideIcon
  readonly current?: boolean
  readonly disabled?: boolean
  /** Share the bar's width equally with the other growing segments — the phone's
   *  surface bar, where four tabs are the whole band. At rest a tab is its label's
   *  width, because the step bar's wide segment is the one that grows. */
  readonly grow?: boolean
  /**
   * Below the breakpoint, the glyph alone: the word stays as the press's accessible name
   * and the tab keeps the 44px floor. For a band whose other half is the answer a phone
   * reader came for — the check band's verdict, which the words were cutting.
   */
  readonly bare?: boolean
  readonly onClick?: () => void
}): ReactNode => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    // Still true when the bar is inert: it says where you are, not what you may press.
    aria-current={current ? "true" : undefined}
    className={`relative flex ${grow ? "min-w-0 flex-1 basis-0" : "shrink-0"} ${bare ? "max-sm:min-w-11" : ""} items-center justify-center gap-1.5 whitespace-nowrap px-2.5 text-sm font-medium transition-colors ${
      disabled
        ? "cursor-not-allowed text-fg-muted opacity-45"
        : current
          ? "text-fg hover:bg-hover-row"
          : "text-fg-muted hover:bg-hover-row hover:text-fg"
    }`}
  >
    {current && <Marker />}
    <Glyph size={13} aria-hidden />
    {bare ? <span className="max-sm:sr-only">{label}</span> : label}
  </button>
)

export default Tab
