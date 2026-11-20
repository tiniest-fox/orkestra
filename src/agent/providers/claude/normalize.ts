// logic: override point 2 of 2 for the Claude provider — how to read it.
//
// Decodes one `--output-format stream-json` line into ProviderEvents. Minimal
// Schemas, so unrecognised fields are ignored and unrecognised *kinds* become
// ProviderEvent.Unknown rather than a failure.
//
// Observed kinds: system/init, system/thinking_tokens, rate_limit_event,
// assistant, user, result, system/task_started, system/task_notification,
// system/background_tasks_changed, system/api_retry, system/permission_denied — and
// the ones `test/smoke/known-kinds.json` names with the reason each is left unmodelled. That
// file is the whole list of what `Unknown` may mean.
//
// **Recognising a kind and emitting an event for it are different things.** A shell
// task's bracket lines are read and produce nothing, which is not the same as falling
// through: what falls through is `Unknown`, and `Unknown` means never seen before.
//
// **This file is where a provider's vocabulary meets the shared one.** The next
// provider writes its own sibling and maps its shapes onto the same events; that
// is the whole multi-provider bet, and `test/contract/provider.ts` is where it is
// held to it.

import { Option, Schema } from "effect"
import {
  ProviderEvent,
  TASK_OUTCOMES,
  type ActivityKind,
  type ApiErrorKind,
  type TaskOutcome,
} from "../../types/provider-event.js"
import type { PlanWindow } from "../../types/plan-usage.js"
import { SessionId } from "../../types/session.js"
import { fieldsOf, resourceOf, resultOf, toolView } from "../../logic/mcp.js"
import { McpAnswer, type McpReply, type McpRequest, type McpTool } from "../../types/mcp.js"
import { CLAUDE_MCP_ID } from "./argv.js"

const SystemInit = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("init"),
  session_id: Schema.String,
})

/**
 * Every field optional but `type`: this is a status broadcast whose payload is
 * the provider's own, and a missing field must read as "did not say" rather than
 * drop the whole line into `Unknown`.
 *
 * `status` is Claude's word for exhausted — `"rejected"` — and it is compared
 * here rather than carried, so no consumer ever sees the string.
 */
const RateLimitEvent = Schema.Struct({
  type: Schema.Literal("rate_limit_event"),
  rate_limit_info: Schema.optional(
    Schema.Struct({
      status: Schema.optional(Schema.String),
      resetsAt: Schema.optional(Schema.Number),
      isUsingOverage: Schema.optional(Schema.Boolean),
      unifiedWindows: Schema.optional(Schema.Unknown),
    }),
  ),
})

/**
 * One plan window as `unifiedWindows` writes it: `utilization` a 0–1 fraction and
 * `resetsAt` epoch seconds, against `PlanWindow`'s 0–100 and milliseconds.
 *
 * Decoded one window at a time, and `unifiedWindows` itself is `Unknown` on the line:
 * an older `claude` writes the event without it, and a window that is missing or
 * malformed must cost that window rather than the quota fields beside it.
 */
const UnifiedWindow = Schema.Struct({
  utilization: Schema.Number,
  resetsAt: Schema.optional(Schema.Number),
})
const asUnifiedWindow = Schema.decodeUnknownOption(UnifiedWindow)

const UNIFIED_KINDS = ["five_hour", "seven_day"] as const

/** The plan windows a `rate_limit_event` reports, or `undefined` where it reports none. */
const planWindowsOf = (unified: unknown): readonly PlanWindow[] | undefined => {
  const fields: Record<string, unknown> =
    typeof unified === "object" && unified !== null ? { ...unified } : {}
  const windows = UNIFIED_KINDS.flatMap((kind): PlanWindow[] => {
    const w = asUnifiedWindow(fields[kind])
    if (Option.isNone(w)) return []
    const { utilization, resetsAt } = w.value
    return [
      {
        kind,
        // Rounded to a hundredth of a point: `0.08 * 100` is not 8 in floating point.
        utilization: Math.round(utilization * 10_000) / 100,
        ...(resetsAt === undefined ? {} : { resetsAt: resetsAt * 1000 }),
      },
    ]
  })
  return windows.length > 0 ? windows : undefined
}

/** `estimated_tokens` is optional here for the reason it is optional on the event. */
const SystemThinking = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("thinking_tokens"),
  estimated_tokens: Schema.optional(Schema.Number),
})

const TextBlock = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })
/**
 * `input` is `Unknown` and optional: it is the model's argument object, so its shape is
 * the tool's rather than this file's, and a tool that takes none must still decode.
 *
 * `id` is the handle a delegation's own lines point back at. Optional because it is a
 * provider's gift rather than a guarantee — without it a `Task` call is still a call,
 * it just has nothing gathered under it.
 */
const ToolUseBlock = Schema.Struct({
  type: Schema.Literal("tool_use"),
  name: Schema.String,
  id: Schema.optional(Schema.String),
  input: Schema.optional(Schema.Unknown),
})
/**
 * `is_error` is present only when the tool failed, so absent means it worked.
 *
 * `tool_use_id` names the call this answers, and is what lets a surface put an outcome on
 * the row it belongs to instead of on whichever call has been waiting longest. **Optional
 * and `NullOr` for the reason `sidechain` is**: a required field here would fail the
 * block, and a block that fails to decode is an outcome that vanishes rather than one that
 * cannot be joined — the failure mode is a call drawn as running forever.
 */
