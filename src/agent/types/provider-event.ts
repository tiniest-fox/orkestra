// types: the normalization boundary every provider and transport reduces to.

import { Data, Schema } from "effect"
import type { McpResult } from "./mcp.js"
import type { Place } from "./place.js"
import type { PlanWindow } from "./plan-usage.js"
import type { SessionId } from "./session.js"

/**
 * How a turn ended badly, as a closed set rather than a sentence.
 *
 * The kinds are drawn by **what a consumer would do differently**, not by what the
 * provider called it: `rate_limit` and `auth` mean a retry lands in the same place,
 * `overloaded`, `server` and `interrupted` mean it probably does not. Nothing branches
 * on this yet — `Failure{provider}` still covers all of them — and that is the point of
 * naming it now: the classification has to exist before a retry policy can read it.
 *
 * **`unclassified` is `Unknown`'s counterpart and stays forever.** A message shape we
 * have not seen must degrade to it, never to the nearest-looking kind: a wrong kind is
 * worse than no kind, because it is actionable and wrong.
 *
 * `rate_limit` is deliberately the broad one — throttling, a usage limit, an empty
 * balance. All three mean the provider will not spend right now and the fix is time or
 * money rather than another request, which is one consumer action, not three.
 *
 * `interrupted` is the transport going rather than the API answering: the connection
 * dropped part-way through a reply, so there is no status and nothing was refused. It is
 * its own kind because it is the one failure that says nothing at all about the request
 * — a consumer may re-run it immediately, where every other kind here says wait or fix
 * something first.
 *
 * A `Schema` as well as a type, because the classification is carried on `TurnFailed` and
 * `TrakState.Failed` and therefore has to be read back out of a stored log.
 */
export const ApiErrorKind = Schema.Literal(
  "rate_limit",
  "overloaded",
  "server",
  "auth",
  "interrupted",
  "unclassified",
)
export type ApiErrorKind = Schema.Schema.Type<typeof ApiErrorKind>

/**
 * What a tool call *did*, as a closed set — the part of a call worth showing a person
 * watching a trak, and the only part three coding-agent CLIs agree on.
 *
 * **The names are the ones Claude and OpenCode already share** (`bash`, `read`, `grep`),
 * so a provider's extractor is a table rather than a translation. Where they differ only
 * in spelling — `TodoWrite` against `todowrite`, `Task` against `task` — the shared stem
 * is the kind.
 *
 * **`Other` is the escape hatch and is not a failure**, the same principle `Unknown`
 * states about a stream kind: an unclassified tool is a no-op. It is where a provider
 * whose stream says less than Claude's degrades to.
 *
 * **`Mcp` is a call to a tool an external server supplies**, whichever provider made it.
 * Its `detail` is `server/tool` and its `name` is `mcp_tool_call` under every provider, so
 * a surface draws the server and tool once and never the provider's own spelling.
 *
 * `Grep` and `Glob` stay apart, and so do `Edit` and `Write`: two providers draw the
 * distinction, and two kinds collapsed lose information no later change recovers.
 */
export const ACTIVITY_KINDS = [
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
] as const

export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

/**
 * How a task ended, as the closed set every consumer draws from.
 *
 * **`stopped` is the one this vocabulary exists for.** A task killed at the provider's
 * teardown and one a person asked to stop both report it, and neither is a success or a
 * failure — a surface that has only `ok` to read draws a stopped task as one of the two,
 * and both readings are wrong. Absent means the provider used a word outside the set,
 * which degrades to `ok` — the same direction `Unknown` takes.
 */
export const TASK_OUTCOMES = ["completed", "failed", "stopped"] as const

export type TaskOutcome = (typeof TASK_OUTCOMES)[number]

/**
 * One entry of a `BackgroundTasks` level: the provider's own opaque task id, and what the
 * task is. `taskType` is the provider's registry word (`local_bash`, `local_agent`);
 * `description` is what a surface names the job by.
 */
