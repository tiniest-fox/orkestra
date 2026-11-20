// types: one line of a turn's transcript, with the structure a reader needs kept.

import { Schema } from "effect"
import { Place } from "./place.js"
import { ACTIVITY_KINDS, HOOK_STATUSES, TASK_OUTCOMES } from "./provider-event.js"

/**
 * The plan position whose turn wrote this line, and `"composer"` for the turn
 * that has none — the composer is not a step.
 *
 * **`"composer"` rather than leaving the field off**, because absence already
 * means something else here: a line written before this field existed. A turn
 * with no position and a line from an older transcript are different facts, and
 * a reader that could not tell them apart would file the composer's work under
 * whatever it guessed. See `TranscriptEntry`.
 */
export const TurnPosition = Schema.Union(Schema.Number, Schema.Literal("composer"))
export type TurnPosition = Schema.Schema.Type<typeof TurnPosition>

/**
 * Spread into every entry, the way `recorded` is spread into every `Event`.
 *
 * Optional, which is the whole of the compatibility story: every
 * `transcript.jsonl` already on disk decodes unchanged, and
 * `exactOptionalPropertyTypes` keeps absent absent through a round trip. No
 * version field, no migration, nothing to rewrite.
 */
const ran = { position: Schema.optional(TurnPosition) }

/**
 * The delegation this line was written inside, and absent on the agent's own lines.
 *
 * The provider's own opaque id, carried rather than interpreted — the same category as a
 * `SessionId`. It is the only handle that joins a subagent's reads and commands to the
 * call that asked for them, and inferring the join from arrival order is exactly what a
 * subagent running in the background breaks.
 *
 * Optional for the reason `position` is: every `transcript.jsonl` already on disk decodes
 * unchanged, with every line reading as the agent's own — which is what it was.
 */
const sidechain = { parent: Schema.optional(Schema.String) }

/**
 * When this line was appended, epoch milliseconds — the same field `recorded` is on an
 * `Event`, one tier down.
 *
 * **Stamped where the transcript is appended, never by `entryOf`.** The time a line was
 * written is a fact about writing it; `agent/` normalizes a stream and has no clock, and
 * a clock reached for there would be a second source for the same number.
 *
 * It is what makes an elapsed time a stored fact: a duration is the gap between two of
 * these, so it is right for a call that has already ended and does not depend on the
 * provider emitting a heartbeat for the call at all.
 *
 * Optional for the reason `position` is — every `transcript.jsonl` already on disk has
 * none, and a row that says nothing about how long it took beats one that says zero.
 */
const stamped = { at: Schema.optional(Schema.Number) }

/**
 * Where a turn began. One `claude`, one turn — which is what cuts a flat transcript
 * back into turns without matching a rendered prefix.
 *
 * `execId` is the runner's id for a command in a sandbox. A turn a restarted engine
 * rejoins writes a second `Spawned` with the same one, and the lines after the first are
 * the ones it does not write again.
 *
 * `place` is where the turn ran, and absent on a line written before it was recorded.
 */
export const SpawnedEntry = Schema.TaggedStruct("Spawned", {
  pid: Schema.Number,
  execId: Schema.optional(Schema.String),
  place: Schema.optional(Place),
  ...ran,
  ...stamped,
})

/**
 * The answer was unusable and the same ask went again on the same session.
 *
 * **A turn boundary that is not one.** `elicit` re-prompts by resuming, which spawns a
 * second `claude` — so the `Spawned` after this one continues the turn rather than
 * starting it, and the whole loop files one ending in the log. This is the only thing
 * that says so, and it is structured for the reason `Spawned` is: a reader that had to
 * match a rendered prefix to know it would make the display the source.
 */
export const ReaskEntry = Schema.TaggedStruct("Reask", {
  reason: Schema.String,
  ...ran,
  ...stamped,
})

/** The session that turn ran in — the join a line with no position falls back on. */
export const SessionEntry = Schema.TaggedStruct("Session", {
  id: Schema.String,
  ...ran,
  ...stamped,
})

/**
 * One tool call, as the activity it performed.
 *
 * `detail` is stored whole. How much of a 1 KB command fits is a question about a pane,
 * and a store that truncated would answer it once for every surface.
 */