const ToolResultBlock = Schema.Struct({
  type: Schema.Literal("tool_result"),
  tool_use_id: Schema.optional(Schema.NullOr(Schema.String)),
  is_error: Schema.optional(Schema.Boolean),
})

/**
 * Which delegation a line was written inside.
 *
 * **`NullOr` rather than plain optional, and that is the whole of it working**: Claude
 * writes `parent_tool_use_id: null` on every top-level line, and a Schema that accepted
 * only a string would fail the field, fail the struct, and drop every ordinary assistant
 * message into `Unknown`. Read through `idOrAbsent`, which turns both spellings of nothing
 * into this codebase's one — `undefined`.
 */
const sidechain = { parent_tool_use_id: Schema.optional(Schema.NullOr(Schema.String)) }

/** A provider id the stream may write as a string, as `null`, or not at all. */
const idOrAbsent = (id: unknown): string | undefined => (typeof id === "string" ? id : undefined)

/**
 * The API's own usage block for the model call this frame belongs to. Every counter
 * optional, and the block itself `NullOr` for `sidechain`'s reason: a fixture that
 * dropped it writes `null`, and a Schema refusing that would drop every assistant line
 * into `Unknown`.
 */
const CallUsage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.optional(Schema.Number),
  cache_creation_input_tokens: Schema.optional(Schema.Number),
  cache_read_input_tokens: Schema.optional(Schema.Number),
})

/**
 * `usage` is the model call's own, one frame per content block and the same block on
 * each — see `occupancyOf`. `model` is the resolved id (`claude-haiku-4-5-20251001`),
 * which is the key `modelUsage` on the `result` line uses.
 */
const AssistantMsg = Schema.Struct({
  type: Schema.Literal("assistant"),
  message: Schema.Struct({
    content: Schema.Array(Schema.Unknown),
    id: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    usage: Schema.optional(Schema.NullOr(CallUsage)),
  }),
  ...sidechain,
})

/**
 * The tool_result echo. Same shape as an assistant message, but read for its
 * tool_result blocks only — see `toolResultEvents`. A `content` that is a bare string
 * rather than an array falls through to `Unknown`, which is the degrade this file is
 * built on.
 */
const UserMsg = Schema.Struct({
  type: Schema.Literal("user"),
  message: Schema.Struct({ content: Schema.Array(Schema.Unknown) }),
  ...sidechain,
})

/**
 * A user message printed back as the model receives it, under `--replay-user-messages`
 * — the one report of when a message written to the open pipe was read. The turn's
 * own prompt comes back this way too, first; telling the two apart is the harness's,
 * which knows what it steered. `content` is the frame the harness wrote, echoed whole.
 */
const ReplayedMsg = Schema.Struct({
  type: Schema.Literal("user"),
  isReplay: Schema.Literal(true),
  message: Schema.Struct({ content: Schema.Array(Schema.Unknown) }),
})

/**
 * The two lines that bracket a *task*, which is very much not the same thing as a
 * delegation — see `taskEvents`, which is where that is sorted out.
 *
 * **Every field but the two literals is optional, including `tool_use_id`.** The
 * provider's own schema makes it optional and `JSON.stringify` drops an `undefined`, so
 * a required field here would drop the whole line into `Unknown` — and a kind that
 * reaches `Unknown` is one `pnpm smoke` has to be told about. Whether a bracket can be
 * used is decided after decoding rather than by refusing to decode it. The rest is a
 * status broadcast, optional for the reason `RateLimitEvent`'s payload is.
 *
 * `system/task_progress` and `system/task_updated` are deliberately absent —
 * `test/smoke/known-kinds.json` carries the reason for each.
 */
const SystemTaskStarted = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("task_started"),
  task_id: Schema.optional(Schema.String),
  tool_use_id: Schema.optional(Schema.NullOr(Schema.String)),
  subagent_type: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  /** The registry entry — `local_bash`, `local_agent`, `dream`. See `DELEGATING`. */
  task_type: Schema.optional(Schema.String),
  /**
   * Present on every bracket a current CLI emits, `false` on an inline slow command —
   * and absent from every capture that predates the field, which is why absent reads
   * as inline rather than failing the line.
   */
  is_backgrounded: Schema.optional(Schema.Boolean),
  /** Housekeeping the provider asks consumers to keep out of an inline transcript. */
  skip_transcript: Schema.optional(Schema.Boolean),
})

/**
 * `status` is compared here and carried only when it is a word `TASK_OUTCOMES` names —
 * so no consumer ever sees the provider's raw string, on `RateLimitEvent`'s rule.
 */
const SystemTaskNotification = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("task_notification"),
  task_id: Schema.optional(Schema.String),
  tool_use_id: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  skip_transcript: Schema.optional(Schema.Boolean),
})

/**
 * The level: the full set of live background tasks, replaced on every change.
 *
 * **`tasks` is required, unlike every other field a system broadcast carries here**,
 * because the set is the whole content of the line — a level that cannot say what is
 * running has nothing to replace the last one with, and falling to `Unknown` is what
 * makes `pnpm smoke` say the shape moved. Each entry's `task_id` is required for the
 * same reason: it is the identity the join and the stop control both speak.
 */