export interface BackgroundTask {
  readonly id: string
  readonly taskType: string | undefined
  readonly description: string | undefined
}

/**
 * How a hook run ended, as the closed set a surface colours by. `blocked` is a hook that
 * stopped the call on purpose and `stopped` one that stopped the turn; `failed` is the
 * hook itself going wrong, which leaves the call it wrapped alone.
 */
export const HOOK_STATUSES = ["completed", "failed", "blocked", "stopped"] as const

export type HookStatus = (typeof HOOK_STATUSES)[number]

/**
 * One line a hook printed, as the provider classified it — `warning`, `stop`, `feedback`,
 * `context`, `error` under Codex. The kind is carried as the provider's word rather than
 * a closed set: it only picks an ink, and a word added later should draw rather than drop
 * the line.
 */
export interface HookOutput {
  readonly kind: string
  readonly text: string
}

/** `Unknown` is deliberate: a new upstream event kind is a no-op, not a failure. */
export type ProviderEvent = Data.TaggedEnum<{
  /**
   * The agent process exists, before it has said anything. Emitted by the
   * harness (`cli-provider.ts`), never parsed from a line — so a provider's
   * `normalize` never has to produce it.
   *
   * `withTranscript` in `runtime.ts` is what turns this into a recorded fact,
   * so a crash can later be told apart from a stray. The scripted provider
   * emits it too, with a fabricated pid: it once did not, on the argument that
   * it has no process, and the result was that a crashed turn in a flow test
   * never exercised the `runs.spawned` path a crashed turn is the whole reason
   * for. A fake that omits the events a failure is diagnosed by cannot test the
   * diagnosis.
   */
  Spawned: {
    readonly pid: number
    /** The runner's id for the command, on a spawn that runs in a sandbox — see `Spawned.execId`. */
    readonly execId?: string
    /** Where the command runs — `Local` on this machine. See `Spawned.place`. */
    readonly place?: Place
    /** The command outlives the engine in its sandbox — see `Spawned.detached`. */
    readonly detached?: true
  }
  /**
   * The response was not a value of the schema, and the same ask is going again on
   * the same session. Emitted by `elicit`, never parsed from a line — like `Spawned`,
   * it is the harness saying what it just did.
   *
   * **It is what tells a reader that two documents are one answer.** A re-ask spawns
   * a second `claude`, and one `claude` is otherwise one turn — so without this the
   * transcript shows a turn that filed nothing followed by a turn that filed
   * everything, while the log records a single ending for the whole loop. A consumer
   * that counted spawns against endings would then hang a gate's press on a turn with
   * no document under it.
   *
   * `reason` is the sentence the agent is shown, so a reader sees what it was told to
   * fix rather than only that something went wrong.
   */
  Reask: { readonly reason: string }
  /** `parent` is the delegating call, and absent on the parent agent's own words. */
  TextDelta: { readonly text: string; readonly parent: string | undefined }
  /**
   * One tool call, as the activity it performed rather than the tool it named.
   *
   * **`name` is the provider's own** — `Read`, `Bash`, `mcp__linear__issue`. It is what
   * `meter.ts` keys the tool histogram by, so `ork record` stays provider-exact: keying
   * by kind would silently turn `Edit ×40` beside `MultiEdit ×12` into one `Edit ×52`,
   * in a document a human reads to judge a trak.
   *
   * `detail` is the one value worth showing — a path, a command, a pattern — carried
   * whole rather than truncated, because how much of a 1 KB command fits is a question
   * about a pane, not about the fact. Absent for `Todo` and for most of `Other`.
   *
   * **`command` is the command behind a `detail` that is not it** — a shell call whose
   * agent wrote a description of it, where the description is the `detail` because it is
   * written to be read. Absent wherever `detail` already is the command, so nothing on
   * the wire says the same thing twice.
   *
   * **`backgrounded` is a fact about the call, not about delegation**: `Bash` takes
   * `run_in_background` exactly as `Agent` does. It is the only thing on the wire that
   * says the turn did not wait, which is what separates a subagent the turn is blocked
   * on from one it is not. Absent means inline, and absent is also what a provider with
   * no such concept says.
   *
   * **`call` and `parent` are the two halves of one opaque provider id**, the same
   * category as a `SessionId`: `call` names this call so a delegation's own lines can
   * point at it, and `parent` is the delegation this line happened *inside*. Both absent
   * on a provider that gives no ids, which costs only the nesting.
   *
   * Order cannot stand in for either. A background subagent runs while the parent keeps
   * working, so the two interleave, and a rule reading arrival order files one agent's
   * work under the other.
   */
  ToolUse: {
    readonly name: string
    readonly kind: ActivityKind
    readonly detail: string | undefined
    readonly command: string | undefined
    readonly backgrounded: boolean | undefined
    readonly call: string | undefined
    readonly parent: string | undefined
  }
  /**
   * A tool's answer coming back, which every agent CLI echoes and none of them
   * previously had a name for here — Claude sends it as a `user` message carrying a
   * `tool_result`, so it fell into `Unknown` once per tool call.
   *
   * `ok` and not the payload: the content is often a whole file, and the question a
   * watcher asks is whether the step is making progress or fighting its tools.
   *
   * **`call` is the id of the `ToolUse` it answers**, which is what makes an outcome
   * *matched* rather than counted. Counting it is what a reader has to do without one, and
   * counting is wrong the moment a turn dispatches two calls at once and they come back in
   * the other order — the parallel case a delegation makes ordinary. Absent from a provider
   * that does not report one, so a consumer still owes an answer for an outcome naming
   * nothing.
   *
   * `parent` as on `ToolUse`.
   */
  ToolResult: {
    readonly ok: boolean
    readonly call: string | undefined
    readonly parent: string | undefined
  }
  /**
   * A hook the CLI ran — a script the person configured around a tool call or a turn —
   * once it has finished. One per hook run; its start earns nothing, since hooks take
   * milliseconds and one line per run keeps the join simple.
   *
   * **`call` is the tool call it ran for, and nothing here confirms it.** A pre-call hook
   * reports before its call exists, so a surface joins the two on `call` and owes a rule
   * for a hook naming no call it can find — absent on a hook about the turn rather than a
   * call.
   *
   * `event` is the provider's own name for the hook point, `preToolUse` under Codex.
   * `source` is the file that configured the hook, and `message` the provider's own word
   * on how it ended, where it gives one.
   */
  HookRan: {
    readonly call: string | undefined
    readonly event: string
    readonly status: HookStatus
    readonly durationMs: number | undefined
    readonly source: string | undefined
    readonly message: string | undefined
    readonly output: readonly HookOutput[]
  }
  /**
   * The CLI refused a tool call without asking anyone — under Claude's auto mode, its
   * classifier blocking the call. Beside the call's error `ToolResult`, which says only
   * that the call failed; this says why.
   *
   * `call` is the denied call's id, the join a surface draws it on. `reason` is the
   * provider's own word for what refused it — under Claude a classifier rule in
   * brackets, `[Safety Bypass Flag]` — and `source` what kind of thing refused it,
   * `classifier` or `rule`. Both are carried as the provider wrote them: a rule added
   * upstream should draw rather than drop the line.
   */
  PermissionDenied: {
    readonly call: string | undefined
    readonly tool: string
    readonly reason: string | undefined
    readonly source: string | undefined
  }
  /**
   * A call to an MCP tool coming back, with what a view of it draws from: the arguments
   * the model passed and the whole result. Beside the call's `ToolResult`, never in
   * place of it.
   *
   * **Never written to the transcript.** A result is often large, and `ToolResult`
   * carries `ok` rather than the payload for that reason; this event exists for the one
   * consumer that keeps a view, and is dropped for a tool that declares none.
   *
   * `tool` is the name as the provider's call named it and `server` is absent where
   * that name is qualified — see `McpTool.callName`. Only the agent's own calls earn
   * one: a call made inside a delegation draws no view.
   */
  McpReturned: {
    readonly call: string
    readonly server: string | undefined
    readonly tool: string
    readonly arguments: unknown
    readonly result: McpResult
  }
  /**
   * A delegation starting: the agent handed a piece of work to a subagent, and `call`
   * is the tool call that handed it over.
   *
   * **The head of a group, which is why it is a tag of its own and not a `Note`** — a
   * note is the engine's bookkeeping and a surface may fold it away, taking the whole
   * delegation's identity with it.
   *
   * `agentType` and `description` are optional because the provider's own bracket line
   * is a status broadcast: a field it stops sending must read as "did not say" rather
   * than drop the delegation entirely. `prompt` is the brief the subagent was given,
   * carried here so it is attributed to the call rather than to the agent that wrote it.
   */
  SubagentStarted: {
    readonly call: string
    readonly agentType: string | undefined
    readonly description: string | undefined
    readonly prompt: string | undefined
  }
  /**
   * What a task reported when it ended, for the `call` that asked — a subagent's answer,
   * and equally a background command's completion.
   *
   * `summary` is the subagent's return value and is the one thing about a delegation
   * that reaches nothing else here — the parent agent reads it, and until now no record
   * of a trak held it at all.
   *
   * `outcome` is the report's own word, carried only when it is one of `TASK_OUTCOMES` —
   * so `stopped` is distinguishable from the success `ok` still guesses it into, and an
   * unrecognised word degrades to that guess rather than to a wrong outcome. `taskId` is
   * the provider's task handle, the join onto the `BackgroundTasks` level that says
   * whether this task was background work; absent on a provider that reports none.
   */
  SubagentResult: {
    readonly call: string
    readonly ok: boolean
    readonly summary: string | undefined
    readonly outcome: TaskOutcome | undefined
    readonly taskId: string | undefined
  }
  /**
   * The full set of background tasks alive right now — a level with REPLACE semantics,
   * emitted only on change, never an edge.
   *
   * **The last one seen is the whole answer to "is anything still running".** Nothing on
   * the turn's own `Result` says so, which is why this is carried as state: whether a turn
   * ended with work outstanding is this set as it stood at that moment. An empty list is a
   * real event — it is how the set goes quiet — and consumers must not read it as "never
   * said".
   *
   * The level carries no `tool_use_id`; `BackgroundStarted` below arrives beside it and
   * is the join onto the call that started each task.
   */
  BackgroundTasks: { readonly tasks: readonly BackgroundTask[] }
  /**
   * A backgrounded task registering, with the join the level cannot say: `taskId` is the
   * handle the levels and the stop control speak, `call` is the tool call that started it.
   * It arrives within milliseconds of the level that first names the task and before the
   * call's own `tool_result`, so an outstanding task is attributable the moment it exists.
   *
   * Emitted only for a task the provider marks backgrounded — an inline slow command
   * registers a task too, and one line per `pnpm verify` would say nothing a transcript
   * needs. Emitted for a backgrounded delegation as well as a shell command: the
   * `SubagentStarted` beside it carries no task id, and the delegation's card needs one
   * for the same two reasons.
   */
  BackgroundStarted: {
    readonly taskId: string
    readonly call: string
    readonly description: string | undefined
  }
  /**
   * The model reasoning before it says anything — the dead air a watcher most wants
   * explained, and the largest single source of `Unknown` before it was named.
   *
   * `tokens` is the provider's own running estimate and may be absent, because it is
   * Claude's `estimated_tokens` and the next provider may report thinking without a
   * count. It is **not** in the transcript line: `withTranscript` records one line per
   * burst rather than per tick, and the first tick's estimate under-reports the burst
   * it stands for. A live Observer has the whole event and can say more.
   *
   * `text` is the provider's own summary of the pass, where it gives one — Codex writes
   * a header per reasoning part, `Planning file size counting method`, and Claude's
   * ticks carry none. **A brief label, never the chain of thought**: it is drawn on one
   * row of a log, and the row truncates. It *is* in the transcript line, because it is
   * the one thing about a pause a reader can use after the turn has moved on — and two
   * ticks carrying different text are two thoughts rather than one burst.
   */
  Thinking: { readonly tokens: number | undefined; readonly text: string | undefined }
  /**
   * What the provider says about your quota, unprompted. **Not a failure** — a
   * captured fixture carries one reading "rejected" on a turn that finished
   * cleanly on overage, so a guard that treated it as one would fail healthy
   * turns.
   *
   * Three typed facts rather than the provider's own payload, which is where a
   * `SystemEvent({ kind: string })` would have gone wrong: a passthrough label
   * makes every consumer switch on strings the compiler cannot check, and the
   * shared vocabulary stops being shared. Every rate-limited API can answer these
   * three; none of them has to spell them the same way.
   *
   * `resetsAt` is epoch **seconds**, as the provider reports it — carried rather
   * than converted, because it is sourced rather than synthesised, and it is the
   * one number that answers "how long do I wait". A unit that turns out wrong
   * renders as 1970 in the transcript, which is a visible failure rather than a
   * quiet one.
   *
   * `windows` is how much of each plan window the account has used, converted to
   * `PlanWindow`'s units, and is what the engine's plan usage is read from. Absent where
   * the provider said nothing usable about them — an older CLI writes the event without.
   */
  RateLimit: {
    readonly exhausted: boolean
    readonly usingOverage: boolean
    readonly resetsAt: number | undefined
    readonly windows: readonly PlanWindow[] | undefined
  }
  /**
   * The session this turn is running in. **One turn may report it more than once with
   * the same id** — Claude re-announces the session every time it picks it back up to
   * drain background work — so a consumer that counts these is counting re-entries,
   * not sessions.
   */
  SessionStarted: { readonly id: SessionId }
  /**
   * What one turn ended by saying — **an invocation may report several.**
   *
   * A provider ends more than one turn inside one invocation: Claude keeps the process
   * alive after ours so background work can report back, and each turn it gives itself
   * ends with a `result` line of its own. Which of them make the answer is
   * `answering`'s rule, and the harness withholds the ones written after the answer
   * was complete — see `SessionRequest.settles`.
   */
  Result: { readonly text: string }
  /**
   * The model has received a message a person sent while the turn was running — the
   * moment of delivery, which lags the write by whatever the model was doing: a message
   * written during a tool call is read when that call ends.
   *
   * `key` is the handle the message was steered with (`ProviderAdapter.steer`). A
   * normalizer fills it where the CLI's report names it, as Codex's does; where the
   * CLI echoes only the text, as Claude's does, the normalizer leaves it absent and
   * `cli-provider.ts` pairs the text with a message it wrote down this turn's pipe.
   * One the harness cannot pair — the turn's own prompt, which a CLI echoes the same
   * way — never leaves it, so every one a consumer sees names a steered message.
   */
  MessageDelivered: { readonly text: string; readonly key: string | undefined }
  /**
   * What the provider says it has spent, as of this report.
   *
   * `inputTokens` is the *uncached* input only, which is why it reads as absurdly
   * small — a real turn is nearly all cache. Without the two cache counters a
   * `Usage` line says "2 in, 3695 out, $0.32" and invites the wrong conclusion,
   * namely that the agent's narration is what costs money.
   *
   * **The token counters are this report's own; the cost is this CLI run's, to date.**
   * The split is the provider's rather than a choice made here — Claude's
   * `total_cost_usd` counts every model call the run has paid for, subagents included,
   * and starts again from nothing on each spawn, a `--resume` included — so the field
   * is named for what it measures. A turn with background work reports three times,
   * and adding those three costs bills it nearly three times over. `meter.ts` is where
   * the two rules meet.
   */
  Usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cacheWriteTokens: number
    readonly cacheReadTokens: number
    readonly runCostUsd: number
  }
  /**
   * What the model's context window held at one call — the whole input side, cache
   * included, and that call's output.
   *
   * **Kept as the last reading, never added**, which is the opposite rule from `Usage`:
   * every call re-reads the conversation, so a turn's readings summed come to several
   * windows' worth for a window that never filled. `meter.ts` keeps the latest.
   *
   * One per model call of the turn's own conversation, and none for a subagent's — its
   * window is its own. A provider may emit the same reading more than once for one
   * call, which the last-wins rule makes harmless.
   *
   * `model` is the provider's own name for what answered the call, where it says one,
   * and is what pairs the reading with a `ContextWindow` when a turn ran more than one
   * model. `outputTokens` is partial where the provider reports the call as it starts.
   *
   * `call` is the provider's own id for the model call, where it gives one — Claude's
   * `message.id`, repeated on every content block of the call. It is what lets
   * `meter.ts` add a call's reading to the running estimate once however many times it
   * is emitted; absent, every reading counts, which is right for a provider that emits
   * one per call and names none, as Codex does.
   */
  Occupancy: {
    readonly model: string | undefined
    readonly call: string | undefined
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cacheWriteTokens: number
    readonly cacheReadTokens: number
  }
  /**
   * How many tokens a model's context holds, as the provider itself reports it.
   *
   * One per model the turn's invocation used — Claude reports it per model on the
   * `result` line, subagents' models included — so `model` is what says which; absent
   * where the provider names none, which reads as the turn's own. `meter.ts` keeps the
   * one matching the last `Occupancy`'s model.
   */
  ContextWindow: { readonly model: string | undefined; readonly tokens: number }
  /**
   * The log a CLI keeps beside its stream was read, at this absolute path — emitted by the
   * harness after the exit, never parsed from a line. It is how the engine knows which of
   * the files a CLI files by date rather than by checkout are its own, so a backup holds
   * them; nothing else reacts to it.
   */
  SessionLogRead: { readonly path: string }
  /**
   * The provider's HTTP call failed on something retryable and it is going again — one
   * of these per attempt, and the turn carries on either way.
   *
   * **Not an `ApiError`, and not a failure.** It is the pause a watcher is already
   * looking at, explained: without it a turn that spent ninety seconds backing off
   * through three 529s is indistinguishable from a model thinking. `ApiError` is the
   * same trouble once the provider has stopped trying.
   *
   * `of` is the provider's own ceiling, so a consumer can say *attempt 2 of 5* without
   * knowing the retry policy. `status` is absent when there was no HTTP response at all
   * — a timeout or a dropped connection — and `waitedMs` is the delay before the next
   * try.
   *
   * **The provider's own error sentence is deliberately not carried.** `ApiError` keeps
   * one because it is the only account of a turn that ended; a retry that succeeded
   * needs no evidence, and `status` is the part a reader acts on. Nothing in the domain
   * reacts to this at all — a retry policy reading it is separate work.
   */
  ApiRetry: {
    readonly attempt: number
    readonly of: number
    readonly status: string | undefined
    readonly waitedMs: number | undefined
  }
  /**
   * The turn was interrupted by a known failure mode. **The message is kept always** —
   * the kind is the handle a policy reads, the sentence is the evidence a human reads,
   * and `ProviderFailed.reason` carries it verbatim into `ork resume`.
   */
  ApiError: { readonly kind: ApiErrorKind; readonly message: string }
  Unknown: { readonly raw: unknown }
}>
export const ProviderEvent = Data.taggedEnum<ProviderEvent>()
