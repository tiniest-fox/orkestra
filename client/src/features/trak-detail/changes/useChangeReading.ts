/**
 * Where a reader is in the diff and what they have folded — held once, because two
 * layouts draw the same list. The desktop's `ChangeList` and the phone's `ChangeStack`
 * are one set of rules about scrolling, jumping and folding, differing only in what is
 * around the cards; a second copy would be two ideas of *the file you are reading*.
 *
 * **Fold state is what the reader has *changed*, not what is folded.** Deleted, binary and
 * over-cap files open folded, and that is a fact about the file — so a poll that brings a
 * new deleted file folds it, while a card the reader opened by hand stays open. Holding the
 * folded set directly would get exactly one of those right.
 *
 * One effect, and it is the landing: a change map's Open in Changes asks for a file before
 * this list exists, so the jump can only happen once the cards have mounted. Everything
 * else fires from a scroll or a press the caller wires up.
 */

import type { RefObject } from "react"
import { useLayoutEffect, useRef, useState } from "react"
import type { FileChangeDto } from "../../../api/types"
import { initiallyFolded } from "./changes"

/** How far below the top of the diff a card may start and still count as the one you are
 *  reading. A card whose header has just cleared the top edge is the honest answer. */
const AT_TOP_PX = 8

/** Scrolls the diff rather than the node: `scrollIntoView` walks every ancestor, and one of
 *  them is the drawer, which would move the whole trak under the reader. `false` where the
 *  card is not there to scroll to. */
const jump = (scroller: HTMLDivElement | null, card: HTMLElement | undefined): boolean => {
  if (scroller === null || card === undefined) return false
  scroller.scrollTop += card.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  return true
}

interface ChangeReading {
  /** The path of the file under the top of the scroller — the first file before anyone
   *  scrolls or presses. `undefined` only with no files at all. */
  readonly at: string | undefined
  /** The scroller the cards live in, whichever layout owns it. */
  readonly box: RefObject<HTMLDivElement | null>
  /** Hands a card's node in, so a jump can reach it and the measure can read it. */
  readonly hold: (path: string, node: HTMLElement | null) => void
  /** Call from the scroller's own `onScroll`. */
  readonly measure: (scroller: HTMLDivElement) => void
  /** Scroll the diff to a file's card. */
  readonly go: (path: string) => void
  readonly folded: (path: string) => boolean
  readonly fold: (path: string) => void
}

/**
 * `landing` is a file to jump to as the list mounts, and `onLanded` is told once it has —
 * so a later press of the picker, which remounts the list, does not jump there again.
 */
export const useChangeReading = (
  files: readonly FileChangeDto[],
  landing: string | undefined,
  onLanded: () => void,
): ChangeReading => {
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  /** Which file the reader has scrolled or pressed to, or `undefined` before either. */
  const [seen, setSeen] = useState<string | undefined>(undefined)
  const box = useRef<HTMLDivElement>(null)
  const cards = useRef(new Map<string, HTMLElement>())

  const folds = initiallyFolded(files)

  const go = (path: string): void => {
    if (jump(box.current, cards.current.get(path))) setSeen(path)
  }

  // Layout rather than passive, so the first frame painted is already at the file. The
  // cards' refs are attached by then: React sets refs before it runs layout effects.
  const landed = useRef(onLanded)
  landed.current = onLanded
  useLayoutEffect(() => {
    if (landing === undefined) return
    if (jump(box.current, cards.current.get(landing))) setSeen(landing)
    landed.current()
  }, [landing])

  return {
    at: seen ?? files[0]?.path,
    box,
    hold: (path, node) => {
      if (node === null) cards.current.delete(path)
      else cards.current.set(path, node)
    },
    /** The last card whose top has reached the top of the scroller — which is the one
     *  whose lines fill it, rather than the first one merely still visible. */
    measure: (scroller) => {
      const edge = scroller.getBoundingClientRect().top + AT_TOP_PX
      let here: string | undefined
      for (const file of files) {
        const card = cards.current.get(file.path)
        if (card !== undefined && card.getBoundingClientRect().top <= edge) here = file.path
      }
      setSeen(here ?? files[0]?.path)
    },
    go,
    folded: (path) => folds.has(path) !== toggled.has(path),
    fold: (path) => {
      setToggled((held) => {
        const next = new Set(held)
        if (!next.delete(path)) next.add(path)
        return next
      })
    },
  }
}
