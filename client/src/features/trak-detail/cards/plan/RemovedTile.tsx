/**
 * What a step removed at the plan gate leaves on the card until the press: one dashed
 * row with its number, its glyph, its name struck through, the word, and Undo.
 *
 * Folded rather than dropped, so nothing under the person's thumb moves and every key
 * they read still names what they read it as.
 */

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import Button from "../../../../components/Button"

/** The way back from a removal, for a removed step and a removed clock alike. */
export const Undo = ({ onPress }: { readonly onPress: () => void }): ReactNode => (
  <Button variant="ghost" size="sm" onClick={onPress}>
    Undo
  </Button>
)

const RemovedTile = ({
  mark,
  glyph: Glyph,
  name,
  onUndo,
}: {
  readonly mark: string
  readonly glyph: LucideIcon
  readonly name: string
  readonly onUndo: () => void
}): ReactNode => (
  <li className="flex min-w-0 items-center gap-1.5 rounded-surface border border-dashed border-border px-2.5 py-0.5">
    <span className="shrink-0 font-mono text-2xs text-fg-subtle">{mark}</span>
    <Glyph size={13} aria-hidden className="shrink-0 text-fg-subtle opacity-60" />
    <span className="min-w-0 truncate font-mono text-2xs uppercase tracking-wider text-fg-subtle line-through">
      {name}
    </span>
    <span className="shrink-0 font-mono text-2xs text-fg-subtle">removed</span>
    <span className="ml-auto">
      <Undo onPress={onUndo} />
    </span>
  </li>
)

export default RemovedTile
