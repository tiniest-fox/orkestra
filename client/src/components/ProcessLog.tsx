/**
 * What a process has printed, stdout and stderr together, in the order it was written —
 * its own scroll container, resting at the end.
 *
 * **It follows the end while the reader is there, and stops when they scroll up**, the
 * rule the check console and the pane follow. A dev server prints for hours, and the line
 * that matters is the newest one.
 *
 * **It pays the home indicator's inset, inside the scroller.** On a phone the side panel
 * replaces the trak's screen, so no chat bar sits under it to pay `pb-foot`, and this is
 * the surface at the bottom edge. Padding rather than a margin, so the scroll still runs to
 * the edge and only its resting end — the newest line — clears the indicator. The empty
 * screen takes the same inset as a margin, so its centre is the centre of what is visible.
 * Both are 0 on a desk.
 *
 * A `useLayoutEffect` in a `presentational` file, on `GateFace`'s exception: it measures
 * and sets this component's own box and nothing else.
 */

import type { ReactNode, UIEvent } from "react"
import { useLayoutEffect, useRef } from "react"
import type { HostedProcessDto } from "../api/types"
import AnsiText from "./AnsiText"
import { atBottom } from "../format/scroll"
import ProcessGlyph from "./ProcessGlyph"

const ProcessLog = ({ process }: { readonly process: HostedProcessDto }): ReactNode => {
  const box = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  useLayoutEffect(() => {
    const node = box.current
    if (node !== null && following.current) node.scrollTop = node.scrollHeight
  }, [process.log])

  if (process.log === "")
    return (
      <div className="mb-safe-b flex min-h-48 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <ProcessGlyph tag={process.state._tag} size={28} />
        <p className="text-sm text-fg-muted">
          {process.state._tag === "NotStarted"
            ? "Nothing has run yet. Start prints its output here."
            : "Nothing printed yet."}
        </p>
      </div>
    )

  return (
    <div
      ref={box}
      onScroll={(event: UIEvent<HTMLDivElement>) => {
        following.current = atBottom(event.currentTarget)
      }}
      className="min-h-0 flex-1 overflow-auto pb-safe-b"
    >
      <pre
        aria-label={`${process.name}'s log`}
        className="whitespace-pre-wrap break-all p-3 font-mono text-xs leading-5 text-fg"
      >
        <AnsiText text={process.log} />
      </pre>
    </div>
  )
}

export default ProcessLog
