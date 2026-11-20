import type { ApiRetryEntryDto, ToolEntryDto, TranscriptEntryDto } from "../api/types"
import { shortId } from "./ids"
import { deniedText } from "./denied"

/**
 * Whether this kind's detail is a **path**, and so is informative at its end.
 *
 * A 120-character absolute path into a worktree is worth reading from the right —
 * `…/features/trak-detail/family/rows.ts` — and ordinary truncation throws away exactly that.
 * A shell command is the opposite: `git log --all --oneline | grep …` says what it did,
 * and truncating from the left turns it into `…cho ---; git log`. So the direction is a
 * fact about the kind, not a setting, and getting it wrong is only visible in a picture.
 */
export const keepsTail = (kind: ToolEntryDto["kind"]): boolean =>
  kind !== "Bash" && kind !== "Grep" && kind !== "Glob" && kind !== "WebSearch"

/**
 * The provider retrying, in words: `retrying · 429 · attempt 2 of 5`.
 *
 * One formatter rather than one per surface, because the attempt count is the whole of
 * what this entry says and two surfaces disagreeing about it is worse than either.
 *
 * The status is dropped when the provider reports none — a transport failure has no HTTP
 * status, and `retrying · undefined` would read as a fact.
 */
export const retryText = (entry: ApiRetryEntryDto): string =>
  `retrying${entry.status === undefined ? "" : ` · ${entry.status}`} · attempt ${entry.attempt} of ${entry.of}`

/**
 * How long something has been going, in the two coarsest units still true of it: `31s`,
 * `1m 52s`, `1h 12m`.
 *
 * Seconds, where `finished.ts` rounds a whole trak to the minute. That one stands beside
 * *5 steps* as a sense of scale; this one is a single call a person is waiting on, and
 * *under a minute* is the answer for almost all of them — so the second is the unit the
 * number has to live in or the column says nothing on most rows.
 *
 * **`undefined` where the engine stamped no time**, which is every line written before
 * the stamp existed: a row with no duration reads as *we do not know*, and a `0s` there
 * would read as *it was instant*. Also `undefined` for a stamp in the future, which is
 * the browser's clock and the engine's disagreeing rather than a negative duration.
 */
export const elapsedText = (from: number | undefined, now: number): string | undefined => {
  if (from === undefined || now < from) return undefined
  const seconds = Math.floor((now - from) / 1000)
  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`
}

/**
 * The agent's words without the envelope it filed, or `undefined` when the envelope
 * was all they were.
 *
 * **The string is subtracted, not recognised.** `envelope` is the exact slice the
 * engine's extractor took, carried out on the event that ended the turn — so what a
 * person sees drop out of the log is precisely what the engine consumed, and no
 * second scanner here has to agree with it about fences. A turn that reported none
 * has its text drawn whole, which is the direction to be wrong in: a malformed
 * envelope and a turn that answered in prose are the ones worth reading.
 *
 * `undefined` means *draw nothing here*, which both callers want: a log row that held
 * only the JSON is dropped rather than left as an empty bubble, and a trak whose
 * newest line is the envelope shows no activity rather than a blank one. The card
 * below already says what was filed.
 *
 * Whatever surrounds the envelope survives — the paragraph it was appended to, and
 * the sign-off written after it.
 */
export const withoutEnvelope = (text: string, envelope: string | undefined): string | undefined => {
  if (envelope === undefined) return text
  const at = text.indexOf(envelope)
  if (at === -1) return text
  const rest = `${text.slice(0, at)}${text.slice(at + envelope.length)}`
  return rest.trim() === "" ? undefined : rest
}

/**
 * One transcript entry as one string.
 *
 * For the places that can only hold a string — a row's `title`, a single line in a
 * fixed slot. The drawer draws the same entry as two styled halves, and the two are
 * different jobs for the same reason `eventLine` and the store's entries are: only one
 * of them can put the tool's name and the path it touched in different columns.
 *
 * A `Text` comes back whole: the envelope a turn filed is taken out before this is asked,
 * by `withoutEnvelopes`, which drops the entry that held nothing else.
 */
export const activityText = (entry: TranscriptEntryDto): string => {
  switch (entry._tag) {
    case "Tool":
      // An MCP call's detail is `server/tool`, which is all its name would say again.
      if (entry.kind === "Mcp" && entry.detail !== undefined) return entry.detail
      return entry.detail === undefined ? entry.name : `${entry.name} ${entry.detail}`
    case "View":
      return `${entry.server}/${entry.tool}`
    case "Check":
      return `${entry.server}/${entry.tool} ${entry.name}`
    case "Hook":
      return `${entry.event} hook`
    case "Denied":
      return `${entry.tool} ${deniedText(entry)}`
    case "Spawned":
      return `Spawned(pid=${entry.pid})`
    case "Reask":
      return `Asked again — ${entry.reason}`
    case "Session":
      return `SessionStarted(${shortId(entry.id)})`
    // The job rather than the agent type: this is a single line in a fixed slot, and
    // `general-purpose` is the same word on every delegation a fleet makes.
    case "Subagent":
      return `Delegated ${entry.description ?? entry.agentType ?? "to a subagent"}`
    case "SubagentResult":
      // `stopped` before either reading of `ok`: a stopped task reads as a success
      // through `ok` alone, and this slot must not present it as one.
      return entry.outcome === "stopped"
        ? "A task was stopped"
        : entry.ok
          ? "A subagent answered"
          : "A subagent failed"
    case "Background":
      return entry.tasks.length === 0
        ? "No background work running"
        : `${entry.tasks.length} background ${entry.tasks.length === 1 ? "job" : "jobs"} running`
    case "BackgroundStarted":
      return `Backgrounded ${entry.description ?? entry.taskId}`
    case "ApiRetry":
      return retryText(entry)
    case "Text":
      return entry.text
    // A person's words, as a row's one line says the agent's.
    case "Said":
      return entry.text
    case "Note":
      return entry.text
  }
}
