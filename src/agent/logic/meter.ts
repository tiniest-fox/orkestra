// logic: what a turn has spent so far, folded from the events it has emitted.
//
// A fold rather than a read of the last `Usage` line, because a provider may
// report more than once in a turn and because tool calls arrive one at a time.
// Nothing here parses a transcript line — the transcript is a rendering, and
// reading numbers back out of one would make the display the source.

import type { ProviderEvent } from "../types/provider-event.js"
import { type Estimate, noEstimate, noUsage, type Usage } from "../types/usage.js"

/**
 * The fold's state: what the turn has spent, and the cost of every CLI run before the
 * one now reporting.
 *
 * `banked` is not on `Usage` because it is not a fact about the turn — it is the
 * bookkeeping that lets a cost reported as a running total be added across runs. It
 * is what `usage.costUsd` has already been carried to at the last `Reask`, so a run's
 * own reports are laid on top of it rather than compared against it.
 *
 * `estimate` is what the readings since the last `Usage` add up to — see `Estimate` for
 * why it is beside `usage` rather than in it — and `lastCall` is the call the last
 * reading named, so a call emitted once per content block is added once.
 */
export interface Metering {
  readonly usage: Usage
  readonly banked: number
  /**
   * Which model the last `Occupancy` named, so a `ContextWindow` arriving later — Claude
   * reports one per model on the `result` line, a subagent's model beside the turn's own —
   * lands only where it is the same model. `undefined` where nothing named one, which
   * accepts any window.
   */
  readonly contextModel: string | undefined
  readonly estimate: Estimate
  readonly lastCall: string | undefined
}

/** Nothing spent and nothing banked: a turn before its first event. */
export const unmetered: Metering = {
  usage: noUsage,
  banked: 0,
  contextModel: undefined,
  estimate: noEstimate,
  lastCall: undefined,
}

/**
 * One more event, absorbed.
 *
 * **Additive on the token counters, a maximum on cost within one CLI run**, because
 * the provider reports the two differently and `ProviderEvent.Usage` says so: each
 * report's tokens are its own, while the cost is what this run has spent to date. A
 * turn that backgrounds work is reported three times —
 * `test/fixtures/claude/background-work.captured.jsonl` is one that cost $0.093 and,
 * added up, billed $0.248.
 *
 * `Math.max` rather than keeping the last, so a report arriving out of order cannot
 * shrink what a turn has already been seen to spend. It is also why a provider that
 * reported an increment here would under-report rather than over-report.
 *
 * **A `Reask` banks the cost so far**, because the ask that follows spawns a second
 * CLI whose running total starts again from nothing: kept as a maximum across the two
 * runs, a turn that reported $18.15 and then $2.60 records $18.15. Everything a later
 * run reports is laid on top of what the runs before it came to.
 *
 * **An `Occupancy` replaces the reading before it**, because it measures what the
 * window holds rather than what the turn spent, and a `ContextWindow` sets the size the
 * reading is against — where it names the model the reading named, or neither does.
 *
 * **The same reading is also added to `estimate`, once per call.** Each call's input
 * side is exactly that call's spend — a real turn's readings, added once per
 * `message.id`, come to the `result` line's input and cache totals to the token — so
 * between the spawn and the provider's report the estimate is the only running figure
 * there is. A reading naming the call the last one named is the same call again and
 * adds nothing; one naming no call counts. **A `Usage` report starts the estimate
 * again from nothing**, at every report rather than only at the turn's end: Claude
 * reports more than once on a turn with background work, and readings after a report
 * are laid on top of it rather than counted a second time.
 *
 * Everything else — text, thinking, session ids, rate-limit notices — is not spend
 * and falls through. No `Match.exhaustive`: a provider event kind added later is
 * not something a turn spent until someone says it is.
 */
export const metered = (m: Metering, e: ProviderEvent): Metering => {
  const u = m.usage
  if (e._tag === "ToolUse") {
    return { ...m, usage: { ...u, tools: { ...u.tools, [e.name]: (u.tools[e.name] ?? 0) + 1 } } }
  }
  if (e._tag === "Reask") return { ...m, banked: u.costUsd }
  if (e._tag === "Occupancy") {
    const held = {
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      cacheReadTokens: e.cacheReadTokens,
      cacheWriteTokens: e.cacheWriteTokens,
    }
    const repeat = e.call !== undefined && e.call === m.lastCall
    return {
      ...m,
      contextModel: e.model,
      lastCall: e.call,
      estimate: repeat ? m.estimate : added(m.estimate, held),
      usage: { ...u, context: held },
    }
  }
  if (e._tag === "ContextWindow") {
    const other =
      e.model !== undefined && m.contextModel !== undefined && e.model !== m.contextModel
    return other ? m : { ...m, usage: { ...u, contextWindow: e.tokens } }
  }
  if (e._tag !== "Usage") return m
  return {
    ...m,
    estimate: noEstimate,
    usage: {
      ...u,
      inputTokens: u.inputTokens + e.inputTokens,
      outputTokens: u.outputTokens + e.outputTokens,
      cacheReadTokens: u.cacheReadTokens + e.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens + e.cacheWriteTokens,
      costUsd: Math.max(u.costUsd, m.banked + e.runCostUsd),
    },
  }
}

const added = (a: Estimate, b: Estimate): Estimate => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
})

/** What a whole turn spent. `meter([])` is `noUsage`, which is what a dead turn spent. */
export const meter = (events: readonly ProviderEvent[]): Usage =>
  events.reduce(metered, unmetered).usage
