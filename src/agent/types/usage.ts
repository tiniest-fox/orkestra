// types: what one turn spent, as the log keeps it.
//
// In `agent/` rather than beside the events that carry it, because a turn is what
// this module runs and `workflow/` is not allowed to reach in here for the shape —
// nor `agent/` out for the event. `SessionId` crosses the same way.

import { Schema } from "effect"

/**
 * What the model's context window held at one call: the whole input side, cache
 * included, and the output of that call.
 *
 * **A reading, not a sum.** Every other counter on `Usage` is added across a turn's
 * reports; this is the last one measured, because a conversation re-read at every call
 * summed over a turn comes to several windows' worth for a window that never filled.
 *
 * `outputTokens` is short by the rest of the reply where the provider reports the call
 * as it starts — Claude's per-call frame carries 2 for a reply that came to 36 — so the
 * reading under-counts the last reply and never the input.
 */
export const Context = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.Number,
  cacheWriteTokens: Schema.Number,
})
export type Context = Schema.Schema.Type<typeof Context>

/**
 * What a turn has spent so far, as the readings say: each model call's `Context` added
 * once, laid over the provider's own report.
 *
 * **Never a fact about the turn, and never on the log.** Claude reports its spend once,
 * on the line that ends the turn, so between the spawn and that line the only figure a
 * surface can grow is this one; its output count is short the way `Context`'s is, and
 * the provider's report replaces it the moment one arrives. `meter.ts` keeps it beside
 * `Usage` rather than inside it, because a `Usage` reaches the stored log on every ending
 * and an estimate folded into it would store output tokens known to be undercounted. It
 * is on the run record and on the wire, and on nothing durable.
 */
export const Estimate = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.Number,
  cacheWriteTokens: Schema.Number,
})
export type Estimate = Schema.Schema.Type<typeof Estimate>

/** Nothing read yet, which is also what a turn whose provider reported everything has. */
export const noEstimate: Estimate = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

/**
 * What a turn spent: tokens, money, and which tools it reached for.
 *
 * A record of facts with nothing derived. Totals, ratios and *"was that a lot?"*
 * are a reader's business — the moment one of these is a number someone wants
 * down, you get cheaper worse work and the metric faithfully reports improvement.
 *
 * `inputTokens` is the **uncached** input only, which is why it reads as absurdly
 * small; the two cache counters are where a turn's real input is. Carried as four
 * numbers rather than a sum for the reason `ProviderEvent.Usage` carries them:
 * without them the reading invites the conclusion that the agent's narration is
 * what costs money.
 */
export const Usage = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.Number,
  cacheWriteTokens: Schema.Number,
  costUsd: Schema.Number,
  /**
   * Tool name -> calls, rather than a count.
   *
   * The name is the finding. `Grep` ×40 says the agent did not know where things
   * were, which is a skill's job; `40 tool calls` says nothing. It is also what
   * keeps a provider's vocabulary out of the engine — *subagent dispatches* is
   * whichever tool that provider dispatches with, read off the histogram by
   * whoever is reading, rather than a name `workflow/` has to be taught.
   */
  tools: Schema.Record({ key: Schema.String, value: Schema.Number }),
  /**
   * What the window held at the turn's last model call — `Context`, and absent where
   * the provider reported no per-call figure: a log written before one was read, and
   * a Codex turn whose own log was never opened.
   */
  context: Schema.optional(Context),
  /**
   * How many tokens the model's context holds, as the provider itself said — Claude on
   * its `result` line, Codex in its own session log. Absent where it said nothing, in
   * which case a surface falls back to the project's `models.yaml`.
   */
  contextWindow: Schema.optional(Schema.Number),
})
export type Usage = Schema.Schema.Type<typeof Usage>

/** A turn that has not spent anything yet. Also what a turn that never started spent. */
export const noUsage: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  tools: {},
}
