// The transcript — what an agent did, one entry per provider event — and waiting messages. Part of the wire contract;
// `common.ts` says how the slices fit together.

import { Schema } from "effect"
import { AttachmentDto } from "./attachments.js"
import { PlaceDto } from "./log.js"

// ============================================================================
// The transcript — what the agent did, one entry per normalized provider event
// ============================================================================

/**
 * A tool call, as the activity it performed.
 *
 * `name` is the provider's own — `Read`, `Bash`, `mcp__linear__issue` — and is what a
 * row shows, because it is the word a person watching that CLI saw. `kind` is the
 * normalized vocabulary the client styles and groups by, drawn from where Claude and
 * OpenCode already agree; `Other` is every tool nothing classifies and is not an error.
 *
 * `detail` crosses whole, untruncated: how much of a 1 KB command fits is a decision
 * each surface makes, and the wire making it once would make the narrow surface win.
 */
/**
 * The plan position whose turn wrote this line, `"composer"` for the turn that
 * has none, and absent on a line written before the engine stamped one.
 *
 * Three states rather than two, because they are three facts. A reader that
 * cannot tell "the composer" from "unstamped" would file the composer's work
 * under a guess; the client places an unstamped line by joining its session onto
 * the log instead, which is right for every turn that has ended.
 */
const ran = { position: Schema.optional(Schema.Union(Schema.Number, Schema.Literal("composer"))) }

/**
 * The delegation this line was written inside, and absent on the agent's own lines.
 *
 * One opaque provider string, the same category as a session id, and the only thing a
 * surface can group a subagent's work by — a subagent running in the background
 * interleaves with its parent, so arrival order says nothing about who did what.
 */
const sidechain = { parent: Schema.optional(Schema.String) }

/**
 * When the engine appended this line, epoch milliseconds — the same field an `EventDto`
 * carries, on the tier below it.
 *
 * It is what a surface draws an elapsed time from: the gap between a call and what
 * followed it, or between a call still open and now. A duration computed this way is
 * right for a call that has already finished, where a provider's progress heartbeat only
 * ever describes one that has not.
 *
 * Absent on every line written before the engine stamped one, and a row with no duration
 * has to read as *we do not know* rather than as *it was instant*.
 */
const stamped = { at: Schema.optional(Schema.Number) }

export const ToolEntryDto = Schema.TaggedStruct("Tool", {
  name: Schema.String,
  kind: Schema.Literal(
    "Bash",
    "Read",
    "Edit",
    "Write",
    "Grep",
    "Glob",
    "WebSearch",
    "WebFetch",
    "Todo",
    "Task",
    "Mcp",
    "Other",
  ),
  detail: Schema.optional(Schema.String),
  /**
   * The command behind a `detail` that is not it: a shell call the agent described, whose
   * description is the `detail`. Absent wherever `detail` is the command already.
   */
  command: Schema.optional(Schema.String),
  /** This call's own id — what a `Subagent` entry's `call` points at. */
  call: Schema.optional(Schema.String),
  /**
   * The call was detached: the agent asked for it with `run_in_background` and went on
   * without its answer.
   *
   * On a call rather than on `Subagent`, because a shell command takes the same key —
   * this says how a tool was invoked, not what kind of tool it was. It is the one thing
   * on the wire that tells a delegation the turn is waiting on from one it is not.
   *
   * Absent means inline.
   */
  backgrounded: Schema.optional(Schema.Boolean),
  ...sidechain,
  ...ran,
  ...stamped,
})
export type ToolEntryDto = Schema.Schema.Type<typeof ToolEntryDto>

/**
 * The entries that are not a tool call. `Spawned` starts a turn — one CLI, one turn —
 * and `Session` names the conversation it ran in, which is the join onto the step that
 * owns it. Both, and `Reask` below, are structured rather than prose so the client cuts
 * a transcript into turns from a fact rather than from a rendered prefix.
 */
export const SpawnedEntryDto = Schema.TaggedStruct("Spawned", {
  pid: Schema.Number,
  /** Where the turn ran. */
  place: Schema.optional(PlaceDto),
  ...ran,
  ...stamped,
})
export type SpawnedEntryDto = Schema.Schema.Type<typeof SpawnedEntryDto>

/**
 * The answer was unusable and the same ask went again on the same session.
 *
 * **The exception to one CLI, one turn**, and the only thing that says so: the resume
 * spawns a second CLI, so a `Spawned` following this one continues the turn instead of
 * starting one, and the step files a single `AgentReturned` for the whole loop.
 */
export const ReaskEntryDto = Schema.TaggedStruct("Reask", {
  reason: Schema.String,
  ...ran,
  ...stamped,
})
export type ReaskEntryDto = Schema.Schema.Type<typeof ReaskEntryDto>