const SystemBackgroundTasks = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("background_tasks_changed"),
  tasks: Schema.Array(
    Schema.Struct({
      task_id: Schema.String,
      task_type: Schema.optional(Schema.String),
      description: Schema.optional(Schema.String),
    }),
  ),
})

/**
 * A retryable HTTP failure, and the wait before the next attempt.
 *
 * **The three counters are required**, unlike everything else read here, because they
 * are the whole content of the line: a retry notice that cannot say which attempt it is
 * has nothing to draw. The provider's own consumer guards on exactly these three being
 * numbers, so a frame without them is one it does not render either.
 *
 * `error_status` is the decorative half and is read as `Unknown` for the reason
 * `ResultMsg.origin` is: the provider writes an HTTP status there and `null` for a
 * connection error that never got a response, and a typed field would drop the whole
 * line the day it writes something else — losing the counters over the label.
 */
/**
 * The acknowledgement for a control line the harness wrote — the per-task stop.
 * Recognised and dropped rather than left to `Unknown`: what a person watches
 * for is on the stream already, as the level shrinking and the task's own
 * `stopped` notification, and an ack drawn as a transcript line would say
 * nothing beside them.
 */
const ControlResponse = Schema.Struct({
  type: Schema.Literal("control_response"),
})

/**
 * A tool call the CLI refused without asking anyone — auto mode's classifier, or a
 * settings rule, with no one to prompt. `decision_reason` is the rule's name and
 * `decision_reason_type` what kind of thing refused. Both optional, so a line that
 * stops sending one still reaches the transcript rather than `Unknown`.
 */
const SystemPermissionDenied = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("permission_denied"),
  tool_name: Schema.String,
  tool_use_id: Schema.optional(Schema.Unknown),
  decision_reason: Schema.optional(Schema.String),
  decision_reason_type: Schema.optional(Schema.String),
})

const SystemApiRetry = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("api_retry"),
  attempt: Schema.Number,
  max_retries: Schema.Number,
  retry_delay_ms: Schema.Number,
  error_status: Schema.optional(Schema.Unknown),
})

/** `429`, from whichever of the two shapes a status arrives in. Absent is absent. */
const statusLabel = (status: unknown): string | undefined => {
  if (typeof status === "number") return String(status)
  return typeof status === "string" && status !== "" ? status : undefined
}

/**
 * The end of a turn — **not the end of the invocation.**
 *
 * `--print` keeps the process alive after our prompt has been answered so background
 * work can report back, and each time it does Claude gives itself another turn and ends
 * it with another one of these. `origin` is what tells them apart: it is the origin of
 * the *prompt* the turn answered, so it is absent on ours and present (`task-notification`,
 * `auto-continuation`, `channel`) on every turn Claude asked for itself.
 *
 * Read as `Unknown` because only its presence is used, and a `Struct` here would fail
 * the field, fail the line, and drop a whole turn's answer into `Unknown` the day a
 * kind we have not seen appears.
 *
 * `total_cost_usd` is this CLI run's running total, not the conversation's: it starts
 * again from nothing on every spawn, a `--resume` included — which is what `runCostUsd`
 * is named for. See `ProviderEvent.Usage`.
 *
 * `modelUsage` is keyed by resolved model id, one entry per model the invocation
 * called — a subagent's beside the turn's own — and `contextWindow` there is the
 * model's window in tokens. Read for that one field; the rest of the entry is the
 * cost breakdown `usage` already gives.
 *
 * `errors` is what an `error_during_execution` result carries in place of `result` — a
 * `--resume` of a session the CLI cannot find says so there and nowhere else on stdout.
 */
const ResultMsg = Schema.Struct({
  type: Schema.Literal("result"),
  is_error: Schema.Boolean,
  result: Schema.optional(Schema.String),
  errors: Schema.optional(Schema.Array(Schema.String)),
  total_cost_usd: Schema.optional(Schema.Number),
  origin: Schema.optional(Schema.Unknown),
  modelUsage: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Struct({ contextWindow: Schema.optional(Schema.Number) }),
    }),
  ),
  usage: Schema.optional(
    Schema.Struct({
      input_tokens: Schema.optional(Schema.Number),
      output_tokens: Schema.optional(Schema.Number),
      // Absent on a session small enough to have no cache — hence optional, not
      // defaulted upstream.
      cache_creation_input_tokens: Schema.optional(Schema.Number),
      cache_read_input_tokens: Schema.optional(Schema.Number),
    }),
  ),
})

/** What an error result says: its text, else the CLI's `errors`, else that it failed. */
const resultMessage = (r: typeof ResultMsg.Type): string =>
  r.result ??
  (r.errors === undefined || r.errors.length === 0 ? undefined : r.errors.join("; ")) ??
  "claude reported is_error"

// ============================================================================
// What a tool call did — the table that is a provider's whole share of it
// ============================================================================

