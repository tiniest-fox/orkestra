/**
 * The strips the gate card's Edit press opens on a phone, with Done, in a bottom sheet.
 * `note` says when a change lands. At a desk the gate card draws the strips inline, and a
 * running goal's settings are the Goal tab's, so there is no desk form.
 */

import type { ReactNode } from "react"
import Button from "../../components/Button"
import Sheet from "../../components/Sheet"

const LABEL = "Limits and modes"

const Head = ({ onDone }: { readonly onDone: () => void }): ReactNode => (
  <span className="flex items-center justify-between">
    <span className="text-base font-medium text-fg">{LABEL}</span>
    <Button variant="quiet" size="md" onClick={onDone}>
      Done
    </Button>
  </span>
)

const GoalSettingsOpen = ({
  note,
  onDone,
  children,
}: {
  readonly note: string
  readonly onDone: () => void
  readonly children: ReactNode
}): ReactNode => (
  <Sheet label={LABEL} tall onClose={onDone}>
    <div className="flex flex-col gap-3 pb-2">
      <Head onDone={onDone} />
      {children}
      <span className="text-xs text-fg-subtle">{note}</span>
    </div>
  </Sheet>
)

export default GoalSettingsOpen
