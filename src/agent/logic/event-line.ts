// logic: one provider event as one line of text.
//
// Not `event._tag`: that renders every tool call as the indistinguishable string
// "ToolUse", and a list of those answers "how many tools" and nothing else. The
// name and what it acted on are the parts worth keeping, and both are normalized.
//
// This is a **log line**, printed by `pnpm real`, `pnpm real:trak` and `smoke.ts`.
// The store keeps a `TranscriptEntry` instead — a line and a UI row are different
// jobs, and only one of them can be styled.

import { Match } from "effect"
import type { ProviderEvent } from "../types/provider-event.js"

/**
 * The upstream name for a payload nothing models — `system/thinking_tokens`,
 * `rate_limit_event` — read defensively, because `raw` is by definition a shape
 * this codebase has never seen.
 *
 * It exists because "Unknown" alone was a dead end: a transcript of 367 identical
 * words says something is being dropped and refuses to say what. With the kind in
 * it, every transcript is the report `pnpm smoke` currently has to be run by hand
 * to produce — which is why `smoke.ts` names kinds through this function too,
 * rather than keeping a second copy of the convention.
 */
export const rawKind = (raw: unknown): string => {
  if (typeof raw !== "object" || raw === null) return "unrecognised"
  const record: Record<string, unknown> = { ...raw }
  // Codex's app server names a line by `method` and has no `type` at the top; an
  // item notification carries the item under `params`, and its `type` is the word
  // that says what it was.
  const method = record["method"]
  if (typeof method === "string") {
    const params = record["params"]
    const item =
      typeof params === "object" && params !== null && "item" in params ? params.item : undefined
    return typeof item === "object" && item !== null && "type" in item
      ? `${method}/${String(item.type)}`
      : method
  }
  if (!("type" in record)) return "unrecognised"
  const type = String(record["type"])
  const subtype = record["subtype"]
  if (typeof subtype === "string") return `${type}/${subtype}`
  return type
}

/** Terse by design: this is a log line, and one turn produces many. */
export const eventLine = (event: ProviderEvent): string =>
  Match.value(event)
    .pipe(
      Match.tag("Spawned", (e) => `Spawned(pid=${e.pid})`),
      Match.tag("Reask", (e) => `Reask(${e.reason})`),
      // The provider's own name, not the kind: a log line is read beside the CLI that
      // produced it, and `Bash` is what a person watching that CLI saw.
      Match.tag("ToolUse", (e) => (e.detail === undefined ? e.name : `${e.name}(${e.detail})`)),
      Match.tag("TextDelta", (e) => `TextDelta(${e.text.length} chars)`),
      Match.tag("SessionStarted", (e) => `SessionStarted(${e.id})`),
      Match.tag("Result", (e) => `Result(${e.text.length} chars)`),
    )
    .pipe(
      // A second `pipe` because one takes twenty arguments, and there are more tags.
      // The length, as for the agent's own text: the words are a person's, and the
      // stored entry keeps them.
      Match.tag("MessageDelivered", (e) => `MessageDelivered(${e.text.length} chars)`),
      Match.tag(
        "Usage",
        // Cache first: it is the large number, and the one that explains the cost. The
        // cost is labelled because it is this CLI run's running total rather than this
        // report's share — three of these on one turn are three readings of one number.
        (e) =>
          `Usage(${e.cacheReadTokens} cached + ${e.cacheWriteTokens} written + ${e.inputTokens} in, ` +
          `${e.outputTokens} out, $${e.runCostUsd.toFixed(4)} this run)`,
      ),
      Match.tag(
        "Occupancy",
        (e) =>
          `Occupancy(${e.cacheReadTokens} cached + ${e.cacheWriteTokens} written + ${e.inputTokens} in, ` +
          `${e.outputTokens} out${e.model === undefined ? "" : `, ${e.model}`})`,
      ),
      Match.tag(
        "ContextWindow",
        (e) => `ContextWindow(${e.tokens}${e.model === undefined ? "" : `, ${e.model}`})`,
      ),
      Match.tag("SessionLogRead", (e) => `SessionLogRead(${e.path})`),
      // No token count, deliberately: `withTranscript` records one of these per burst
      // of ticks, so the first tick's estimate would stand for a burst many times its
      // size. The number is on the event for whoever watches it live. The summary is
      // kept: it is the line's whole content where a provider gives one, and the client
      // reads it back off this prefix (`isPause`, `pauseText` in `turns.ts`).
      Match.tag("Thinking", (e) => (e.text === undefined ? "Thinking" : `Thinking: ${e.text}`)),
      Match.tag("ToolResult", (e) => `ToolResult(${e.ok ? "ok" : "error"})`),
      Match.tag("HookRan", (e) => `Hook(${e.event}, ${e.status})`),
      Match.tag(
        "PermissionDenied",
        (e) => `Denied(${e.tool}${e.reason === undefined ? "" : `, ${e.reason}`})`,
      ),
      // The tool and nothing of the payload, which is the size of a document.
      Match.tag(
        "McpReturned",
        (e) => `McpReturned(${e.server === undefined ? "" : `${e.server}/`}${e.tool})`,
      ),
      // What the subagent was asked for, preferred over what it is: a log read beside the
      // CLI wants the job, and the agent type is the same word on every line of a fleet.
      Match.tag("SubagentStarted", (e) => `Subagent(${e.description ?? e.agentType ?? "started"})`),
      Match.tag("SubagentResult", (e) => `SubagentResult(${e.outcome ?? (e.ok ? "ok" : "error")})`),
      // The count, not the ids: a log line answers "is anything still running", and the
      // set's members are on the stored entry for whatever needs them.
      Match.tag("BackgroundTasks", (e) => `Background(${e.tasks.length} outstanding)`),
      Match.tag("BackgroundStarted", (e) => `Backgrounded(${e.description ?? e.taskId})`),
      // `resetsAt` is epoch seconds as the provider reports it, rendered rather than
      // stored so a wrong unit shows up as 1970 instead of hiding in a number.
      Match.tag("RateLimit", (e) => {
        const state = [
          e.exhausted ? "exhausted" : "ok",
          ...(e.usingOverage ? ["on overage"] : []),
          ...(e.resetsAt === undefined
            ? []
            : [`resets ${new Date(e.resetsAt * 1000).toISOString()}`]),
        ]
        return `RateLimit(${state.join(", ")})`
      }),
      // The status where `ApiError` puts its kind, and absent on a transport failure that
      // never got one — a log line reading `ApiRetry(2/5)` is the honest shape of "we do
      // not know why", not a gap to fill with a word.
      Match.tag(
        "ApiRetry",
        (e) =>
          `ApiRetry(${e.status === undefined ? "" : `${e.status}, `}attempt ${e.attempt}/${e.of})`,
      ),
      // The kind first, because it is the part a policy would read; the sentence stays
      // because it is the only description of what actually happened.
      Match.tag("ApiError", (e) => `ApiError(${e.kind}: ${e.message})`),
      Match.tag("Unknown", (e) => `Unknown(${rawKind(e.raw)})`),
      Match.exhaustive,
    )
