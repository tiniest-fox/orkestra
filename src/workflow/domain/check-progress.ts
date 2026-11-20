// Is the agent getting anywhere, or saying the same thing louder?
//
// A failed check sends the step back to fix its own work, which is the point —
// but nothing in "run it again" is bounded, and a check that cannot be satisfied
// would spend tokens forever with nobody watching. Two rules stop it, and they
// catch different things.
//
// **Two loops ask this, and they share the rules rather than the numbers.** A check
// failing at one position is one; a review complaining, a fix, and a review
// complaining again is the other, one turn further out — see `fixingIsNotLanding` in
// `attention.ts`. Both want *is this the same thing again* answered on the words rather
// than on the bytes, and both want a count behind it for the churn that normalizing
// cannot see.

import type { Correction } from "./outputs/correction.js"

/**
 * Every escape sequence a terminal understands, in three families.
 *
 * All three, and that is the point. CSI (`ESC [ … letter`) is the colour AND the
 * cursor moves; an OSC (`ESC ] … BEL|ST`) carries a window title or a hyperlink and
 * ends in a terminator rather than a letter; the two-byte escapes are the rest.
 * Taking only the colour leaves a cursor move printed as text, which is the failure
 * this exists to answer rather than a tidier version of it.
 */
// The escape byte is what an escape sequence starts with, so a pattern that could not
// name one could not find one.
// oxlint-disable-next-line eslint/no-control-regex -- matching control characters is the job
const ESCAPE = /\x1B\][\S\s]*?(?:\x07|\x1B\\)|\x1B\[[0-?]*[ -/]*[@-~]|\x1B[@-Z\\-_]/g

/**
 * The text a check printed, with the terminal's formatting taken out.
 *
 * A check inherits `FORCE_COLOR` from the process that spawns it, so some of what
 * reaches the event log is coloured: of what `pnpm verify` runs, tsc, the client build
 * and playwright colour their failures into a pipe, while oxfmt, oxlint, knip, `docs:check`
 * and vitest emit none. The log keeps the escapes deliberately, because the drawer renders
 * them; **every reader that wants words subtracts them itself**, and there are two: the
 * signature below, and the prompt that hands a failure back to the agent. Stripping is a
 * no-op on the plain half, so neither reader has to know which check it is looking at.
 */
export const stripAnsi = (text: string): string => text.replaceAll(ESCAPE, "")

/**
 * The one comparison: has this exact failure happened before?
 *
 * Normalized, because a report is not a string the way a hash is. A check that
 * lists three problems may list them in a different order on the next run, or
 * re-wrap them, without a single one having been fixed — so lines are trimmed,
 * their internal whitespace collapsed, blanks dropped, and the whole thing
 * SORTED. What survives is the set of things the check said.
 *
 * Digits deliberately survive too. "3 problems" becoming "1 problem" is real
 * progress and has to read as progress; stripping numbers to defeat line-number
 * churn would also erase that, and the limit below already covers churn.
 *
 * The check's name is part of the signature because with fail-fast a DIFFERENT
 * check failing means the agent got past the first one, which is progress by
 * definition.
 */
export const failureSignature = (name: string, output: string): string =>
  [
    name,
    ...stripAnsi(output)
      .split("\n")
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter((line) => line !== "")
      .sort(),
  ].join("\n")

/**
 * The same question over a round of complaints: is this what the round before said?
 *
 * **One complaint is one unit, where one line of a check's output is one.** A complaint
 * is prose an agent wrote, so a line break inside it says nothing — it is re-wrapping,
 * not a second claim, and splitting on it would make a re-worded paragraph read as a
 * different set of problems. So each text collapses to a single line and the
 * *complaints* are what get sorted, which is what makes two of them listed in the other
 * order compare equal. No ANSI to take out either: nothing here came from a terminal.
 *
 * **The document each complaint is against is deliberately not in it.** Every round
 * complains about the document the round before it wrote, so a signature carrying that
 * key would make the same complaint look new every single time, which is the failure
 * this exists to catch. The words are the claim; the key is only where to send it.
 *
 * It catches far less than a check's signature does, and that is why the count beside it
 * is not decoration: a compiler repeats itself verbatim and a reviewer rephrases. This
 * is the honest repeat; the count is for the rest.
 */
export const complaintSignature = (corrections: readonly Correction[]): string =>
  corrections
    .map((c) => c.text.trim().replace(/\s+/g, " "))
    .sort()
    .join("\n")

/**
 * The backstop, for what normalization cannot see.
 *
 * A check whose output carries a timestamp, an absolute temp path, or a line
 * number that shifts by one never repeats exactly, so "the failure changed"
 * stays true while nothing is being fixed. Counting is the only thing that
 * catches that, and it is why progress-detection alone is not enough.
 */
export const CHECK_FAILURE_LIMIT = 4
