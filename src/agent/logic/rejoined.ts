// logic: which transcript lines a rejoined turn has already written.
//
// A turn a restarted engine rejoins replays its command's output from the start, so the
// stream hands the provider every event the dead engine already recorded. The lines are
// keyed to a turn by nothing but where they sit, so they are matched by content instead:
// the lines after the first `Spawned` naming the exec, in order, against the lines the
// replay would write. The replay normalizes the same output the same way, so the two
// agree line for line until the dead engine's record ends; a line that differs ends the
// matching there, and from then on every line is written — a line twice is the cheap
// direction to be wrong in, a line lost the expensive one.

import type { TranscriptEntry } from "../types/transcript-entry.js"

/**
 * Lines the engine writes about a turn rather than reads off its stream — the spawn, a
 * re-ask, a message the model read, a view kept, a check run. A replay does not write
 * them in the same places, so they are neither matched nor skipped.
 */
const BESIDE_THE_STREAM: ReadonlySet<TranscriptEntry["_tag"]> = new Set([
  "Spawned",
  "Reask",
  "Said",
  "View",
  "Check",
])

/** Every key sorted, at every depth, so two equal lines print the same. */
const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, inner]) => [key, sorted(inner)]),
  )
}

/** The line without where and when it was written, which a replay never matches. */
const content = (entry: TranscriptEntry): string => {
  const { position: _position, at: _at, ...rest } = entry
  return JSON.stringify(sorted(rest))
}

/** The lines exec `execId`'s stream already put on the transcript, in order. */
export const writtenBy = (
  entries: readonly TranscriptEntry[],
  execId: string,
): readonly TranscriptEntry[] => {
  const start = entries.findIndex((e) => e._tag === "Spawned" && e.execId === execId)
  return start < 0 ? [] : entries.slice(start + 1).filter((e) => !BESIDE_THE_STREAM.has(e._tag))
}

/**
 * One line of a rejoined turn against `written`, `matched` of which the replay has passed:
 * whether it is skipped, and how many are passed after it. `matched` at the end of
 * `written` writes every line.
 */
export const rejoinedLine = (
  written: readonly TranscriptEntry[],
  matched: number,
  line: TranscriptEntry,
): { readonly skip: boolean; readonly matched: number } => {
  if (matched >= written.length || BESIDE_THE_STREAM.has(line._tag)) return { skip: false, matched }
  const next = written[matched]
  return next !== undefined && content(next) === content(line)
    ? { skip: true, matched: matched + 1 }
    : { skip: false, matched: written.length }
}
