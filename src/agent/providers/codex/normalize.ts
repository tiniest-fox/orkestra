// logic: override point 2 of 2 for the Codex provider — how to read it.
//
// Decodes the lines `codex app-server` prints into ProviderEvents. Each is one
// JSON-RPC message: an answer to a request `codexDialogue` wrote, a notification, or
// a request of the server's own. Minimal Schemas, as the Claude sibling:
// unrecognised fields are ignored, and an unrecognised *method* or item type becomes
// ProviderEvent.Unknown rather than a failure.
//
// Observed in the captured runs: the three answers, a refused `thread/resume`, a
// `turn/steer` accepted and refused, a second `turn/start` on one connection, most of
// the notifications `SILENT` lists, `turn/started`, `turn/completed`,
// `thread/tokenUsage/updated`, `account/rateLimits/updated`, `error`, and `item/started` / `item/completed`
// carrying an item of type userMessage, agentMessage, reasoning, commandExecution,
// fileChange, webSearch or collabAgentToolCall. An mcpToolCall item, a retried
// `error`, an interrupted turn and every `codexErrorInfo` but `other` appeared in
// none; each is read on what the protocol's own types say of it.
//
// **Built once per spawn, and it remembers four things.** Codex writes several
// `agentMessage` items in a turn — narration before a command, then the answer — and
// the last one before `turn/completed` is the answer, so the reader keeps the latest.
// `turn/completed` carries no usage, so the reader adds up the per-call counts
// `thread/tokenUsage/updated` reports and settles both when the turn ends. And it
// keeps the thread and the turn the two requests' answers named, because **the
// connection carries more than this turn**: a subagent runs on a thread of its own and
// its turn, items, counts and ending all arrive here, and a resumed thread opens by
// replaying the count of the turn before. A line naming another thread or turn is
// recognised and earns nothing — read as this turn's, a subagent's ending is the
// parent's, with the subagent's last message as the answer.
//
// **A spawn may hold a second turn, and the turn read is the latest one named.** A
// message Codex would not steer into the first turn is started as a turn of its own
// (`codexDialogue`), after the first has ended, and each `turn/start` answer names the
// turn read from then on. Each turn settles its own `Usage` and `Result` from its own
// count and its own last message; the harness keeps the first `Result` and drops the
// rest, so the follow-on turn's reply is drawn and files nothing.
//
// The per-call reading and the context window are on this stream too, and are read
// from Codex's own session log instead — `codexRolloutLine` at the bottom, reached
// through `CliProviderSpec.sessionLog`.

import { Option, Schema } from "effect"
import type { PlanWindow } from "../../types/plan-usage.js"
import {
  HOOK_STATUSES,
  ProviderEvent,
  type ActivityKind,
  type ApiErrorKind,
  type HookStatus,
} from "../../types/provider-event.js"
import { SessionId } from "../../types/session.js"
import { fieldsOf, resourceOf, resultOf, toolView } from "../../logic/mcp.js"
import { McpAnswer, type McpReply, type McpRequest, type McpTool } from "../../types/mcp.js"
import { CODEX_MCP_IDS, codexOpensTurn } from "./argv.js"

/**
 * One line, before its kind is known. A notification has `method` alone, an answer
 * `id` alone with `result` or `error`, and a request of the server's own has both.
 */
const Message = Schema.Struct({
  id: Schema.optional(Schema.Union(Schema.Number, Schema.String)),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Unknown),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ message: Schema.optional(Schema.String) })),
})

/** The answer to `thread/start` and `thread/resume`, which is where Codex names the thread. */
const ThreadAnswer = Schema.Struct({ thread: Schema.Struct({ id: Schema.String }) })

/** The answer to `turn/start`, which is where Codex names the turn this spawn is for. */
const TurnAnswer = Schema.Struct({ turn: Schema.Struct({ id: Schema.String }) })

/**
 * Which thread and turn a notification is about. A turn's own start and end name the
 * turn as `turn.id`; everything inside one names it as `turnId`.
 */
const Scope = Schema.Struct({
  threadId: Schema.optional(Schema.String),
  turnId: Schema.optional(Schema.String),
  turn: Schema.optional(Schema.Struct({ id: Schema.optional(Schema.String) })),
})

/**
 * A failed turn's error, on the `error` notification and again on `turn/completed`.
 * `codexErrorInfo` is a bare word for most kinds and an object keyed by the kind for
 * the ones that carry an HTTP status, so it is decoded as unknown and read by
 * `codexApiErrorKind`.
 */