export const SessionEntryDto = Schema.TaggedStruct("Session", {
  id: Schema.String,
  ...ran,
  ...stamped,
})
export type SessionEntryDto = Schema.Schema.Type<typeof SessionEntryDto>

/**
 * What the agent said on its way to an answer, whole.
 *
 * Apart from `Note` because the two are read differently: a note is the engine
 * talking about the turn and a surface may fold it away, where this is the agent's
 * own words and is the thing a reader watching a long turn has to see.
 */
export const TextEntryDto = Schema.TaggedStruct("Text", {
  text: Schema.String,
  ...sidechain,
  ...ran,
  ...stamped,
})
export type TextEntryDto = Schema.Schema.Type<typeof TextEntryDto>

/**
 * A message a person sent while the turn ran, at the point in the turn where the model
 * received it. Drawn as a person's message is everywhere else.
 */
export const SaidEntryDto = Schema.TaggedStruct("Said", {
  text: Schema.String,
  ...ran,
  ...stamped,
})

/**
 * A delegation, and the head everything a subagent did hangs off — every line it writes
 * carries this entry's `call` as its `parent`.
 *
 * `description` is what the subagent was asked to do and `agentType` is which kind was
 * asked; a row names the job, because the type is the same word on every line of a fleet.
 * `prompt` is the brief it was handed, carried so it belongs to the call rather than
 * reading as the parent agent's own narration.
 */
export const SubagentEntryDto = Schema.TaggedStruct("Subagent", {
  call: Schema.String,
  agentType: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  ...ran,
  ...stamped,
})
export type SubagentEntryDto = Schema.Schema.Type<typeof SubagentEntryDto>

/**
 * What a task reported when it ended, for the `call` that asked — a subagent's answer,
 * and equally a background command's completion. Absent while the task is still going.
 *
 * `outcome` is the report's own word where it is one of the three the vocabulary names,
 * and `stopped` is the reason it exists beside `ok`: a stopped task reads as a success
 * through `ok` alone, and a surface must draw it as neither success nor failure. Absent
 * on a line written before the word was carried, where `ok` is all there is.
 *
 * `taskId` is the provider's task handle — what joins this report onto the `Background`
 * levels that say whether the task was background work at all.
 */
export const SubagentResultEntryDto = Schema.TaggedStruct("SubagentResult", {
  call: Schema.String,
  ok: Schema.Boolean,
  summary: Schema.optional(Schema.String),
  outcome: Schema.optional(Schema.Literal("completed", "failed", "stopped")),
  taskId: Schema.optional(Schema.String),
  ...ran,
  ...stamped,
})
export type SubagentResultEntryDto = Schema.Schema.Type<typeof SubagentResultEntryDto>

/**
 * The set of background tasks alive when this line was written — a level with REPLACE
 * semantics, stored on change. The last one is the whole answer to "what is outstanding
 * right now"; an empty set is the set going quiet, not an absence of information.
 *
 * State a surface folds, never a row it draws: the live list at the input bar reads it,
 * and the transcript keeps no frozen record of what a turn ended with.
 */