/**
 * Claude's tool names, and where each one keeps the value worth showing.
 *
 * `from` is tried in order and the first string present wins, which is what lets one
 * entry cover a tool whose argument is optional. An empty list is a kind with nothing to
 * show — `Todo` is the activity, and which items moved is not a transcript line.
 *
 * **A name that is not here is `Other`, not a failure.** That is the whole reason a new
 * tool or a second provider is not a breaking change. A name mapped
 * *to* `Other` is here for its `from` alone: the tools that control background work draw
 * a row saying which task or which skill, and the alternative — a vocabulary word
 * covering stop, watch, list, message and schedule at once — is a word for twenty calls.
 *
 * **The `Task*` prefix spans two unrelated families.** `TaskCreate` / `TaskUpdate` /
 * `TaskGet` / `TaskList` are the todo list, and take a `subject` or a camelCase
 * `taskId`; `TaskStop` / `TaskOutput` act on a background task and take a snake_case
 * `task_id`. Reading the prefix rather than the argument names files half of them under
 * the wrong activity.
 */
const ACTIVITIES: Record<
  string,
  {
    readonly kind: ActivityKind
    readonly from: readonly string[]
    /**
     * The key holding the command, on a tool whose `from` prefers something written to
     * be read. Carried as `command` only when `from` settled on another key, so a call
     * that wrote no description still shows its command as the detail and nothing twice.
     */
    readonly command?: string
  }
> = {
  // A heredoc that writes three files is the command, and "Write the tag components"
  // is what it is for — so the description leads and the command waits to be opened.
  Bash: { kind: "Bash", from: ["description", "command"], command: "command" },
  Read: { kind: "Read", from: ["file_path"] },
  Edit: { kind: "Edit", from: ["file_path"] },
  MultiEdit: { kind: "Edit", from: ["file_path"] },
  NotebookEdit: { kind: "Edit", from: ["notebook_path"] },
  Write: { kind: "Write", from: ["file_path"] },
  Grep: { kind: "Grep", from: ["pattern"] },
  Glob: { kind: "Glob", from: ["pattern"] },
  WebSearch: { kind: "WebSearch", from: ["query"] },
  WebFetch: { kind: "WebFetch", from: ["url"] },
  TodoWrite: { kind: "Todo", from: [] },
  // This repository's own corpus writes todos as tasks, so both spellings are one kind.
  TaskCreate: { kind: "Todo", from: [] },
  TaskUpdate: { kind: "Todo", from: [] },
  TaskGet: { kind: "Todo", from: [] },
  TaskList: { kind: "Todo", from: [] },
  Task: { kind: "Task", from: ["subagent_type", "description"] },
  Agent: { kind: "Task", from: ["subagent_type", "description"] },
  // Some skills run in a subagent, so this is background work that drew a bare name.
  Skill: { kind: "Other", from: ["skill"] },
  ToolSearch: { kind: "Other", from: ["query"] },
  // The command is the fact, but it is a shell script over several lines and the
  // description is written to be read.
  Monitor: { kind: "Other", from: ["description", "command"], command: "command" },
  TaskStop: { kind: "Other", from: ["task_id"] },
  TaskOutput: { kind: "Other", from: ["task_id"] },
  // Two spellings of the same call in the wild, and `summary` is on both.
  SendMessage: { kind: "Other", from: ["summary", "to", "recipient"] },
  ScheduleWakeup: { kind: "Other", from: ["reason"] },
}

/** Read defensively: `input` is the model's argument object, not a shape we decode. */
const stringField = (input: unknown, key: string): string | undefined => {
  if (typeof input !== "object" || input === null) return undefined
  const record: Record<string, unknown> = { ...input }
  const value = record[key]
  return typeof value === "string" && value !== "" ? value : undefined
}

/**
 * Whether the call said it was detached, read the same way and for the same reason.
 *
 * **Only `true` is carried.** `run_in_background: false` and no key at all are the same
 * fact — the turn waited — and writing the false one down would put a key on every
 * `Read` in every transcript to say nothing.
 */
const backgroundedIn = (input: unknown): boolean | undefined => {
  if (typeof input !== "object" || input === null) return undefined
  const record: Record<string, unknown> = { ...input }
  return record["run_in_background"] === true ? true : undefined
}

/**
 * An MCP tool's name, `mcp__<server>__<tool>`, as the call Codex's `mcp_tool_call` is —
 * that name, kind `Mcp` and `server/tool` for the detail — so one server reads the same
 * under either provider and the raw name never reaches a surface beside the detail it
 * spells out a second time.
 *
 * Split at the first separator after the prefix, which is how the CLI itself reads its
 * own names back: a server name is normalised to single underscores, and a tool name is
 * whatever is left.
 */
const mcpCall = (name: string): { readonly name: string; readonly detail: string } | undefined => {
  const match = /^mcp__(.+?)__(.+)$/.exec(name)
  return match === null
    ? undefined
    : { name: "mcp_tool_call", detail: `${match[1] ?? ""}/${match[2] ?? ""}` }
}

const activityOf = (
  name: string,
  input: unknown,
): {
  readonly name: string
  readonly kind: ActivityKind
  readonly detail: string | undefined
  readonly command: string | undefined
} => {
  const mcp = mcpCall(name)
  if (mcp !== undefined) return { ...mcp, kind: "Mcp", command: undefined }
  const mapped = ACTIVITIES[name]
  if (mapped === undefined) return { name, kind: "Other", detail: undefined, command: undefined }
  for (const key of mapped.from) {
    const detail = stringField(input, key)
    if (detail === undefined) continue
    const command =
      mapped.command === undefined || mapped.command === key
        ? undefined
        : stringField(input, mapped.command)
    return { name, kind: mapped.kind, detail, command }
  }
  return { name, kind: mapped.kind, detail: undefined, command: undefined }
}