const TurnError = Schema.Struct({
  message: Schema.optional(Schema.String),
  codexErrorInfo: Schema.optional(Schema.Unknown),
})

const ErrorParams = Schema.Struct({
  error: TurnError,
  willRetry: Schema.optional(Schema.Boolean),
})

const TurnParams = Schema.Struct({
  turn: Schema.Struct({
    id: Schema.optional(Schema.String),
    status: Schema.optional(Schema.String),
    error: Schema.optional(Schema.NullOr(TurnError)),
  }),
})

/**
 * Every counter optional: a usage block is the provider's own, and a field it stops
 * sending must read as zero rather than drop the count into `Unknown`.
 *
 * **The block carries `reasoningOutputTokens` and `totalTokens`, and neither is read,
 * on purpose.** The first is the flattened `output_tokens_details.reasoning_tokens`
 * of the Responses API, which counts a *part* of `outputTokens` rather than a sum
 * beside it — adding it would bill the reasoning twice. The second is a sum beside
 * the parts it sums.
 */
const TokenUsageParams = Schema.Struct({
  turnId: Schema.optional(Schema.String),
  tokenUsage: Schema.Struct({
    last: Schema.optional(
      Schema.Struct({
        inputTokens: Schema.optional(Schema.Number),
        cachedInputTokens: Schema.optional(Schema.Number),
        cacheWriteInputTokens: Schema.optional(Schema.Number),
        outputTokens: Schema.optional(Schema.Number),
      }),
    ),
  }),
})

/**
 * The usage block as the session log writes it — the same counters in the log's own
 * spelling, and the same two left unread.
 */
const LoggedUsage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  cached_input_tokens: Schema.optional(Schema.Number),
  cache_write_input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.optional(Schema.Number),
})

/**
 * One `token_count` record of the session log: `last_token_usage` is the model call
 * just made, `total_token_usage` the thread so far, and `model_context_window` the
 * window in tokens. `info` is `NullOr` because a record carrying only `rate_limits`
 * writes `null` there, and a Schema refusing it would drop the line into `Unknown`.
 */
const TokenCount = Schema.Struct({
  type: Schema.Literal("event_msg"),
  payload: Schema.Struct({
    type: Schema.Literal("token_count"),
    info: Schema.optional(
      Schema.NullOr(
        Schema.Struct({
          last_token_usage: Schema.optional(LoggedUsage),
          model_context_window: Schema.optional(Schema.Number),
        }),
      ),
    ),
  }),
})

/**
 * One item notification, whatever the item. Everything but the item's `type` is
 * optional because each item type carries its own fields and a line is decoded before
 * its type is known — a field required here would drop every other type's lines.
 */
const ItemParams = Schema.Struct({
  item: Schema.Struct({
    id: Schema.optional(Schema.String),
    type: Schema.String,
    text: Schema.optional(Schema.String),
    summary: Schema.optional(Schema.Array(Schema.String)),
    command: Schema.optional(Schema.String),
    status: Schema.optional(Schema.String),
    changes: Schema.optional(
      Schema.Array(
        Schema.Struct({
          path: Schema.optional(Schema.String),
          kind: Schema.optional(Schema.Struct({ type: Schema.optional(Schema.String) })),
        }),
      ),
    ),
    server: Schema.optional(Schema.String),
    tool: Schema.optional(Schema.String),
    // An `mcpToolCall`'s: what the model passed, and the server's result whole. Both
    // unread here beyond being handed on, and `null` until the call completes.
    arguments: Schema.optional(Schema.Unknown),
    result: Schema.optional(Schema.Unknown),
    query: Schema.optional(Schema.String),
    // `NullOr`: every `collabAgentToolCall` but the one that spawns writes `null` here.
    prompt: Schema.optional(Schema.NullOr(Schema.String)),
    // A `userMessage`'s: `null` on a turn's own prompt, and the `clientUserMessageId`
    // of the request on a message a client sent under one.
    clientId: Schema.optional(Schema.NullOr(Schema.String)),
    // Unknown, and decoded by `spokenText`: a `userMessage` carries input parts here
    // and a `reasoning` item carries strings under the same name.
    content: Schema.optional(Schema.Unknown),
  }),
})
type Item = Schema.Schema.Type<typeof ItemParams>["item"]

/**
 * A hook run's `hook/completed`. `turnId` is `NullOr` because a hook about the thread
 * rather than a turn writes `null` there, and a Schema refusing it would drop the line
 * into `Unknown`. Every field of `run` but the four read for a join or a colour is
 * optional, for `ItemParams`' reason.
 */