export const ToolEntry = Schema.TaggedStruct("Tool", {
  /** The provider's own — `Read`, `Bash`, `mcp__linear__issue`. */
  name: Schema.String,
  kind: Schema.Literal(...ACTIVITY_KINDS),
  detail: Schema.optional(Schema.String),
  /** The command behind a `detail` that is not it — see `ProviderEvent.ToolUse`. */
  command: Schema.optional(Schema.String),
  /**
   * This call's own id, which is what a `Subagent` points at. Carried on every call
   * rather than on delegations alone: it is one short string, and a rule that kept it
   * only where something reads it today would have to be revisited by whoever needs the
   * next join.
   */
  call: Schema.optional(Schema.String),
  /**
   * The agent asked for this call with `run_in_background` and carried on without
   * waiting for it.
   *
   * On the call rather than on `Subagent`, because `Bash` takes the same key: this is a
   * fact about how a tool was invoked, not about delegation. It is the only thing on
   * the wire that says a delegation was detached, which is the difference between a
   * subagent the turn is blocked on and one it is not.
   *
   * Absent means inline, which is what every call already on disk was.
   */
  backgrounded: Schema.optional(Schema.Boolean),
  ...sidechain,
  ...ran,
  ...stamped,
})

/**
 * Everything else, as `eventLine` writes it: a result, a usage report, a rate-limit
 * notice, an unrecognised stream kind. Prose, because what a surface does with one of
 * these is draw it.
 *
 * **`call` is the one structured field, and it is here for the one note that is a call's
 * own outcome** — a `ToolResult`, whose row is the row of the call it answers rather than
 * one of its own. Without it a surface has to count outcomes against calls, which is wrong
 * as soon as two calls are open at once. `parent` is on this entry for the same shape of
 * reason.
 *
 * Absent on every other note, and on every outcome written before the provider carried the
 * id — so a reader keeps a rule for an outcome that names no call.
 */
export const NoteEntry = Schema.TaggedStruct("Note", {
  text: Schema.String,
  call: Schema.optional(Schema.String),
  ...sidechain,
  ...ran,
  ...stamped,
})

/**
 * What the agent said on its way to an answer, whole.
 *
 * **A tag rather than a `Note`, because the two are folded differently.** A `Note` is
 * the engine talking *about* the turn and the client hides it by default; this is the
 * agent's own words, which is the one thing in a transcript nothing else records. Stored
 * as a `Note` it read as `TextDelta(482 chars)` and was folded away with the
 * bookkeeping, so the longest stretch of a turn had nothing in it anybody could read.
 *
 * It is the reason a transcript can cost real disk: a turn's narration is kept in full,
 * where every other entry is a line. That is the trade — see `eventLine`, which still
 * writes the count for the places that want one.
 */
export const TextEntry = Schema.TaggedStruct("Text", {
  text: Schema.String,
  ...sidechain,
  ...ran,
  ...stamped,
})

/**
 * A delegation, and the head everything a subagent did hangs off: `call` is the tool call
 * that handed the work over, and every line the subagent writes carries it as `parent`.
 *
 * **A tag of its own for the reason `Text` is one.** A `Note` is the engine talking about
 * the turn and a surface folds it away by default, which here would take the group's
 * identity with it.
 *
 * `prompt` is the brief the subagent was given, kept here so it is attributed to the call
 * rather than stored as the parent agent's own narration — which is what it looked like
 * when the only record of it was the `user` line echoing it back.
 *
 * `agentType` and `description` are optional because the provider's bracket line is a
 * status broadcast; a delegation that says less is still a delegation.
 */
/**
 * A message a person sent while the turn ran, at the moment the model received it —
 * `ProviderEvent.MessageDelivered`. The words whole, for `TextEntry`'s reason: this is
 * the only place in the turn's own sequence that says what the agent was told, and
 * where. Never inside a delegation: a person speaks to the turn's own agent.
 */
export const SaidEntry = Schema.TaggedStruct("Said", {
  text: Schema.String,
  ...ran,
  ...stamped,
})

export const SubagentEntry = Schema.TaggedStruct("Subagent", {
  call: Schema.String,
  agentType: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  ...ran,
  ...stamped,
})