export const BackgroundEntryDto = Schema.TaggedStruct("Background", {
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
export type BackgroundEntryDto = Schema.Schema.Type<typeof BackgroundEntryDto>

/**
 * A backgrounded task registering — the join the level cannot carry: `taskId` is the
 * handle the levels speak, `call` is the tool call that started the work. Written the
 * moment the task goes outstanding, and never for an inline one.
 */
export const BackgroundStartedEntryDto = Schema.TaggedStruct("BackgroundStarted", {
  taskId: Schema.String,
  call: Schema.String,
  description: Schema.optional(Schema.String),
  ...ran,
  ...stamped,
})
export type BackgroundStartedEntryDto = Schema.Schema.Type<typeof BackgroundStartedEntryDto>

/**
 * The provider's HTTP call failed and it is trying again — one entry per attempt.
 *
 * Structured rather than another `Note`, because a surface has to draw it on the pause it
 * interrupted and in waiting ink rather than error ink: the note protocol is a text
 * prefix match, and a prefix carrying that would make the rendering the source.
 *
 * `of` is the provider's own ceiling, so *attempt 2 of 5* is sayable without knowing the
 * retry policy. `status` is absent when the provider reports none — a transport failure
 * has no HTTP status — and `waitedMs` is the wait before the next attempt.
 */
export const ApiRetryEntryDto = Schema.TaggedStruct("ApiRetry", {
  attempt: Schema.Number,
  of: Schema.Number,
  status: Schema.optional(Schema.String),
  waitedMs: Schema.optional(Schema.Number),
  ...ran,
  ...stamped,
})
export type ApiRetryEntryDto = Schema.Schema.Type<typeof ApiRetryEntryDto>

/**
 * An MCP tool's call left a view, kept by the engine under `call` and fetched whole from
 * `GET /api/traks/:id/views/:call`. The line names where the view came from and nothing
 * of what it draws: its HTML is the size of a document.
 *
 * It lands a moment after the call's own row, once the view is stored, so a surface
 * joins the two on `call` and draws the call as the view from then on.
 */
export const ViewEntryDto = Schema.TaggedStruct("View", {
  call: Schema.String,
  server: Schema.String,
  tool: Schema.String,
  uri: Schema.String,
  ...ran,
  ...stamped,
})
export type ViewEntryDto = Schema.Schema.Type<typeof ViewEntryDto>

/**
 * A check the agent ran through the engine's check tool, for the call `call`. Written
 * when the call is taken and again when it answers, so the newest line for a call is
 * where it stands: `outcome` absent while it waits or runs. `unrecorded` is a pass the
 * files moved under, kept nowhere; `ended` a run the turn's end stopped.
 *
 * A surface joins it to the call on `call`, and — where the CLI gave the engine no id,
 * which is Codex — to the oldest unjoined call on `server`/`tool`.
 */
export const CheckEntryDto = Schema.TaggedStruct("Check", {
  call: Schema.String,
  server: Schema.String,
  tool: Schema.String,
  name: Schema.String,
  outcome: Schema.optional(Schema.Literal("passed", "unrecorded", "reused", "failed", "ended")),
  ...ran,
  ...stamped,
})
export type CheckEntryDto = Schema.Schema.Type<typeof CheckEntryDto>

/**
 * A hook the CLI ran, once it finished. `call` is the tool call it ran for, as the
 * provider's id for the run names it; a surface draws the hook on that call's line and
 * owes a rule for one naming no call it holds — absent on a hook about the turn.
 *
 * `blocked` stopped the call on purpose and `stopped` the turn; `failed` is the hook
 * itself going wrong. `output` is each line the hook printed, under the provider's own
 * word for it (`warning`, `stop`, `feedback`, `context`, `error` under Codex).
 */
export const HookEntryDto = Schema.TaggedStruct("Hook", {
  call: Schema.optional(Schema.String),
  event: Schema.String,
  status: Schema.Literal("completed", "failed", "blocked", "stopped"),
  durationMs: Schema.optional(Schema.Number),
  source: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  output: Schema.Array(Schema.Struct({ kind: Schema.String, text: Schema.String })),
  ...ran,
  ...stamped,
})
export type HookEntryDto = Schema.Schema.Type<typeof HookEntryDto>

/**
 * A tool call the CLI refused without asking anyone — under Claude's auto mode, its
 * classifier. `call` is the denied call, which a surface draws it on; `reason` is the
 * rule that refused it, as the provider wrote it (`[Safety Bypass Flag]`), and `source`
 * the kind of thing that did (`classifier`, `rule`).
 */
export const DeniedEntryDto = Schema.TaggedStruct("Denied", {
  call: Schema.optional(Schema.String),
  tool: Schema.String,
  reason: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  ...ran,
  ...stamped,
})
export type DeniedEntryDto = Schema.Schema.Type<typeof DeniedEntryDto>

/**
 * Everything else, already written down by the engine: a result, a cost, an error.
 *
 * `call` is carried for the one note that is a call's own outcome — a `ToolResult`, which
 * belongs on the row of the call it answers. It is what lets a surface *match* an outcome
 * to its call; without it the only rule available is counting outcomes against calls, which
 * gets a turn's parallel dispatch wrong. Absent on every other note, and on every outcome
 * written before the provider carried the id.
 */
export const NoteEntryDto = Schema.TaggedStruct("Note", {
  text: Schema.String,
  call: Schema.optional(Schema.String),
  ...sidechain,
  ...ran,
  ...stamped,
})
export type NoteEntryDto = Schema.Schema.Type<typeof NoteEntryDto>

/** One message still to be read. `id` is the engine's, and is what a list keys by. */
export const WaitingMessageDto = Schema.Struct({
  id: Schema.String,
  message: Schema.String,
  /** The files sent with it; absent where none were. */
  attachments: Schema.optional(Schema.Array(AttachmentDto)),
})
export type WaitingMessageDto = Schema.Schema.Type<typeof WaitingMessageDto>

export const TranscriptEntryDto = Schema.Union(
  SpawnedEntryDto,
  ReaskEntryDto,
  SessionEntryDto,
  ToolEntryDto,
  TextEntryDto,
  SaidEntryDto,
  SubagentEntryDto,
  SubagentResultEntryDto,
  BackgroundEntryDto,
  BackgroundStartedEntryDto,
  ApiRetryEntryDto,
  ViewEntryDto,
  CheckEntryDto,
  HookEntryDto,
  DeniedEntryDto,
  NoteEntryDto,
)
export type TranscriptEntryDto = Schema.Schema.Type<typeof TranscriptEntryDto>