const asInit = Schema.decodeUnknownOption(SystemInit)
const asThinking = Schema.decodeUnknownOption(SystemThinking)
const asRateLimit = Schema.decodeUnknownOption(RateLimitEvent)
const asAssistant = Schema.decodeUnknownOption(AssistantMsg)
const asUser = Schema.decodeUnknownOption(UserMsg)
const asReplayed = Schema.decodeUnknownOption(ReplayedMsg)
const asResult = Schema.decodeUnknownOption(ResultMsg)
const asTaskStarted = Schema.decodeUnknownOption(SystemTaskStarted)
const asTaskNotification = Schema.decodeUnknownOption(SystemTaskNotification)
const asBackgroundTasks = Schema.decodeUnknownOption(SystemBackgroundTasks)
const asApiRetry = Schema.decodeUnknownOption(SystemApiRetry)
const asPermissionDenied = Schema.decodeUnknownOption(SystemPermissionDenied)
const asControlResponse = Schema.decodeUnknownOption(ControlResponse)
const asText = Schema.decodeUnknownOption(TextBlock)
const asToolUse = Schema.decodeUnknownOption(ToolUseBlock)
const asToolResult = Schema.decodeUnknownOption(ToolResultBlock)

// ============================================================================
// Classifying an in-band failure — a heuristic, and it says so
// ============================================================================

/**
 * Claude reports a failed turn as prose in `result.result`, so classifying it is
 * pattern matching on English. That is tolerable **only because it defaults to
 * `unclassified`**: a message we have not seen must not be filed under the
 * nearest-looking kind, because a wrong kind is actionable and wrong.
 *
 * Two mechanisms, status code first because it is the precise one. A provider
 * that reports codes rather than sentences keeps the first and deletes its share
 * of the second — the shared vocabulary is `ApiErrorKind`, not either table.
 */
const STATUS_KINDS: Record<string, ApiErrorKind> = {
  "401": "auth",
  "403": "auth",
  "429": "rate_limit",
  "500": "server",
  "502": "server",
  "503": "server",
  // Anthropic's overload code, and the reason a plain "is it a 5xx" test is not
  // enough: 529 is a 5xx that means "come back", not "something broke".
  "529": "overloaded",
}

/**
 * **Only a code that follows the word "error"**, which is how Claude writes them
 * (`API Error: 503 Service Unavailable`). A bare three-digit number is a number:
 * matching `\b5\d\d\b` anywhere reads "truncated at 500 tokens" as a server
 * failure, which the test below pins.
 */
const statusKind = (message: string): ApiErrorKind | undefined => {
  const code = /error[:\s]+(\d{3})\b/i.exec(message)?.[1]
  return code === undefined ? undefined : STATUS_KINDS[code]
}

const API_ERROR_PATTERNS: readonly (readonly [RegExp, ApiErrorKind])[] = [
  // The transport going, which has no status code for `statusKind` to find — Claude
  // writes it as `API Error: Connection closed mid-response`. Narrow on purpose: it must
  // match the connection itself failing and nothing that merely mentions one, because
  // `interrupted` is the one kind that says *nothing is wrong with the request*.
  [/connection (closed|reset|error|aborted)/i, "interrupted"],
  [/usage limit reached|rate.?limit|credit balance/i, "rate_limit"],
  [/overloaded/i, "overloaded"],
  [/server error/i, "server"],
  [/invalid api key|unauthorized|authentication|oauth token/i, "auth"],
]

export const claudeApiErrorKind = (message: string): ApiErrorKind =>
  statusKind(message) ??
  API_ERROR_PATTERNS.find(([pattern]) => pattern.test(message))?.[1] ??
  "unclassified"

const parseJson = (line: string): Option.Option<unknown> => {
  if (line.trim() === "") return Option.none()
  try {
    const parsed: unknown = JSON.parse(line)
    return Option.some(parsed)
  } catch {
    return Option.none()
  }
}

/**
 * What the window held at the model call an `assistant` frame reports, as the frame's
 * own `usage` — the input side complete, the output side partial: the frame is written
 * as the call starts, and `output_tokens` there is 2 on a call whose reply came to 36.
 * The reading under-counts the last reply, and `Context` says so.
 *
 * **One call writes one frame per content block, each carrying the same `usage`**, so
 * a two-block message yields the same reading twice. Emitted twice rather than deduped
 * here — this reader remembers nothing — and `message.id` rides as `call` so the fold
 * can tell the repeat from the next call: `meter.ts` keeps the last reading and adds
 * each call to its estimate once. It does cost a `Runs.spent` write per frame, which
 * `withTranscript` makes on every reading.
 *
 * None inside a delegation: a subagent's frames measure the subagent's window, and the
 * turn's own conversation is the one a meter is about.
 */
const occupancyOf = (
  message: Schema.Schema.Type<typeof AssistantMsg>["message"],
  parent: string | undefined,
): readonly ProviderEvent[] => {
  const u = message.usage
  if (u === undefined || u === null || parent !== undefined) return []
  return [
    ProviderEvent.Occupancy({
      model: message.model,
      call: message.id,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
    }),
  ]
}

/**
 * The blocks of one `assistant` message, as events, tagged with the delegation they
 * happened inside. A `user` line goes through `toolResultEvents` instead.
 */
