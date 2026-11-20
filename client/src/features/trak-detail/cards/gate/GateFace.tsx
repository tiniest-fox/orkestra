/**
 * What the check did, in the card's body: the line it was spawned as, and what it printed.
 *
 * **A wall of monospace is the honest drawing** — nothing here can be summarised without
 * deciding which line mattered, and the line that mattered is exactly what the reader is
 * looking for. This replaces the red-headed plate the pane used to draw above the document
 * for a failure; the same output, on the face of the card it is about.
 *
 * **240px, and the card never grows.** A `verify` is minutes long and the console is
 * inside a pane that is also holding a transcript, so it scrolls itself: nothing below it
 * moves while a check runs.
 *
 * It wraps rather than scrolling sideways, for the reason the plate did: the reports these
 * carry are written for eighty columns and read in a drawer half that wide, and one
 * horizontal scrollbar under twenty lines is a control for reading one of them.
 *
 * **ANSI survives.** The output is bytes a spawned process wrote, and of what `pnpm
 * verify` runs, tsc, the client build and playwright colour through a pipe. `AnsiText` is
 * a no-op on the rest.
 *
 * A `useLayoutEffect` in a `presentational` file, which `client-style`'s table otherwise
 * reads as banned. The same exception `DrawerPane` and `components/Field` take, and for
 * the same reason: measuring and setting a box is not a side effect on anything outside
 * this component, and there is nowhere else it can be done.
 */

import type { ReactNode, UIEvent } from "react"
import { useLayoutEffect, useRef } from "react"
import AnsiText from "../../../../components/AnsiText"
import { askedText, type CheckRun, endedText } from "../../checks/check"
import { atBottom } from "../../../../format/scroll"

const GateFace = ({
  run,
  asked = false,
}: {
  readonly run: CheckRun
  /**
   * Whether there is a press on the table for this document — which at a failure is the
   * whole of what the sentence below is about. A superseded attempt's failure has nothing
   * to offer and says nothing.
   */
  readonly asked?: boolean
}): ReactNode => {
  const box = useRef<HTMLPreElement>(null)
  /**
   * Whether an append should carry the console with it. A ref rather than state, for
   * `DrawerPane`'s reason: nothing renders differently because of it.
   *
   * It starts true so a console opens at the end of what the check has printed, which is
   * where a run in flight and a settled one are both read — see below.
   */
  const following = useRef(true)

  /**
   * **The console rests at its end, whatever the run is doing.** In flight that is
   * obvious: a terminal showing the first eighty lines of a five-minute run is showing the
   * wrong end of it.
   *
   * **Ended is the same end, and that is a reversal.** This used to put a settled run back
   * at its head, on the grounds that `report` composes stderr first so the line explaining
   * a failure is the first one. That holds only for a check that diagnoses on stderr, and
   * this project's do not — `verify.sh` writes nothing there, so its head is the start of
   * stdout, which is the record of the stages that passed. The console is 240px over
   * 16px lines, so about fifteen fit; the record runs to nineteen. At the head, a failure
   * in one of the late stages has its report entirely below the fold. At the end it cannot:
   * a fail-fast script prints its report last, whatever it printed getting there.
   *
   * **Which end, rather than where the report starts.** Finding the report would mean this
   * file recognising what `.orkestra/checks/*.sh` prints, and `client/` may not know what
   * this project's `.orkestra/` holds.
   *
   * The flip to ended re-arms the follow. Scrolling up during a run says *stop moving
   * this* about the lines that were on screen, and `CheckEnded` replaces the output
   * outright rather than appending to it — so the position that gesture was protecting is
   * not in the box any more.
   */
  useLayoutEffect(() => {
    const node = box.current
    if (node === null) return
    if (run.phase !== "running") following.current = true
    if (following.current) node.scrollTop = node.scrollHeight
  }, [run.output, run.phase])

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {run.command === undefined ? undefined : (
        <span className="min-w-0 truncate font-mono text-2xs text-fg-subtle">{run.command}</span>
      )}

      <div className="min-w-0 overflow-hidden rounded-control border border-border bg-surface-2">
        <pre
          ref={box}
          // Scrolling up is how a reader says *stop moving this*, and scrolling back to
          // the end is how they take it back. The pane above follows the same rule.
          onScroll={(event: UIEvent<HTMLPreElement>) => {
            following.current = atBottom(event.currentTarget)
          }}
          className="h-60 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs text-fg-muted"
        >
          <AnsiText text={run.output} />
          {run.phase === "running" && (
            // Em rather than the spacing scale, and it is the one place that is right: a
            // caret is one line of the console's own font tall, and the scale is in pixels
            // — a fixed height here would stop matching the text the day the size moves.
            <span
              aria-hidden
              className="ml-0.5 inline-block h-[1em] w-[0.5em] translate-y-[0.15em] animate-thinking bg-tone-working align-baseline motion-reduce:animate-none"
            />
          )}
        </pre>
      </div>

      {asked && run.phase === "failed" ? (
        <p className="text-sm text-fg-muted">{askedText(run.attempts)}</p>
      ) : asked && run.phase === "cancelled" ? (
        <p className="text-sm text-fg-muted">{endedText}</p>
      ) : undefined}
    </div>
  )
}

export default GateFace