const HookParams = Schema.Struct({
  threadId: Schema.String,
  turnId: Schema.optional(Schema.NullOr(Schema.String)),
  run: Schema.Struct({
    id: Schema.String,
    eventName: Schema.String,
    status: Schema.String,
    sourcePath: Schema.optional(Schema.NullOr(Schema.String)),
    statusMessage: Schema.optional(Schema.NullOr(Schema.String)),
    durationMs: Schema.optional(Schema.NullOr(Schema.Number)),
    entries: Schema.optional(
      Schema.Array(Schema.Struct({ kind: Schema.String, text: Schema.String })),
    ),
  }),
})

/**
 * One window of an `account/rateLimits/updated` line. `usedPercent` is already 0–100, and
 * `resetsAt` is epoch seconds. Each window is decoded on its own, so one that fails to
 * decode drops that window rather than the line.
 */
const LimitWindow = Schema.Struct({
  usedPercent: Schema.Number,
  windowDurationMins: Schema.Number,
  resetsAt: Schema.optional(Schema.NullOr(Schema.Number)),
})

/**
 * The plan's quota, which Codex writes after each model call. Only the two windows are
 * read: the plan type, the credits and `rateLimitReachedType` are not drawn anywhere,
 * and the shape of a plan at its limit has not been captured.
 */
const RateLimitsParams = Schema.Struct({
  rateLimits: Schema.Struct({
    primary: Schema.optional(Schema.NullOr(Schema.Unknown)),
    secondary: Schema.optional(Schema.NullOr(Schema.Unknown)),
  }),
})

const InputParts = Schema.Array(Schema.Struct({ text: Schema.optional(Schema.String) }))
const asInputParts = Schema.decodeUnknownOption(InputParts)

/** What a `userMessage` item says, its text parts joined; empty where it carries none this reads. */
const spokenText = (content: unknown): string =>
  Option.getOrElse(asInputParts(content), () => [])
    .flatMap((part) => (part.text === undefined ? [] : [part.text]))
    .join("\n")

const asMessage = Schema.decodeUnknownOption(Message)
const asThreadAnswer = Schema.decodeUnknownOption(ThreadAnswer)
const asTurnAnswer = Schema.decodeUnknownOption(TurnAnswer)
const asScope = Schema.decodeUnknownOption(Scope)
const asErrorParams = Schema.decodeUnknownOption(ErrorParams)
const asTurnParams = Schema.decodeUnknownOption(TurnParams)
const asTokenUsage = Schema.decodeUnknownOption(TokenUsageParams)
const asTokenCount = Schema.decodeUnknownOption(TokenCount)
const asItemParams = Schema.decodeUnknownOption(ItemParams)
const asHookParams = Schema.decodeUnknownOption(HookParams)
const asLimitWindow = Schema.decodeUnknownOption(LimitWindow)
const asRateLimits = Schema.decodeUnknownOption(RateLimitsParams)

/** The window lengths the indicator draws, by `windowDurationMins`. Any other is dropped. */
const WINDOW_KINDS: Readonly<Record<number, PlanWindow["kind"]>> = {
  300: "five_hour",
  10080: "seven_day",
}

/** The windows a quota line carries; `undefined` where it carries none the indicator draws. */
const planWindowsOf = (
  limits: Schema.Schema.Type<typeof RateLimitsParams>["rateLimits"],
): readonly PlanWindow[] | undefined => {
  const windows = [limits.primary, limits.secondary].flatMap((raw): PlanWindow[] => {
    const w = Option.getOrUndefined(asLimitWindow(raw))
    const kind = w === undefined ? undefined : WINDOW_KINDS[w.windowDurationMins]
    if (w === undefined || kind === undefined) return []
    return [
      {
        kind,
        utilization: w.usedPercent,
        ...(w.resetsAt === undefined || w.resetsAt === null ? {} : { resetsAt: w.resetsAt * 1000 }),
      },
    ]
  })
  return windows.length > 0 ? windows : undefined
}

/**
 * A quota line as a `RateLimit`. It names no thread: the quota is the account's, so a
 * subagent's line is as true as the parent's. Nothing here says the plan is exhausted —
 * that arrives as the turn's own `usageLimitExceeded` error.
 */
const rateLimited = (params: unknown): readonly ProviderEvent[] | undefined => {
  const limits = asRateLimits(params)
  if (Option.isNone(limits)) return undefined
  return [
    ProviderEvent.RateLimit({
      exhausted: false,
      usingOverage: false,
      resetsAt: undefined,
      windows: planWindowsOf(limits.value.rateLimits),
    }),
  ]
}