const contentEvents = (
  blocks: readonly unknown[],
  parent: string | undefined,
): readonly ProviderEvent[] => {
  const out: ProviderEvent[] = []
  for (const block of blocks) {
    const text = asText(block)
    if (Option.isSome(text)) {
      out.push(ProviderEvent.TextDelta({ text: text.value.text, parent }))
      continue
    }
    const tool = asToolUse(block)
    if (Option.isSome(tool)) {
      const { name, id, input } = tool.value
      out.push(
        ProviderEvent.ToolUse({
          ...activityOf(name, input),
          backgrounded: backgroundedIn(input),
          call: id,
          parent,
        }),
      )
      continue
    }
    const result = asToolResult(block)
    // Absent `is_error` is a tool that worked — see `ToolResultBlock`.
    if (Option.isSome(result)) {
      out.push(
        ProviderEvent.ToolResult({
          ok: result.value.is_error !== true,
          call: idOrAbsent(result.value.tool_use_id),
          parent,
        }),
      )
    }
  }
  return out
}

/**
 * The task types that mean *somebody else is doing this*.
 *
 * The provider registers a task for shell work too — `local_bash` is by far the
 * commonest bracket in a real corpus — so a reader that took `task_started` to mean
 * "a subagent started" draws a delegation for every slow `pnpm verify`. Everything not
 * named here is shell or housekeeping, **including a bracket that names no type at
 * all**: a missing card beats hundreds of wrong ones.
 */
const DELEGATING = new Set(["local_agent", "remote_agent", "local_workflow"])

/** The report's own word, only where it is one of the three every consumer knows. */
const outcomeOf = (status: string | undefined): TaskOutcome | undefined =>
  TASK_OUTCOMES.find((word) => word === status)

/**
 * The task-family lines — the two brackets and the level — in the order the stream
 * writes them, or `undefined` for a line that is not one.
 *
 * **The two answers a caller must tell apart are "not mine" and "mine, and it produces
 * nothing".** An empty array alone would fall through to `Unknown`, which is how a
 * recognised kind ends up rendered as `Unknown(system/task_started)` and how a kind
 * `pnpm smoke` has an opinion about arrives without one.
 *
 * Three lines produce nothing: an inline shell or housekeeping task, an ambient one the
 * provider asks consumers to hide, and a bracket carrying no `tool_use_id` — which is
 * the only handle joining a task's lines to the call that asked for them, so a head no
 * group can hang off is worse than no head.
 *
 * A backgrounded `task_started` produces `BackgroundStarted` whatever its `task_type`,
 * and a delegating one produces `SubagentStarted` beside it — the two carry different
 * joins, and a backgrounded delegation needs both.
 *
 * **A notification is not gated on `task_type`, because it does not carry one.** One
 * naming a task nothing here opened is dropped by whatever draws it, not here: joining
 * it back to its `task_started` needs memory of an earlier line, and this function has
 * none by design.
 */
const taskEvents = (raw: unknown): readonly ProviderEvent[] | undefined => {
  const started = asTaskStarted(raw)
  if (Option.isSome(started)) {
    const t = started.value
    if (t.skip_transcript === true) return []
    if (typeof t.tool_use_id !== "string") return []
    const out: ProviderEvent[] = []
    if (t.is_backgrounded === true && t.task_id !== undefined) {
      out.push(
        ProviderEvent.BackgroundStarted({
          taskId: t.task_id,
          call: t.tool_use_id,
          description: t.description,
        }),
      )
    }
    if (t.task_type !== undefined && DELEGATING.has(t.task_type)) {
      out.push(
        ProviderEvent.SubagentStarted({
          call: t.tool_use_id,
          agentType: t.subagent_type,
          description: t.description,
          prompt: t.prompt,
        }),
      )
    }
    return out
  }

  const notified = asTaskNotification(raw)
  if (Option.isSome(notified)) {
    const t = notified.value
    if (t.skip_transcript === true) return []
    if (typeof t.tool_use_id !== "string") return []
    return [
      ProviderEvent.SubagentResult({
        call: t.tool_use_id,
        // A guess, the same kind `claudeApiErrorKind` is, and written the same way
        // round: anything unrecognised reads as *worked*, the direction `is_error`
        // takes, because a wrong failure mark is actionable and wrong. `outcome` beside
        // it is the observed word — `stopped` included, which this guess files under
        // success and must never be drawn as one. What a failed delegation actually
        // draws from is the parent's own `tool_result`, which is on the wire — see
        // `nest` in the client's `turns.ts`.
        ok: t.status !== "failed",
        summary: t.summary,
        outcome: outcomeOf(t.status),
        taskId: t.task_id,
      }),
    ]
  }

  const level = asBackgroundTasks(raw)
  if (Option.isSome(level)) {
    return [
      ProviderEvent.BackgroundTasks({
        tasks: level.value.tasks.map((t) => ({
          id: t.task_id,
          taskType: t.task_type,
          description: t.description,
        })),
      }),
    ]
  }

  return undefined
}

/**
 * A `user` line means its tool results and nothing else. Its other blocks are turn
 * input the CLI echoed back — a loaded skill's whole body, a system reminder, and inside
 * a delegation the brief the parent agent wrote — and a text block there is not prose
 * the agent produced. Reading one as `TextDelta` files 30 KB of skill in the transcript
 * under the agent's name, so the arms are split rather than shared with `contentEvents`.
 *
 * `parent` still rides along: a delegation's tool results are the subagent's, and one
 * filed against the parent grows the parent a row for a call it never made.
 */
