/**
 * The agent stopping to think, at the end of the turn that is still going.
 *
 * **Drawn once, and only where it is still true.** Every pause ends the run behind it, but
 * dots that animate say *it is thinking now* — so a log that drew one per pause was six
 * agents thinking at once, five of them hours ago. `withoutEndedPauses` is what decides
 * which one survives, and it is the caller's fact rather than this component's: nothing
 * here can tell a wait that is going on from one that ended.
 *
 * **The name is the provider's own summary of the pass where it gave one, and the word
 * `Thinking` where it did not.** Codex writes a header per reasoning part — *Planning file
 * size counting method* — and that is the more meaningful name for the dots than the word,
 * which only says what the dots already say. It is a live explanation and not a record:
 * the calls either side are the log, and this row is what is happening between them right
 * now, so it goes with the dots and is dropped with them. The summary truncates, so a
 * model that returns a sentence rather than a header degrades to a clipped line instead of
 * breaking the column.
 *
 * **A pause is the one thing in this log that is not an event.** Every other row says
 * something happened — a call, a message, a check. This says the opposite, which is why it
 * is a mark and its name rather than a sentence: a row of prose among rows of prose reads
 * as a thing the agent *did*, and the eye stops on it as if it were work.
 *
 * It carries no count, no duration and no token estimate — `runtime.ts` collapses a burst
 * of ticks into one stored line and the number on it is an estimate of tokens nobody spent
 * deciding anything about, so a row showing one would be precision about the least
 * consequential thing on the screen.
 *
 * **The animation is `styles.css`'s and the stagger is here**, because it is per dot and
 * the token is one motion. `motion-reduce:animate-none` leaves three dots at the trough,
 * which still reads as a pause — the shape is the message and the movement is the hint.
 *
 * **The name goes exactly where the dots do.** The two are one element — a visible word
 * and a hidden one saying the same thing would be twice — and the name makes the dots'
 * claim: a row that has stopped asserting the agent is thinking must not go on saying
 * what it was thinking about, in either place.
 *
 * **A retry is absorbed into the pause it interrupted rather than drawn beside it.** The
 * provider's HTTP call failed and it is trying again; nothing the agent did failed, and
 * from the agent's side the whole of what happened is that the wait got longer. So it is
 * this row, in `tone-waiting` — the ink that means *something is owed before this can go
 * on* — and never `tone-bad`, which on every other row of this log means a tool call came
 * back non-zero. The reason follows the row's name in words of its own, because neither
 * the dots nor the name can say `attempt 2 of 5` and a reader watching a turn stall is
 * owed it.
 *
 * It is also the one pause that draws after it has ended, and it draws **without the dots
 * or their name**: the retry's words are the only record that the provider retried at all,
 * where the dots and the name on them are a claim about right now. So an ended retry keeps
 * its row, its waiting ink, its words and its height, and gives up the parts of it that
 * were still asserting something — which on a finished turn is otherwise the one thing
 * moving on the screen.
 */

import type { ReactNode } from "react"

/* Whole literal class names. An assembled one emits no CSS at all — see `styles.css`. */
const DOT = "size-0.5 rounded-pill animate-thinking motion-reduce:animate-none"
const QUIET = `${DOT} bg-fg-subtle`
const WAITING = `${DOT} bg-tone-waiting`

const Thinking = ({
  text,
  retry,
  ended = false,
}: {
  /** What the model said it was working out, where the provider gave a summary — the dots' name in place of the word. */
  readonly text?: string
  /** What the provider is retrying, in words, where it retried during this pause. */
  readonly retry?: string
  /**
   * Whether the wait this row stands for is over.
   *
   * True only of a retry, which is the one pause drawn after its own ending — every other
   * one is dropped by then, so the default is the answer everywhere else. `ActivityGroup`
   * is handed the turn's custody and is what decides it; a row cannot tell from its own
   * contents whether anything is still driving the turn it sits in.
   */
  readonly ended?: boolean
}): ReactNode => {
  const dot = retry === undefined ? QUIET : WAITING
  const ink = retry === undefined ? "text-fg-subtle" : "text-tone-waiting"
  return (
    // `gap-0.5` at this size, or three dots 4px apart read as three marks rather than one.
    <span className="flex h-4 min-w-0 items-center gap-0.5">
      {/* `h-4` on the row and the dots centred in it, so a pause takes exactly the line
          every other row takes and the column does not open a gap around it. The height is
          the row's rather than the dots', so losing them moves nothing. */}
      {ended ? undefined : (
        <>
          <span aria-hidden className={dot} />
          <span aria-hidden className={`${dot} [animation-delay:160ms]`} />
          <span aria-hidden className={`${dot} [animation-delay:320ms]`} />
        </>
      )}
      {/* The dots' ink, not an ink of its own: during a retry they go to waiting, and a
          word left subtle beside them would read as two things on one row. `ml-2` is the
          same separation the retry's own words take, so the three parts of a retrying
          pause are one rhythm rather than two. The bare word is `shrink-0` because it is
          the row's name and what truncates is the retry text after it; a summary
          truncates itself, because it can be a sentence and the row is one line. */}
      {ended ? undefined : (
        <span
          className={`ml-2 font-mono text-xs ${ink} ${
            text === undefined ? "shrink-0" : "min-w-0 truncate"
          }`}
        >
          {text ?? "Thinking"}
        </span>
      )}
      {retry === undefined ? undefined : (
        // `ml-2` separates these words from the row's name, so it goes only where that
        // name is — on an ended retry they are the whole row.
        <span
          className={`min-w-0 truncate font-mono text-xs text-tone-waiting ${ended ? "" : "ml-2"}`}
        >
          {retry}
        </span>
      )}
    </span>
  )
}

export default Thinking