/**
 * The notifications that are recognised and earn no event — the server's own
 * housekeeping, and the growth of an item whose completed form is the one read: a
 * message a token at a time, a command's output a chunk at a time. Named so that a
 * method the CLI ships later is `Unknown` and these are not.
 * A `warning` is here too: Codex warns about a model it has no metadata for and then
 * fails or runs the turn, and either way the turn's own ending says which.
 */
const SILENT: ReadonlySet<string> = new Set([
  "deprecationNotice",
  // A hook starting: its `hook/completed` carries everything this one does and how it
  // ended, and hooks take milliseconds.
  "hook/started",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "item/mcpToolCall/progress",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "mcpServer/startupStatus/updated",
  "remoteControl/status/changed",
  "thread/goal/cleared",
  "thread/started",
  "thread/status/changed",
  "turn/diff/updated",
  "warning",
])

// ============================================================================
// Classifying a failed turn — by Codex's own word for it, then by status code
// ============================================================================

const STATUS_KINDS: Record<string, ApiErrorKind> = {
  "401": "auth",
  "403": "auth",
  "429": "rate_limit",
  "500": "server",
  "502": "server",
  "503": "server",
}

/** The `codexErrorInfo` words a retry policy has a kind for. OpenAI's throttling and an exhausted quota are both `rate_limit`: the provider will not spend right now. */
const INFO_KINDS: Record<string, ApiErrorKind> = {
  usageLimitExceeded: "rate_limit",
  rateLimitExceeded: "rate_limit",
  serverOverloaded: "overloaded",
  internalServerError: "server",
  unauthorized: "auth",
}

/** The kind `codexErrorInfo` names, where it names one: a bare word, or an object whose one value carries `httpStatusCode`. */
const infoKind = (info: unknown): ApiErrorKind | undefined => {
  if (typeof info === "string") return INFO_KINDS[info]
  if (typeof info !== "object" || info === null) return undefined
  const details: readonly unknown[] = Object.values(info)
  for (const detail of details) {
    if (typeof detail === "object" && detail !== null && "httpStatusCode" in detail) {
      return STATUS_KINDS[String(detail.httpStatusCode)]
    }
  }
  return undefined
}

/**
 * Codex classifies a failed turn itself in `codexErrorInfo`, and that is read first.
 * Where it says `other` — an unknown model did — the message is a JSON string
 * embedding the API's own status, `{"type":"error","status":400,…}`, so the code is
 * read from it rather than matched as prose.
 *
 * Defaults to `unclassified`, on `ApiErrorKind`'s rule: a 400 is a request the API
 * refused, which is none of the kinds a retry policy would act on, and a message
 * that is not JSON at all says nothing a code could.
 */
export const codexApiErrorKind = (message: string, info?: unknown): ApiErrorKind => {
  const named = infoKind(info)
  if (named !== undefined) return named
  try {
    const parsed: unknown = JSON.parse(message)
    if (typeof parsed !== "object" || parsed === null || !("status" in parsed)) {
      return "unclassified"
    }
    return STATUS_KINDS[String(parsed.status)] ?? "unclassified"
  } catch {
    return "unclassified"
  }
}

/** What a turn's model calls have counted, in the shared events' terms. */
interface Counters {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheWriteTokens: number
  readonly cacheReadTokens: number
}

const NOTHING_COUNTED: Counters = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
}

/**
 * Codex's input count includes the cached part; the shared events carry the uncached
 * input alone, so the cache is taken back out. The same rule on the stream's per-call
 * count and on the session log's.
 */
const counted = (u: {
  readonly input: number | undefined
  readonly cached: number | undefined
  readonly cacheWrite: number | undefined
  readonly output: number | undefined
}): Counters => {
  const cached = u.cached ?? 0
  return {
    inputTokens: Math.max(0, (u.input ?? 0) - cached),
    outputTokens: u.output ?? 0,
    cacheWriteTokens: u.cacheWrite ?? 0,
    cacheReadTokens: cached,
  }
}

const parseJson = (line: string): Option.Option<unknown> => {
  if (line.trim() === "") return Option.none()
  try {
    const parsed: unknown = JSON.parse(line)
    return Option.some(parsed)
  } catch {
    return Option.none()
  }
}

// ============================================================================
// What an item did — the table that is a provider's whole share of it
// ============================================================================