const toolResultEvents = (
  blocks: readonly unknown[],
  parent: string | undefined,
): readonly ProviderEvent[] => {
  const out: ProviderEvent[] = []
  for (const block of blocks) {
    const result = asToolResult(block)
    if (Option.isSome(result)) {
      out.push(
        ProviderEvent.ToolResult({
          ok: result.value.is_error !== true,
          call: idOrAbsent(result.value.tool_use_id),
          parent,
        }),
      )
    }
  }
  return out
}

export const claudeNormalizeLine = (line: string): readonly ProviderEvent[] => {
  const json = parseJson(line)
  return Option.isNone(json) ? [] : eventsOf(json.value)
}

const eventsOf = (raw: unknown): readonly ProviderEvent[] => {
  const init = asInit(raw)
  if (Option.isSome(init)) {
    return [ProviderEvent.SessionStarted({ id: SessionId.make(init.value.session_id) })]
  }

  const thinking = asThinking(raw)
  if (Option.isSome(thinking)) {
    // No text: the tick is a count, and the `thinking` content block that carries the
    // prose is dropped by `contentEvents` — the deferred entry *claude's thinking block draws no label on the pause*.
    return [ProviderEvent.Thinking({ tokens: thinking.value.estimated_tokens, text: undefined })]
  }

  const rateLimit = asRateLimit(raw)
  if (Option.isSome(rateLimit)) {
    const info = rateLimit.value.rate_limit_info
    return [
      ProviderEvent.RateLimit({
        exhausted: info?.status === "rejected",
        usingOverage: info?.isUsingOverage === true,
        resetsAt: info?.resetsAt,
        windows: planWindowsOf(info?.unifiedWindows),
      }),
    ]
  }

  const task = taskEvents(raw)
  if (task !== undefined) return task

  // Recognised, and it produces nothing — see `ControlResponse`.
  if (Option.isSome(asControlResponse(raw))) return []

  const retry = asApiRetry(raw)
  if (Option.isSome(retry)) {
    const r = retry.value
    return [
      ProviderEvent.ApiRetry({
        attempt: r.attempt,
        of: r.max_retries,
        // A label rather than the number it usually is: nothing counts with it, and the
        // entry it becomes has to hold a transport failure's absence of one anyway.
        status: statusLabel(r.error_status),
        waitedMs: r.retry_delay_ms,
      }),
    ]
  }

  const denied = asPermissionDenied(raw)
  if (Option.isSome(denied)) {
    const d = denied.value
    return [
      ProviderEvent.PermissionDenied({
        call: idOrAbsent(d.tool_use_id),
        tool: d.tool_name,
        reason: d.decision_reason,
        source: d.decision_reason_type,
      }),
    ]
  }

  const assistant = asAssistant(raw)
  if (Option.isSome(assistant)) {
    const a = assistant.value
    const parent = idOrAbsent(a.parent_tool_use_id)
    return [...occupancyOf(a.message, parent), ...contentEvents(a.message.content, parent)]
  }

  // Before the tool_result reader below, which decodes the same line and finds nothing.
  const replayed = asReplayed(raw)
  if (Option.isSome(replayed)) {
    const text = replayed.value.message.content
      .flatMap((block) => Option.toArray(asText(block)))
      .map((block) => block.text)
      .join("")
    return [ProviderEvent.MessageDelivered({ text, key: undefined })]
  }

  // A `user` line whose content holds no tool_result is a turn input echoed back,
  // which produces nothing rather than an empty-handed event.
  const user = asUser(raw)
  if (Option.isSome(user)) {
    const u = user.value
    return toolResultEvents(u.message.content, idOrAbsent(u.parent_tool_use_id))
  }

  const result = asResult(raw)
  if (Option.isSome(result)) {
    const r = result.value
    const out: ProviderEvent[] = []
    // Before the usage report, so the run record written on that report already holds
    // the window — see `withTranscript`. One per model; `meter.ts` keeps the turn's own.
    for (const [model, m] of Object.entries(r.modelUsage ?? {})) {
      if (m.contextWindow !== undefined) {
        out.push(ProviderEvent.ContextWindow({ model, tokens: m.contextWindow }))
      }
    }
    if (r.usage !== undefined || r.total_cost_usd !== undefined) {
      out.push(
        ProviderEvent.Usage({
          inputTokens: r.usage?.input_tokens ?? 0,
          outputTokens: r.usage?.output_tokens ?? 0,
          cacheWriteTokens: r.usage?.cache_creation_input_tokens ?? 0,
          cacheReadTokens: r.usage?.cache_read_input_tokens ?? 0,
          runCostUsd: r.total_cost_usd ?? 0,
        }),
      )
    }
    const selfGiven = r.origin !== undefined && r.origin !== null
    // A turn Claude gave itself to read a background report failing is spend and
    // nothing else: it must not fail ours, whose answer is already in hand by then and
    // which `failOnApiError` would throw away. Its text is a result like ours — what the
    // agent wrote once the work it waited on had ended — and which results make the
    // answer is the harness's rule. `null` is checked as well as absent for the reason
    // `idOrAbsent` checks it.
    if (selfGiven && r.is_error) return out
    const message = resultMessage(r)
    out.push(
      r.is_error
        ? ProviderEvent.ApiError({ kind: claudeApiErrorKind(message), message })
        : ProviderEvent.Result({ text: r.result ?? "" }),
    )
    return out
  }

  return [ProviderEvent.Unknown({ raw })]
}

