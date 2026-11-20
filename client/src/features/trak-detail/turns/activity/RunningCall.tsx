/**
 * A call that has not come back yet, as a line of its own under the run it belongs to.
 *
 * **It is drawn open because it is the thing a person is waiting on.** Folded into
 * `Ran 1 command`, a silent `pnpm verify` gave a reader nothing but a small clock to tell
 * it from one that had finished. So the call stands out of its run while it runs, in full,
 * and folds back into the run's count the moment its result arrives — an open line always
 * means something is in flight.
 *
 * **The text is the call's whole text, wrapping, never truncated** — the one place a
 * command is shown entire, because the reason to look at a running command is to see
 * which one it is. A command shows bare; any other kind leads with the tool's name,
 * `WebFetch <url>`, since a path or a URL alone does not say what is being done with it.
 * A command the agent described shows its description instead — the `detail` the provider
 * chose — and the command waits in the run, for whoever opens it.
 *
 * **An MCP call is the exception to drawing whole**: its mark, then `server/tool` on one
 * line, cut at the end. A connector's server name alone can fill a phone's row, and
 * wrapped it reads as two calls.
 *
 * **The lead is one dot breathing, from the moment the line opens.** No threshold: the
 * pulse is quiet enough to be there for a call that answers in half a second. It takes
 * the place a caret has on a run, so a command and a fetch share one mark while they run.
 *
 * **Only the clock waits**, until `SHOWN_AFTER` seconds — most calls end before then, and a
 * number appearing and vanishing within a second is noise. It reads `Running · 18s` in the
 * trailing slot and ticks off `useSecond`, so it keeps counting while nothing new arrives,
 * which is the case the old clock, read at render, froze on. It has no dot of its own as
 * `Elapsed` does: the lead already carries the one.
 *
 * **A hook that has reported on the call sits after the clock**, its mark last in the slot.
 *
 * Under reduced motion the dot stays, still and at full ink. The clock keeps counting —
 * a number changing is information rather than motion.
 */

import type { ReactNode } from "react"
import type { HookEntryDto, ToolEntryDto } from "../../../../api/types"
import { elapsedText } from "../../../../format/activity"
import { useSecond } from "../../../../hooks/useSecond"
import HookMark from "./HookMark"
import Line from "./Line"
import McpMark from "./McpMark"

/** Seconds a call runs before its clock appears. */
const SHOWN_AFTER = 3

const RunningCall = ({
  call,
  hooks,
}: {
  readonly call: ToolEntryDto
  /** The hooks that have already reported on it — a pre-call hook, while it runs. */
  readonly hooks: readonly HookEntryDto[]
}): ReactNode => {
  const now = useSecond(true)
  const ms = now * 1000
  const clock =
    call.at === undefined || ms - call.at < SHOWN_AFTER * 1000
      ? undefined
      : elapsedText(call.at, ms)
  const text =
    call.detail === undefined
      ? call.name
      : call.kind === "Bash"
        ? call.detail
        : `${call.name} ${call.detail}`
  // A description is prose and breaks between words; a command has no words to break
  // between, so it breaks anywhere rather than overflowing the pane.
  const breaks = call.command === undefined ? "break-all" : "break-words"
  return (
    <Line
      lead={
        <span
          aria-hidden
          className="size-1.25 animate-breathe rounded-pill bg-tone-working motion-reduce:animate-none"
        />
      }
      trailing={
        clock === undefined && hooks.length === 0 ? undefined : (
          <span className="flex items-center gap-1.5">
            {clock === undefined ? undefined : (
              <span className="font-mono text-2xs text-tone-working">{`Running · ${clock}`}</span>
            )}
            <HookMark hooks={hooks} />
          </span>
        )
      }
    >
      {call.kind === "Mcp" && call.detail !== undefined ? (
        <span className="flex min-w-0 items-baseline gap-1 font-mono text-xs whitespace-nowrap text-fg">
          <McpMark />
          <span className="min-w-0 truncate">{call.detail}</span>
        </span>
      ) : (
        <span className={`min-w-0 font-mono text-xs ${breaks} text-fg`}>{text}</span>
      )}
    </Line>
  )
}

export default RunningCall
