/**
 * The figure the overview, the change map and the walkthrough share: a rail on the left
 * that picks one item, and that item's content on the right.
 *
 * **One height.** Every content state is drawn, hidden but for the picked one, so the
 * figure measures its tallest closed state — and the rail, at a desk — and holds there,
 * capped, while the reader picks or opens things; inside, it scrolls. Nothing below the
 * figure moves under a press. `open` is the figure telling it something is open, which is
 * when it stops measuring: an opened file is not a closed state.
 *
 * **A hidden state is folded to no height**, not merely invisible, so the scroller's
 * extent is the picked state's own: a short list beside a long one does not scroll on into
 * blank space. Each state is measured by the wrapper inside its fold, which keeps its
 * natural height while clipped.
 *
 * **Narrow is this figure's own width, not the viewport's**, measured on its own node:
 * under 576px the rail stacks above the content, capped, and every press takes the touch
 * floor. An unlaid-out box reports 0 — every box happy-dom reports — and is not a narrow one.
 * The figures are handed `narrow` because what they draw differs by it too.
 */

import type { ReactNode } from "react"
import { useLayoutEffect, useRef, useState } from "react"
import Figure from "./Figure"
import NavigatorRail, { type RailItem } from "./NavigatorRail"

/** Below this box width the rail stacks above the content. `@xl`. */
const STACK_UNDER_PX = 576
/** The most the content holds at, at a desk and on a phone alike. */
const CAP_PX = 320

/** The tallest closed state, and the layout it was measured in. */
interface Held {
  readonly narrow: boolean
  readonly px: number
}

const Navigator = ({
  label,
  renderEnd,
  items,
  picked,
  onPick,
  open,
  renderStates,
  renderFooter,
}: {
  readonly label: string
  readonly renderEnd: (narrow: boolean) => ReactNode
  readonly items: readonly RailItem[]
  readonly picked: number
  readonly onPick: (index: number) => void
  /** Something inside the picked state is open, so the measurement holds still. */
  readonly open: boolean
  /** One content state per rail item, in the rail's order. */
  readonly renderStates: (narrow: boolean) => readonly ReactNode[]
  readonly renderFooter: ((narrow: boolean) => ReactNode) | undefined
}): ReactNode => {
  const box = useRef<HTMLElement>(null)
  const cell = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [held, setHeld] = useState<Held>({ narrow: false, px: 0 })

  useLayoutEffect(() => {
    const node = box.current
    if (node === null) return
    const read = (): void => {
      setNarrow(node.clientWidth > 0 && node.clientWidth < STACK_UNDER_PX)
    }
    read()
    const watch = new ResizeObserver(read)
    watch.observe(node)
    return () => {
      watch.disconnect()
    }
  }, [])

  useLayoutEffect(() => {
    const content = cell.current
    const list = rail.current
    if (open || content === null || list === null) return
    const states = [...content.children].flatMap((fold) =>
      fold.firstElementChild instanceof HTMLElement ? [fold.firstElementChild] : [],
    )
    const measure = (): void => {
      const tallest = Math.max(0, ...states.map((state) => state.offsetHeight))
      const px = Math.max(tallest, narrow ? 0 : list.offsetHeight)
      // A change of layout starts the measure again; within one, it only grows.
      setHeld((was) => ({ narrow, px: was.narrow === narrow ? Math.max(was.px, px) : px }))
    }
    measure()
    const watch = new ResizeObserver(measure)
    for (const state of states) watch.observe(state)
    watch.observe(list)
    return () => {
      watch.disconnect()
    }
  }, [open, narrow, picked, items.length])

  const height = Math.min(CAP_PX, held.px === 0 ? CAP_PX : held.px)
  const drawn = renderStates(narrow)
  return (
    <Figure ref={box} label={label} end={renderEnd(narrow)} footer={renderFooter?.(narrow)}>
      <div
        style={narrow ? undefined : { height }}
        className={`flex min-w-0 ${narrow ? "flex-col" : "flex-row"}`}
      >
        <NavigatorRail ref={rail} items={items} picked={picked} onPick={onPick} narrow={narrow} />
        {/* Narrow, the column has no height of its own, so `flex-1`'s zero basis would beat
            the inline height and let the scroller grow to the picked state. */}
        <div
          style={narrow ? { height } : undefined}
          className={`min-w-0 overflow-y-auto bg-surface ${narrow ? "shrink-0" : "flex-1"}`}
        >
          <div ref={cell} className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
            {drawn.map((state, i) => (
              <section
                key={items[i]?.key ?? i}
                aria-label={items[i]?.title}
                aria-hidden={i === picked ? undefined : true}
                inert={i !== picked}
                className={`col-start-1 row-start-1 min-w-0 ${i === picked ? "" : "invisible h-0 overflow-hidden"}`}
              >
                <div className="min-w-0">{state}</div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </Figure>
  )
}

export default Navigator
