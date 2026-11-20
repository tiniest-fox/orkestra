/**
 * Auto-merge's press in the finished band — the second home of the run-mode picker's
 * switch, beside the merge press while a pull request is open: a quiet press with a clock
 * mark, *Auto-merge* in both states and a `Switch` inside it, the word in the accent while
 * on. The word never changes, so the press keeps its width as it is turned.
 *
 * **On a phone it leaves the row** — three equal cells have no fourth — for a full-width
 * row above the doors, its word at the left and its switch at the right edge.
 *
 * Off while stopped, as in the picker, so pressing it is the fresh start; the line above
 * the row says why it stopped. Spends nothing and takes no custody — `useSetAutoMerge`.
 */

import type { ReactNode } from "react"
import { Clock } from "lucide-react"
import Button from "../../../../components/Button"
import Switch from "../../../../components/Switch"

const AutoMergePress = ({
  on,
  disabled,
  onToggle,
  block,
}: {
  readonly on: boolean
  readonly disabled: boolean
  /** Asked for the other position than the one drawn. */
  readonly onToggle: (on: boolean) => void
  /** The phone's full-width row rather than a press in the ending cell. */
  readonly block: boolean
}): ReactNode => (
  <Button
    variant="quiet"
    icon={Clock}
    role="switch"
    aria-checked={on}
    disabled={disabled}
    block={block}
    onClick={() => {
      onToggle(!on)
    }}
  >
    <span className={`${block ? "flex-1 text-left" : ""} ${on ? "text-accent" : ""}`}>
      Auto-merge
    </span>
    <span className="ml-1 flex">
      <Switch on={on} />
    </span>
  </Button>
)

export default AutoMergePress
