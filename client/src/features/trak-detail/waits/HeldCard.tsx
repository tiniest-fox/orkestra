/**
 * The wait a resting trak is held behind, as a bordered block of its own under the
 * ending card, in the ending's own idiom.
 *
 * **The ending is untouched above it.** The trak is finished and its lead sentence says
 * so; this is a second region under that sentence rather than a rewrite of it, so every
 * press an ordinary finished trak has is still drawn and still works. What it adds is the
 * one thing a finished pane cannot otherwise say — that a step has not run, and when it is
 * next asked whether it may — and the one press that belongs to the wait rather than to
 * the ending: `SkipPress`, in the head row beside the countdown, which starts the held
 * step with its wait unmet.
 *
 * **A clock keeps the block's shape and changes its words.** The instant goes in the mono
 * slot where a condition's script name goes, the phrase says it is when the step runs,
 * and the corner is labelled for a start rather than for a next ask, counting to the
 * instant itself rather than to daemon memory. Once the instant is behind us the corner
 * goes and the head line carries the answer — the same move as `stopped` — because a
 * labelled *starts in · now* is a countdown pretending it still has something to count.
 * The plate wears an alarm clock, so the two kinds of wait are told apart at a glance.
 *
 * **`working` blue, never amber** — `waitTone` carries why, and the map's parked ending
 * row and its badge wear the same answer. Stopped, the tone goes `bad`, the glyph to a
 * minus, and the head line says *gave up* in the tone's ink. This reverses the rule the
 * card first shipped with — that a condition which gave up is not a failure and must not
 * draw like one, so it drew neutral. What a stop costs is that the held step will never
 * start by itself, and neutral read as nothing owed while the list drew the same trak
 * red; the decision is that a wait that has stopped asking reads *Gave up* in `bad`
 * everywhere it is drawn. The press is then the only way out, which is the state it
 * exists for.
 *
 * **The countdown is a labelled corner block at the head line's own size.** Not a larger
 * numeral — an expiry timer is the gate composition this pane forbids, and a clock does
 * not earn one either — and not a clause in the line, where a figure cannot read as a
 * deadline. It is gone at `stopped`, where the head line carries the answer, and gone
 * where the wire has no next ask to count to.
 *
 * `-mb-1` on that block is load-bearing: two lines measure 36px against the row's 32, so
 * without it the block sets the row's height and the fact row falls 4px further from the
 * head line than the gap says. The overhang is smaller than the gap beneath it.
 *
 * **The head row wraps.** At a desk it is one row; at a phone the corner and the press
 * drop to a line of their own rather than crushing the instant to two characters, and the
 * words keep a floor so they never do.
 */

import type { ReactNode } from "react"
import type { PlanDto, WaitingDto } from "../../../api/types"
import Plate from "../../../components/Plate"
import { toneInk } from "../../../format/tone"
import SkipPress from "./SkipPress"
import { useCountdown } from "./useCountdown"
import type { Skipping } from "./useSkipWait"
import {
  heldInstruction,
  spellLeft,
  waitFacts,
  waitGlyph,
  waitPhrase,
  waitSlot,
  waitTone,
} from "./waiting"

const HeldCard = ({
  waiting,
  nextAsk,
  plan,
  skipping,
}: {
  readonly waiting: WaitingDto
  /** `TrakDetailDto.nextAsk` — absent where nothing is scheduled. */
  readonly nextAsk: number | undefined
  readonly plan: PlanDto | undefined
  /** The press that starts the held step now, and why its last press did not land. */
  readonly skipping: Skipping
}): ReactNode => {
  const clock = waiting.until !== undefined
  // A clock counts to its own instant, which the wire always carries; a condition counts
  // to the daemon's next ask, which it carries only once the sweep has scheduled one.
  const left = useCountdown(waiting.stopped ? undefined : (waiting.until ?? nextAsk))
  const past = clock && left !== undefined && left <= 0
  const tone = waitTone(waiting)
  const Glyph = waitGlyph(waiting)
  const facts = waitFacts(waiting, plan)
  const instruction = heldInstruction(waiting, plan)

  return (
    <section
      aria-label={clock ? "Waiting on a time" : "Waiting on a condition"}
      className="flex min-w-0 flex-col gap-1.5 rounded-surface border border-border bg-surface px-4 py-3.5"
    >
      <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2">
        <span className="pt-0.5">
          <Plate tone={tone}>
            <Glyph size={14} aria-hidden />
          </Plate>
        </span>

        <span className="flex min-w-44 flex-1 flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-base text-fg">{waitSlot(waiting, Date.now())}</span>
          {/* The stop is said in the tone's ink, as the deploy block says its head word;
              every other phrase is a fact about a wait still being asked, and stays muted. */}
          <span className={`text-base ${waiting.stopped ? toneInk[tone] : "text-fg-muted"}`}>
            {waitPhrase(waiting, past)}
          </span>
        </span>

        <span className="ml-auto flex shrink-0 items-start gap-3">
          {left !== undefined && !past && (
            <span className="-mb-1 flex shrink-0 flex-col items-end gap-0.5">
              <span className="text-2xs uppercase tracking-wide text-fg-subtle">
                {clock ? "starts in" : "next ask"}
              </span>
              <span className={`font-mono text-base leading-5 ${toneInk[tone]}`}>
                {spellLeft(left)}
              </span>
            </span>
          )}
          {/* Level with the head line rather than with the countdown's figure. */}
          <span className="shrink-0 pt-0.5">
            <SkipPress skipping={skipping} />
          </span>
        </span>
      </div>

      {/* Indented past the plate so the head line is the only thing at the block's left
          edge — the move footer's own mono row, which is what makes this a block in the
          ending's family rather than a notice pasted onto it. */}
      <span className="flex flex-wrap items-baseline gap-x-2 pl-9 font-mono text-2xs text-fg-subtle">
        {facts.map((fact, i) => (
          <span key={fact} className="flex items-baseline gap-x-2">
            {i > 0 && <span aria-hidden>·</span>}
            <span>{fact}</span>
          </span>
        ))}
      </span>

      {/* Secondary by construction — last, muted, one line: the wait and the countdown
          are what the pane was asked for, and the step's words are what was not picked. */}
      {instruction !== undefined && (
        <span className="min-w-0 truncate pl-9 text-sm text-fg-muted">{instruction}</span>
      )}

      {/* What is on screen is still true, and a person who reads why the press did not
          land presses the same button again. */}
      {skipping.said !== undefined && (
        <span role="alert" className="min-w-0 pl-9 text-sm text-tone-bad">
          {skipping.said}
        </span>
      )}
    </section>
  )
}

export default HeldCard