/**
 * `name` is the item type, which is the nearest thing the stream has to a tool
 * name: `meter.ts` keys the histogram by it. A `collabAgentToolCall` is the
 * exception and is named by its own `tool` — see `itemEvents`. Every read and search arrives as a
 * `commandExecution` wrapping a shell, so `Read`, `Grep` and `Glob` all collapse to
 * `Bash` here — the extractor never parses a command to guess otherwise, and the
 * item's own `commandActions`, which is Codex's guess, is not read for that reason.
 *
 * A `fileChange` is one item over several paths, each with its own kind. `Write`
 * where every path is added; `Edit` where any is changed or deleted, since one edit
 * among adds is a change to what was there.
 */
const activityOf = (
  item: Item,
): { readonly kind: ActivityKind; readonly detail: string | undefined } | undefined => {
  switch (item.type) {
    case "commandExecution":
      return { kind: "Bash", detail: item.command }
    case "fileChange": {
      const changes = item.changes ?? []
      return {
        kind: changes.length > 0 && changes.every((c) => c.kind?.type === "add") ? "Write" : "Edit",
        detail: changes[0]?.path,
      }
    }
    case "mcpToolCall":
      return {
        kind: "Mcp",
        detail: item.server === undefined ? item.tool : `${item.server}/${item.tool ?? ""}`,
      }
    case "webSearch":
      return { kind: "WebSearch", detail: item.query }
    case "collabAgentToolCall":
      // One item type for every call that concerns a subagent, told apart by `tool`.
      // The one that spawns carries the task as `prompt` and is the delegation; the
      // rest — waiting on one, closing one — control work already drawn, and are
      // `Other` named by the tool, as the calls that control background work are
      // under Claude.
      return typeof item.prompt === "string"
        ? { kind: "Task", detail: item.prompt }
        : { kind: "Other", detail: undefined }
    default:
      return undefined
  }
}

/**
 * A reasoning item as one `Thinking` per summary part, with no count — Codex reports
 * reasoning tokens only inside the call's output count.
 *
 * **Completed only.** The item starts with an empty `summary` and completes with the
 * whole of it, so the start has nothing to draw and the pause the item stands for is
 * drawn where it lands. Without `model_reasoning_summary` it completes empty too, and
 * that is no event at all.
 *
 * Each part is a bold header — `**Planning patch application sequence**` — and never
 * the chain of thought, which travels sealed. Two parts are two thoughts, so each is
 * its own event. The bold markers come off here: the row draws a mono string and
 * would show the asterisks.
 */
const reasoningEvents = (summary: readonly string[]): readonly ProviderEvent[] =>
  summary
    .flatMap((part) => part.split("\n"))
    .map((part) =>
      part
        .trim()
        .replace(/^\*\*(.*)\*\*$/, "$1")
        .trim(),
    )
    .filter((part) => part !== "")
    .map((part) => ProviderEvent.Thinking({ tokens: undefined, text: part }))

/**
 * The events an item notification writes. `undefined` for an item type nothing here
 * reads, so the caller can file it as `Unknown` rather than silently produce nothing
 * — the distinction `provider-hazards` draws between *recognised and silent* and
 * *never seen*.
 *
 * A tool item starts as `ToolUse` and completes as `ToolResult` on the same
 * `item.id`, which is what joins them. An item with no `status` of its own — a web
 * search — completes as done.
 *
 * A `userMessage` carrying a `clientId` is a person's message reaching the model —
 * `codexDialogue` sends each under its key as `clientUserMessageId`, and Codex writes
 * the item when the model takes the message, which is after the tool call or the
 * subagent it was waiting on. That is `MessageDelivered`, on the item's start; the
 * completion repeats it. One with no `clientId` is a turn's own prompt read back, and
 * earns nothing.
 *
 * **A subagent's work is the one call that spawned it and nothing under it.** Its own
 * thread's items are dropped before they reach here, so a delegation draws as a
 * `Task` call with no rows of its own.
 */
