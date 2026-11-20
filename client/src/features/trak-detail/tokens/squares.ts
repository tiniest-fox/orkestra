/**
 * The arithmetic of the chat bar's footer: how many squares a step's spend fills, and what
 * tone a context reading is drawn in.
 *
 * **A full row is 20m at every width, and the square is what changes.** The row holds as
 * many 6px squares as fit, and each is worth 20m over that count, so one step fills the
 * same fraction of the row at a desk and on a phone. 20m sits between p90 (13.5m) and p95
 * (22.1m) of 986 agent steps in this project's log, which is why a full row reads as a big
 * step. It is a constant on purpose: the percentiles justified the value once and do not
 * recompute it.
 *
 * Kind `pure`, with the whole literal classes a reading is drawn in — `usage.ts` says why
 * a class assembled at runtime draws nothing.
 */

/** What a full row of squares is worth, in tokens. */
export const FULL_ROW = 20_000_000

/** A square's side and the gap after it, in CSS px — `size-1.5` and `gap-0.5`. */
const SQUARE = 6
const GAP = 2

/** How many squares a track this wide holds. Never zero, so a square is always worth something. */
export const fitting = (width: number): number =>
  Math.max(1, Math.floor((width + GAP) / (SQUARE + GAP)))

export interface Squares {
  /** Squares drawn solid. */
  readonly whole: number
  /** How much of the next square is filled, 0 up to 1; `0` draws no partial square. */
  readonly part: number
  /** Spend over a full row, as a multiple of it; `undefined` while the row is not full. */
  readonly times: number | undefined
}

/** `spent` laid over a row of `fit` squares. Past a full row the row stays full. */
export const squares = (spent: number, fit: number): Squares => {
  if (spent > FULL_ROW) return { whole: fit, part: 0, times: spent / FULL_ROW }
  const exact = (spent / FULL_ROW) * fit
  const whole = Math.min(fit, Math.floor(exact))
  return { whole, part: whole < fit ? exact - whole : 0, times: undefined }
}

/** A context reading as a whole percentage of its window, or `undefined` where no window is known. */
export const percentOf = (used: number, ceiling: number | undefined): number | undefined =>
  ceiling === undefined || ceiling === 0 ? undefined : Math.round((used / ceiling) * 100)

/** The spend row's squares' fill, which the context line's fill takes below 70%. */
export const SQUARE_INK = "bg-source-human/70"

/**
 * The context line's fill and the label's ink for a reading: the spend row's squares' ink
 * below 70%, amber from 70%, red from 90% — the thresholds `TokenHead` draws its
 * percentage at.
 */
export const fullness = (pct: number): { readonly bar: string; readonly ink: string } => {
  if (pct >= 90) return { bar: "bg-tone-bad", ink: "text-tone-bad" }
  if (pct >= 70) return { bar: "bg-tone-waiting", ink: "text-tone-waiting" }
  return { bar: SQUARE_INK, ink: "text-fg-subtle" }
}