/**
 * What a subagent answered, for the `call` that asked.
 *
 * Separate from `Subagent` rather than a `phase` field on it: the two carry different
 * facts and are read at different times — one heads a group the moment work starts, the
 * other closes it minutes later — and one struct holding both would be a bag of optionals
 * where every field is absent half the time.
 *
 * `summary` is the subagent's return value, which reaches nothing else a trak keeps.
 */
export const SubagentResultEntry = Schema.TaggedStruct("SubagentResult", {
  call: Schema.String,
  ok: Schema.Boolean,
  summary: Schema.optional(Schema.String),
  /**
   * The report's own word where it is one of the three every surface knows. `stopped`
   * is the one `ok` cannot say — it guesses a stopped task into success — and absent
   * degrades a reader to that guess, which is what every line already on disk gets.
   */
  outcome: Schema.optional(Schema.Literal(...TASK_OUTCOMES)),
  /** The provider's task handle — the join onto `Background`, and absent on old lines. */
  taskId: Schema.optional(Schema.String),
  ...ran,
  ...stamped,
})

/**
 * The set of background tasks alive at the moment this line was written — the level,
 * stored on change.
 *
 * **One row per change of set, not per frame.** The level has REPLACE semantics, so a
 * row supersedes every row before it, and the last one in a turn is what was outstanding
 * when that turn ended. The runtime skips a frame whose set matches the row already
 * written — teardown reports each task's stop in a same-millisecond burst — which is the
 * same burst rule `Thinking` follows.
 *
 * A tag rather than a `Note`, because it is state a surface folds, never a row a person
 * reads: the live list at the input bar is drawn from it, and a transcript draws no
 * frozen record of it.
 */
export const BackgroundEntry = Schema.TaggedStruct("Background", {
  tasks: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      taskType: Schema.optional(Schema.String),
      description: Schema.optional(Schema.String),
    }),
  ),
  ...ran,
  ...stamped,
})

/**
 * A backgrounded task registering: `taskId` is the handle the `Background` sets and the
 * stop control speak, `call` is the tool call that started it. The only join between
 * the two vocabularies, written the moment the work goes outstanding — so a surface can
 * say which call an outstanding task belongs to without waiting for its report.
 *
 * Not written for an inline task: one registers too, and a row per slow `pnpm verify`
 * would say nothing. Written for a backgrounded delegation as well as a shell command,
 * because `Subagent` carries no task id.
 */
export const BackgroundStartedEntry = Schema.TaggedStruct("BackgroundStarted", {
  taskId: Schema.String,
  call: Schema.String,
  description: Schema.optional(Schema.String),
  ...ran,
  ...stamped,
})

/**
 * The provider's HTTP call failed and it is going again — one line per attempt.
 *
 * **A tag rather than a `Note`, because a surface has to place it.** It belongs on the
 * pause it interrupted, drawn as waiting rather than as an error, and the note protocol
 * is a `text.startsWith` prefix match — a fourth prefix there would make the rendering
 * the source of a fact about the stream.
 *
 * Named for `ApiError`, which is the same failure once it has stopped being recoverable.
 * Not for `Reask`: that is the schema retry, where the call succeeded and the answer was
 * unusable.
 *
 * `of` is the provider's own ceiling, so a surface can say *attempt 2 of 5* without
 * knowing the retry policy. `status` is absent when the provider reports none — a
 * transport failure has no HTTP status — and `waitedMs` is the wait before the next try.
 */
export const ApiRetryEntry = Schema.TaggedStruct("ApiRetry", {
  attempt: Schema.Number,
  of: Schema.Number,
  status: Schema.optional(Schema.String),
  waitedMs: Schema.optional(Schema.Number),
  ...ran,
  ...stamped,
})

/**
 * An MCP tool's view was kept for the call `call` — the HTML, the call's arguments and
 * its result are in the store beside this file, under that id. The line carries only
 * where the view came from, which is what a surface names it by.
 *
 * Written by the runtime once the view is stored, never from a provider event: no line
 * of a CLI's stream says a view exists. So it lands a moment after the call's own
 * outcome, and a reader joins the two on `call`.
 */
export const ViewEntry = Schema.TaggedStruct("View", {
  call: Schema.String,
  server: Schema.String,
  tool: Schema.String,
  uri: Schema.String,
  ...ran,
  ...stamped,
})