const itemEvents = (
  phase: "item/started" | "item/completed",
  item: Item,
  remember: (text: string) => void,
): readonly ProviderEvent[] | undefined => {
  if (item.type === "userMessage") {
    if (phase !== "item/started" || typeof item.clientId !== "string") return []
    return [ProviderEvent.MessageDelivered({ text: spokenText(item.content), key: item.clientId })]
  }
  if (item.type === "agentMessage") {
    // Whole per message, at its completion: the deltas before it are the same text
    // a token at a time, and the start carries none.
    if (phase !== "item/completed" || item.text === undefined) return []
    remember(item.text)
    return [ProviderEvent.TextDelta({ text: item.text, parent: undefined })]
  }
  if (item.type === "reasoning") {
    return phase === "item/completed" ? reasoningEvents(item.summary ?? []) : []
  }
  const activity = activityOf(item)
  if (activity === undefined) return undefined
  if (phase === "item/started") {
    return [
      ProviderEvent.ToolUse({
        // A subagent call's item type is one word for five tools, so the tool is the
        // name there: `spawnAgent ×2, wait ×2` is what a person counts.
        name: item.type === "collabAgentToolCall" ? (item.tool ?? item.type) : item.type,
        ...activity,
        command: undefined,
        backgrounded: undefined,
        call: item.id,
        parent: undefined,
      }),
    ]
  }
  const ok = item.status === undefined || item.status === "completed"
  const outcome = ProviderEvent.ToolResult({ ok, call: item.id, parent: undefined })
  if (item.type !== "mcpToolCall" || item.id === undefined || item.tool === undefined) {
    return [outcome]
  }
  // The item carries the arguments and the server's result whole, which is everything
  // a view of the call draws from.
  return [
    outcome,
    ProviderEvent.McpReturned({
      call: item.id,
      server: item.server,
      tool: item.tool,
      arguments: item.arguments ?? {},
      result: resultOf(item.result, !ok),
    }),
  ]
}

/** The hook points that run around one tool call, whose run id ends in that call's item id. */
const TOOL_HOOKS: ReadonlySet<string> = new Set(["preToolUse", "postToolUse", "permissionRequest"])

const isHookStatus = (status: string): status is HookStatus =>
  HOOK_STATUSES.some((known) => known === status)

/**
 * A finished hook run as `HookRan`, or `undefined` where its status is one nothing here
 * colours — `running`, or a word Codex adds later — so the caller files it as `Unknown`.
 *
 * **The call is the text after the last `:` of the run's id**, which is the only place
 * the protocol names it: `pre-tool-use:0:<sourcePath>:<item id>`. The last part rather
 * than the fourth, because a source path holding a `:` shifts every part after it. Read
 * only for a tool hook; any other hook's id ends in something that is not a call.
 */
const hookRan = (run: Schema.Schema.Type<typeof HookParams>["run"]): ProviderEvent | undefined => {
  if (!isHookStatus(run.status)) return undefined
  const cut = run.id.lastIndexOf(":")
  return ProviderEvent.HookRan({
    call: TOOL_HOOKS.has(run.eventName) && cut !== -1 ? run.id.slice(cut + 1) : undefined,
    event: run.eventName,
    status: run.status,
    durationMs: run.durationMs ?? undefined,
    source: run.sourcePath ?? undefined,
    message: run.statusMessage ?? undefined,
    output: run.entries ?? [],
  })
}

const apiError = (error: Schema.Schema.Type<typeof TurnError>, fallback: string): ProviderEvent => {
  const message = error.message ?? fallback
  return ProviderEvent.ApiError({
    kind: codexApiErrorKind(message, error.codexErrorInfo),
    message,
  })
}

/**
 * How this turn ended, given what it counted and the last message it wrote. **Every
 * ending ends it**: a status nothing here knows, and
 * a body that does not decode, are failures and not `Unknown`, because the server
 * never exits on its own and a turn that settles neither a `Result` nor an error
 * is a process that waits without limit.
 */
const turnEnded = (
  params: unknown,
  spent: Counters,
  answer: string | undefined,
): readonly ProviderEvent[] => {
  const ended = Option.getOrUndefined(asTurnParams(params))
  const status = ended?.turn.status
  if (status === "completed") {
    return [
      // No dollar figure anywhere on the stream. Zero, and
      // the deferred entry *a codex trak's cost column reads 0 and nothing says why* carries
      // pricing the counters ourselves.
      ProviderEvent.Usage({ ...spent, runCostUsd: 0 }),
      ProviderEvent.Result({ text: answer ?? "" }),
    ]
  }
  // The same sentence arrives twice on a failed turn — an `error` notification,
  // then here — and the first fails the stream, so this is read only by a stream
  // that never saw the first.
  if (status === "failed") {
    return [apiError(ended?.turn.error ?? {}, "codex reported a failed turn")]
  }
  if (status === "interrupted") {
    return [
      ProviderEvent.ApiError({
        kind: "interrupted",
        message: "codex reported the turn interrupted",
      }),
    ]
  }
  return [
    ProviderEvent.ApiError({
      kind: "unclassified",
      message:
        status === undefined
          ? "codex ended the turn without a status this reader could find"
          : `codex ended the turn with status ${status}, which nothing here reads`,
    }),
  ]
}

