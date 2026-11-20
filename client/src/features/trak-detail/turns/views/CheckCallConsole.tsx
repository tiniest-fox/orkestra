/**
 * What an agent's check printed, as its card's body: the line it was spawned as, then the
 * output, flush to the card's edges on the card's own surface.
 *
 * **160px, scrolling itself and resting at its end** — `GateFace`'s console at a height that
 * fits inside the transcript, and its rule for following: scrolling up stops the follow,
 * scrolling back to the end takes it back, and a run that ends re-arms it.
 *
 * A `useLayoutEffect` on its own node, the exception `GateFace` takes and for its reason.
 */

import type { ReactNode, UIEvent } from "react"
import { useLayoutEffect, useRef } from "react"
import AnsiText from "../../../../components/AnsiText"
import { atBottom } from "../../../../format/scroll"
import type { CheckCall } from "./checkCall"

const CheckCallConsole = ({ call }: { readonly call: CheckCall }): ReactNode => {
  const box = useRef<HTMLPreElement>(null)
  const following = useRef(true)
  const going = call.phase === "running" || call.phase === "queued"

  useLayoutEffect(() => {
    const node = box.current
    if (node === null) return
    if (!going) following.current = true
    if (following.current) node.scrollTop = node.scrollHeight
  }, [call.output, going])

  return (
    <div className="border-t border-border">
      {call.command === undefined ? undefined : (
        <p className="truncate border-b border-border bg-surface px-3 py-1 font-mono text-2xs text-fg-subtle">
          {call.command}
        </p>
      )}
      <pre
        ref={box}
        onScroll={(event: UIEvent<HTMLPreElement>) => {
          following.current = atBottom(event.currentTarget)
        }}
        className="h-40 overflow-auto whitespace-pre-wrap break-words bg-surface p-2 font-mono text-xs text-fg-muted"
      >
        <AnsiText text={call.output} />
        {going && (
          // `GateFace`'s caret, a line of the console's own font tall.
          <span
            aria-hidden
            className="ml-0.5 inline-block h-[1em] w-[0.5em] translate-y-[0.15em] animate-thinking bg-tone-working align-baseline motion-reduce:animate-none"
          />
        )}
      </pre>
    </div>
  )
}

export default CheckCallConsole
