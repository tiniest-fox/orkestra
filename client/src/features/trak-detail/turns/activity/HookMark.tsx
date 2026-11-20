/**
 * The mark at the right end of a call line saying hooks ran around the call, and the press that
 * shows what they said: an anchor, faint when every hook ran cleanly, red when one failed and
 * amber when one blocked — one mark for every hook on the call, in the worst one's ink.
 *
 * **On a desk** a mouse hovering, or focus landing on the mark, opens a card under it,
 * right-aligned, and it shuts again when the pointer or the focus leaves. A press — a
 * click, Enter, or a tap on a tablet — pins it open whether or not it was already open,
 * and while pinned neither leaving shuts it: a second press, Escape or a press anywhere
 * outside does. The card hangs inside the same wrapper as the press, flush under it, so the
 * pointer crossing from one to the other never leaves the group and nothing needs a timer
 * to bridge the gap. Hover is told from a tap by the pointer's own type, since a tap also
 * raises the enter a mouse would. `ContextLine` is the same shape.
 *
 * **On a phone** a tap opens the same card as a `Sheet` from the foot of the screen, which
 * a tap on the wash or Escape shuts. The glyph is 11px, so the press is a 44px box centred
 * on it that overhangs the line above and below without moving either.
 */

import type { KeyboardEvent, PointerEvent, ReactNode } from "react"
import { useCallback, useRef, useState } from "react"
import { Anchor } from "lucide-react"
import type { HookEntryDto } from "../../../../api/types"
import Sheet from "../../../../components/Sheet"
import { hookInk, hookLabel, worstHook } from "../../../../format/hooks"
import { usePhone } from "../../../../hooks/usePhone"
import { useTapOutside } from "../../../../hooks/useTapOutside"
import HookCard from "./HookCard"

const isMouse = (event: PointerEvent<HTMLElement>): boolean => event.pointerType === "mouse"

const HookMark = ({ hooks }: { readonly hooks: readonly HookEntryDto[] }): ReactNode => {
  const phone = usePhone()
  /** Open because the pointer or the focus is on it; ends when that leaves. */
  const [peeking, setPeeking] = useState(false)
  /** Open because it was pressed; ends only on a second press, Escape or a press outside. */
  const [pinned, setPinned] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const shut = useCallback(() => {
    setPinned(false)
    setPeeking(false)
  }, [])
  useTapOutside(root, pinned && !phone, shut)
  if (hooks.length === 0) return undefined
  const open = pinned || peeking
  const label = hookLabel(hooks)
  return (
    <span
      ref={root}
      className="relative inline-flex h-4 shrink-0 items-center"
      onPointerEnter={(event: PointerEvent<HTMLSpanElement>) => {
        if (!phone && isMouse(event)) setPeeking(true)
      }}
      onPointerLeave={(event: PointerEvent<HTMLSpanElement>) => {
        if (!phone && isMouse(event)) setPeeking(false)
      }}
      onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === "Escape") shut()
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onFocus={() => {
          if (!phone) setPeeking(true)
        }}
        onBlur={() => {
          setPeeking(false)
        }}
        onClick={() => {
          if (pinned) shut()
          else setPinned(true)
        }}
        className="relative inline-flex items-center rounded-control px-0.5 hover:bg-hover-bare max-sm:hover:bg-transparent"
      >
        {phone ? (
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 size-11 -translate-x-1/2 -translate-y-1/2"
          />
        ) : undefined}
        <Anchor size={11} strokeWidth={2} aria-hidden className={hookInk[worstHook(hooks)]} />
      </button>
      {open && !phone ? (
        <span className="absolute top-full right-0 z-10 pt-1">
          <span
            role="dialog"
            aria-label={label}
            className="flex w-80 flex-col rounded-surface border border-border bg-surface px-3 py-1 text-left shadow-menu"
          >
            <HookCard hooks={hooks} />
          </span>
        </span>
      ) : undefined}
      {open && phone ? (
        <Sheet label={label} tall={false} onClose={shut}>
          <HookCard hooks={hooks} />
        </Sheet>
      ) : undefined}
    </span>
  )
}

export default HookMark