/**
 * A check the engine ran for the call `call`, through its own check tool: which check,
 * and how it came out. Written by the runtime when the call is taken and again when it
 * answers, so the newest line for a call says where it stands — `outcome` absent while
 * it is queued or running. `server` and `tool` are the call's, which is how a reader
 * finds the call when the CLI gave the engine no id for it.
 *
 * `unrecorded` is a pass the files moved under, and `ended` a run the turn's end
 * interrupted: neither is a verdict on the work.
 */
export const CheckEntry = Schema.TaggedStruct("Check", {
  call: Schema.String,
  server: Schema.String,
  tool: Schema.String,
  name: Schema.String,
  outcome: Schema.optional(Schema.Literal("passed", "unrecorded", "reused", "failed", "ended")),
  ...ran,
  ...stamped,
})

/**
 * A hook the CLI ran, once it finished — `ProviderEvent.HookRan`. `call` is the tool
 * call it ran for, read off the provider's own id for the run and confirmed by nothing:
 * a surface joins it to the call on `call` and draws it there, and owes a rule for one
 * naming no call it holds. A tag rather than a `Note`, because the status is what a
 * surface colours by and a prefix match would make the rendering the source.
 */
export const HookEntry = Schema.TaggedStruct("Hook", {
  call: Schema.optional(Schema.String),
  event: Schema.String,
  status: Schema.Literal(...HOOK_STATUSES),
  durationMs: Schema.optional(Schema.Number),
  source: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  output: Schema.Array(Schema.Struct({ kind: Schema.String, text: Schema.String })),
  ...ran,
  ...stamped,
})

/**
 * A tool call the CLI refused without asking anyone — `ProviderEvent.PermissionDenied`.
 * `call` is the denied call, which a surface draws it on; `reason` is the rule that
 * refused it and `source` the kind of thing that did, both as the provider wrote them.
 */
export const DeniedEntry = Schema.TaggedStruct("Denied", {
  call: Schema.optional(Schema.String),
  tool: Schema.String,
  reason: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  ...ran,
  ...stamped,
})

/**
 * What the store keeps per normalized provider event.
 *
 * **Sixteen tags, not one per event kind.** `Tool` is the one a person reads a transcript
 * for, `Text` is the only record of what the agent said, `Subagent`/`SubagentResult`
 * bracket work the agent did not do itself, `Background`/`BackgroundStarted` carry what
 * is outstanding and whose it is, `ApiRetry` says a pause is the provider retrying
 * rather than the agent thinking, `View` says a call left a view in the store, `Check` says one ran a check, `Hook` says a hook ran around one, `Denied` says the CLI refused one, and `Spawned`/`Reask`/`Session` are structured because
 * the turn-splitting in the client is a fact about the stream rather than about a string
 * — recovering any of them by matching a rendered prefix makes the display the source.
 *
 * **Flat, with ids, rather than a `Subagent` holding its children.** The transcript is
 * append-only JSONL and one event is one line, so a nested entry could only be written
 * once the subagent had finished — and the whole point is watching it while it runs.
 *
 * **Every one of them carries `position` and `at`, not just `Spawned`.** One `claude` is one
 * turn, so the first entry would in principle be enough — but `Spawned` is only
 * emitted on some paths, and a turn that dies before the process exists carries
 * nothing at all. Spreading it costs a few bytes on a file whose `detail` holds whole
 * shell commands, and makes the stamp visible wherever a reader happens to look.
 *
 * `agent/` cannot fill it in: it runs turns and knows nothing about a plan. The
 * runtime stamps it from the command, which is the one thing the stream cannot say.
 */
export const TranscriptEntry = Schema.Union(
  SpawnedEntry,
  ReaskEntry,
  SessionEntry,
  ToolEntry,
  TextEntry,
  SaidEntry,
  SubagentEntry,
  SubagentResultEntry,
  BackgroundEntry,
  BackgroundStartedEntry,
  ApiRetryEntry,
  ViewEntry,
  CheckEntry,
  HookEntry,
  DeniedEntry,
  NoteEntry,
)
export type TranscriptEntry = Schema.Schema.Type<typeof TranscriptEntry>

export const decodeTranscriptEntry = Schema.decodeUnknown(TranscriptEntry)
export const encodeTranscriptEntry = Schema.encode(TranscriptEntry)