/** The notifications that belong to one turn of one thread, and are read only where it is this spawn's. */
const TURN_SCOPED: ReadonlySet<string> = new Set([
  "error",
  "item/completed",
  "item/started",
  "thread/tokenUsage/updated",
  "turn/completed",
  "turn/started",
])

/**
 * A reader for one spawn. Handed to `Stream.mapConcat` line by line, and thrown
 * away with the process — the thread it remembers is the spawn's, and the turn, the
 * answer and the count are those of the turn in progress.
 */
export const codexNormalizer = (): ((line: string) => readonly ProviderEvent[]) => {
  let answer: string | undefined
  let thread: string | undefined
  let turn: string | undefined
  let spent = NOTHING_COUNTED

  /**
   * Whether a turn-scoped notification is about the turn this spawn started. It has
   * to name both ids, and both come from the requests' answers rather than from
   * `turn/started`: a subagent's `turn/started` arrives on this connection too, and
   * taken as the turn's it would hand the subagent the parent's ending.
   */
  const ours = (params: unknown): boolean => {
    const scope = Option.getOrUndefined(asScope(params))
    if (scope === undefined || thread === undefined || turn === undefined) return false
    return scope.threadId === thread && (scope.turnId ?? scope.turn?.id) === turn
  }

  /**
   * A hook run finishing. Read where it names this spawn's thread and either this turn
   * or none — a hook about the thread writes `null` for the turn — so a subagent's hooks
   * earn nothing, as its items do.
   */
  const hookCompleted = (params: unknown): readonly ProviderEvent[] | undefined => {
    const hook = asHookParams(params)
    if (Option.isNone(hook)) return undefined
    const { threadId, turnId, run } = hook.value
    if (threadId !== thread || (turnId !== undefined && turnId !== null && turnId !== turn)) {
      return []
    }
    const ran = hookRan(run)
    return ran === undefined ? undefined : [ran]
  }

  /** One per-call count, added to what the turn has spent. */
  const counting = (params: unknown): readonly ProviderEvent[] | undefined => {
    const usage = asTokenUsage(params)
    if (Option.isNone(usage)) return undefined
    const last = usage.value.tokenUsage.last
    if (last === undefined) return []
    const call = counted({
      input: last.inputTokens,
      cached: last.cachedInputTokens,
      cacheWrite: last.cacheWriteInputTokens,
      output: last.outputTokens,
    })
    spent = {
      inputTokens: spent.inputTokens + call.inputTokens,
      outputTokens: spent.outputTokens + call.outputTokens,
      cacheWriteTokens: spent.cacheWriteTokens + call.cacheWriteTokens,
      cacheReadTokens: spent.cacheReadTokens + call.cacheReadTokens,
    }
    return []
  }

  const notified = (method: string, params: unknown): readonly ProviderEvent[] | undefined => {
    if (SILENT.has(method)) return []
    if (method === "account/rateLimits/updated") return rateLimited(params)
    if (method === "hook/completed") return hookCompleted(params)
    if (!TURN_SCOPED.has(method)) return undefined
    // Another thread's line, or another turn's: a subagent at work, or the count a
    // resumed thread replays from the turn before. Recognised, and not this turn's.
    if (!ours(params)) return []
    if (method === "item/started" || method === "item/completed") {
      const item = asItemParams(params)
      if (Option.isNone(item)) return undefined
      return itemEvents(method, item.value.item, (text) => {
        answer = text
      })
    }
    if (method === "thread/tokenUsage/updated") return counting(params)
    if (method === "error") {
      const failed = asErrorParams(params)
      if (Option.isNone(failed)) return undefined
      // `willRetry` is Codex still trying, and the turn it is trying on has not
      // failed. It names no attempt and no wait, so there is no `ApiRetry` to write.
      if (failed.value.willRetry === true) return []
      return [apiError(failed.value.error, "codex reported an error")]
    }
    if (method === "turn/completed") {
      const ended = turnEnded(params, spent, answer)
      // A follow-on turn settles its own: what this one counted and said is spent.
      spent = NOTHING_COUNTED
      answer = undefined
      return ended
    }
    // `turn/started`: the turn's start is the spawn.
    return []
  }

  return (line: string): readonly ProviderEvent[] => {
    const json = parseJson(line)
    if (Option.isNone(json)) return []
    const raw = json.value
    const decoded = asMessage(raw)
    if (Option.isNone(decoded)) return [ProviderEvent.Unknown({ raw })]
    const message = decoded.value

    if (message.method !== undefined) {
      // A request of the server's own — an approval, a question for the person —
      // waits for an answer this client never writes, so the turn would never end.
      // `approvalPolicy: "never"` is what keeps one from being sent; one that
      // arrives anyway fails the turn, and the harness ends the process.
      if (message.id !== undefined) {
        return [
          ProviderEvent.ApiError({
            kind: "unclassified",
            message: `codex asked for ${message.method}, which nothing here answers`,
          }),
        ]
      }
      return notified(message.method, message.params) ?? [ProviderEvent.Unknown({ raw })]
    }

    // An answer. A refused opening request — a thread no rollout names, a turn the
    // server would not start — is the turn failing before it began. A refusal of any
    // later request is a message Codex would not take: `codexDialogue` answers it,
    // and failing here would fail a turn that is running or already answered.
    if (message.error !== undefined) {
      return message.id !== undefined && !codexOpensTurn(message.id)
        ? []
        : [apiError(message.error, "codex refused a request")]
    }
    const opened = asThreadAnswer(message.result)
    if (Option.isSome(opened)) {
      thread = opened.value.thread.id
      return [ProviderEvent.SessionStarted({ id: SessionId.make(thread) })]
    }
    const started = asTurnAnswer(message.result)
    if (Option.isSome(started)) turn = started.value.turn.id
    return []
  }
}

