/**
 * How much of this trak you want to stand at — asked here as it starts, and changeable
 * from the trak's own screen afterwards.
 *
 * **One strip of segments, one per mode, not tiles.** The pane above it is already a grid
 * of tiles asking a different question, and a second grid under it read as more of the
 * same question. A control that is visibly one control cannot: segments flush inside one
 * edge are answers to one thing.
 *
 * **Its own full-width band pinned above the chat bar, and not a control beside the
 * send.** Pinned, because the grid above it grows with the agent library and a question
 * asked once per trak must not sit past the end of a list. Its own band rather than a
 * control in the send's row, because the send is a press and this is not.
 * `NewTrakPage` carries the cost, which is that this drawer's foot is taller than the
 * real drawer's.
 *
 * The strip itself is `components/ModeStrip`, which host settings' webhook callers draw
 * too; what is said here is about the band it sits in on New Trak.
 */

import type { ReactNode } from "react"
import type { RunModeDto } from "../../api/types"
import ModeStrip from "../../components/ModeStrip"

const ModePicker = ({
  picked,
  onPick,
}: {
  readonly picked: RunModeDto
  readonly onPick: (picked: RunModeDto) => void
}): ReactNode => (
  // `shrink-0` because it is a band of the drawer's column now rather than content inside
  // the pane: without it the strip is what gives when the field grows to two lines.
  //
  // **`pb-1` is half of one gap, and the band below pays the other half** — the
  // `AutoMergeSwitch` row's `pt-1` on New Trak, `ChatBar`'s `pt-1` where nothing sits
  // between. The controls in this footer sit at one rhythm: 8px from one band down to the
  // next, and the same 8px across from the field to the send, which is that row's own
  // `gap-2`. So the number here is not free — it is whatever leaves `pb` plus the next
  // band's `pt` equal to that gap, and moving either half alone breaks the pair. `pt-3`
  // above it is unrelated and is the strip standing clear of a pane that scrolls under it.
  <div className="shrink-0 bg-canvas px-4 pb-1 pt-3">
    <ModeStrip picked={picked} onPick={onPick} />
  </div>
)

export default ModePicker