// ============================================================================
// MCP — a call's payload for a view, and the answers to what the harness asks
// ============================================================================

/** An MCP call the model made, kept from its `tool_use` until its result arrives. */
interface McpCalled {
  readonly name: string
  readonly input: unknown
}

/**
 * The `McpReturned` a line earns beside its ordinary events. A call is remembered at
 * its `tool_use`, which names the tool and holds the arguments, and reported at its
 * `tool_result`, whose line carries the server's result whole as `tool_use_result` —
 * neither line says both. Only the agent's own calls: one made inside a delegation
 * carries a `parent` and draws no view.
 */
const mcpReturned = (
  raw: unknown,
  events: readonly ProviderEvent[],
  calls: Map<string, McpCalled>,
): readonly ProviderEvent[] => {
  if (events.some((e) => e._tag === "ToolUse" && e.kind === "Mcp" && e.parent === undefined)) {
    const blocks = Option.getOrUndefined(asAssistant(raw))?.message.content ?? []
    for (const block of blocks) {
      const tool = Option.getOrUndefined(asToolUse(block))
      if (tool?.id !== undefined && tool.name.startsWith("mcp__")) {
        calls.set(tool.id, { name: tool.name, input: tool.input ?? {} })
      }
    }
    return []
  }
  const out: ProviderEvent[] = []
  for (const e of events) {
    if (e._tag !== "ToolResult" || e.call === undefined) continue
    const called = calls.get(e.call)
    if (called === undefined) continue
    calls.delete(e.call)
    out.push(
      ProviderEvent.McpReturned({
        call: e.call,
        server: undefined,
        tool: called.name,
        arguments: called.input,
        result: resultOf(fieldsOf(raw)["tool_use_result"], !e.ok),
      }),
    )
  }
  return out
}

/**
 * One reader per spawn: `claudeNormalizeLine`, and the memory `mcpReturned` needs
 * between a call and its result. Every other line still stands alone.
 */
export const claudeNormalizer = (): ((line: string) => readonly ProviderEvent[]) => {
  const calls = new Map<string, McpCalled>()
  return (line) => {
    const json = parseJson(line)
    if (Option.isNone(json)) return []
    const events = eventsOf(json.value)
    const returned = mcpReturned(json.value, events, calls)
    return returned.length === 0 ? events : [...events, ...returned]
  }
}

/**
 * A `control_response` to a request `claudeMcpRequest` framed, as the reply the harness
 * pairs with it. Anything else — the stop's acknowledgement, a line of the turn — is
 * `undefined`. A refusal carries the CLI's own sentence.
 */
export const claudeMcpReply = (line: string): McpReply | undefined => {
  if (!line.includes(CLAUDE_MCP_ID)) return undefined
  const raw = Option.getOrUndefined(parseJson(line))
  const all = fieldsOf(raw)
  if (all["type"] !== "control_response") return undefined
  const response = fieldsOf(all["response"])
  const id = response["request_id"]
  if (typeof id !== "string" || !id.startsWith(CLAUDE_MCP_ID)) return undefined
  const n = Number(id.slice(CLAUDE_MCP_ID.length))
  if (!Number.isInteger(n)) return undefined
  if (response["subtype"] === "success") {
    return { n, body: response["response"], error: undefined }
  }
  const said = response["error"]
  return { n, body: undefined, error: typeof said === "string" ? said : "claude refused it" }
}

/** How the CLI spells a server's or a tool's name inside a qualified tool name. */
const qualified = (name: string): string => name.replace(/[^a-zA-Z0-9_-]/g, "_")

const listedTools = (body: unknown): readonly McpTool[] => {
  const servers = fieldsOf(body)["mcpServers"]
  if (!Array.isArray(servers)) return []
  return servers.flatMap((entry: unknown): readonly McpTool[] => {
    const server = fieldsOf(entry)
    const name = server["name"]
    const tools = server["tools"]
    if (typeof name !== "string" || !Array.isArray(tools)) return []
    return tools.flatMap((listed: unknown): readonly McpTool[] => {
      const tool = fieldsOf(listed)
      const called = tool["name"]
      if (typeof called !== "string") return []
      return [
        {
          server: name,
          name: called,
          callName: `mcp__${qualified(name)}__${qualified(called)}`,
          ...toolView(tool["_meta"]),
        },
      ]
    })
  })
}

/**
 * An answer's body as what was asked for. `mcp_status` lists every server with its
 * tools and each tool's `_meta`; a call's `content` comes back as one string where the
 * CLI rewrote it, which `resultOf` wraps.
 */
export const claudeMcpAnswer = (request: McpRequest, body: unknown): McpAnswer | undefined => {
  switch (request._tag) {
    case "ListTools":
      return McpAnswer.Tools({ tools: listedTools(body) })
    case "ReadResource": {
      const resource = resourceOf(body)
      return resource === undefined ? undefined : McpAnswer.Resource({ resource })
    }
    case "CallTool":
      return McpAnswer.Result({ result: resultOf(body, false) })
  }
}