/**
 * One line of the session log Codex writes under its home, as the two readings the
 * stream is not read for — every other line produces nothing, and none of it is
 * `Unknown`: the log is Codex's own record of the thread, not a stream this reader
 * is held to cover.
 *
 * The window comes first so the run record written on the reading already holds it
 * — see `withTranscript`. `model` is absent on both: the log names no model beside
 * the count, and the thread runs one. `call` is absent too — one `token_count` per
 * call, so every reading is a call of its own and `meter.ts` adds each. A record with
 * `info: null` is a rate-limit notice and yields nothing. On a resumed thread every
 * earlier turn's records are in the file too, and `meter.ts` keeping the last is what
 * makes the turn's own the one that lands.
 */
export const codexRolloutLine = (line: string): readonly ProviderEvent[] => {
  const json = parseJson(line)
  if (Option.isNone(json)) return []
  const count = asTokenCount(json.value)
  if (Option.isNone(count)) return []
  const info = count.value.payload.info
  if (info === undefined || info === null) return []
  const window =
    info.model_context_window === undefined
      ? []
      : [ProviderEvent.ContextWindow({ model: undefined, tokens: info.model_context_window })]
  const reading =
    info.last_token_usage === undefined
      ? []
      : [
          ProviderEvent.Occupancy({
            model: undefined,
            call: undefined,
            ...counted({
              input: info.last_token_usage.input_tokens,
              cached: info.last_token_usage.cached_input_tokens,
              cacheWrite: info.last_token_usage.cache_write_input_tokens,
              output: info.last_token_usage.output_tokens,
            }),
          }),
        ]
  return [...window, ...reading]
}

// ============================================================================
// MCP — the answers to what the harness asks
// ============================================================================

/**
 * An answer to a request `codexMcpRequest` framed: a line with an id from that range
 * and no `method`. A refusal carries Codex's own sentence.
 */
export const codexMcpReply = (line: string): McpReply | undefined => {
  const message = Option.getOrUndefined(Option.flatMap(parseJson(line), asMessage))
  if (message === undefined || message.method !== undefined) return undefined
  if (typeof message.id !== "number" || message.id <= CODEX_MCP_IDS) return undefined
  const n = message.id - CODEX_MCP_IDS
  return message.error === undefined
    ? { n, body: message.result, error: undefined }
    : { n, body: undefined, error: message.error.message ?? "codex refused it" }
}

const listedTools = (body: unknown): readonly McpTool[] => {
  const servers = fieldsOf(body)["data"]
  if (!Array.isArray(servers)) return []
  return servers.flatMap((entry: unknown): readonly McpTool[] => {
    const server = fieldsOf(entry)
    const name = server["name"]
    if (typeof name !== "string") return []
    return Object.values(fieldsOf(server["tools"])).flatMap((listed): readonly McpTool[] => {
      const tool = fieldsOf(listed)
      const called = tool["name"]
      if (typeof called !== "string") return []
      // A call's item names the server and the tool apart, so the bare name is the join.
      return [{ server: name, name: called, callName: called, ...toolView(tool["_meta"]) }]
    })
  })
}

/**
 * An answer's body as what was asked for. `mcpServerStatus/list` keys each server's
 * tools by name, and a call's result is the server's own, unchanged.
 */
export const codexMcpAnswer = (request: McpRequest, body: unknown): McpAnswer | undefined => {
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
