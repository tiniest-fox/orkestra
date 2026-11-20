/**
 * Where an agent's check stands, at the right end of its card's header: a glyph and the
 * words, in the phase's tone. Only these two are toned — the header never is.
 *
 * Read at render rather than ticked, as `GateStrip`'s verdict is: a running check sends a
 * frame every few hundred milliseconds and each one redraws this.
 */

import { Check, Hourglass, Square, TriangleAlert } from "lucide-react"
import type { ReactNode } from "react"
import { toneInk } from "../../../../format/tone"
import { type CallPhase, type CheckCall, callTone, callWords } from "./checkCall"

const glyph = (phase: CallPhase): ReactNode => {
  switch (phase) {
    case "running":
      // `GateStrip`'s mark for *still going*, at its size and speed.
      return (
        <span
          aria-hidden
          className="size-1 animate-thinking rounded-pill bg-tone-working motion-reduce:animate-none"
        />
      )
    case "queued":
      return <Hourglass size={11} aria-hidden />
    case "passed":
    case "reused":
    case "unrecorded":
      return <Check size={11} aria-hidden />
    case "failed":
      return <TriangleAlert size={11} aria-hidden />
    case "stopped":
      return <Square size={11} aria-hidden fill="currentColor" />
  }
}

const CallVerdict = ({
  call,
  phone,
}: {
  readonly call: CheckCall
  readonly phone: boolean
}): ReactNode => (
  <span
    className={`flex min-w-0 shrink items-center gap-1.5 font-mono text-2xs ${toneInk[callTone(call.phase)]}`}
  >
    <span className="flex shrink-0 items-center">{glyph(call.phase)}</span>
    <span className="min-w-0 truncate">{callWords(call, Date.now(), phone)}</span>
  </span>
)

export default CallVerdict
