// types: how much of a CLI's subscription plan is used, as the engine last read it.
//
// In `agent/` beside `Usage` because it is a fact about the account a CLI runs on, and
// `workflow/` carries it on a frame without learning where it came from. Nothing here
// says how it is read — `src/app/plan-usage.ts` keeps what each CLI's turns report.

import { Data } from "effect"

/**
 * The CLIs whose plan usage the engine reads, by the provider adapter's own name, in the
 * order a screen lists them.
 */
export const USAGE_CLIS = ["claude", "codex"] as const
export type UsageCli = (typeof USAGE_CLIS)[number]

export const isUsageCli = (cli: string): cli is UsageCli => USAGE_CLIS.some((c) => c === cli)

/**
 * One rate-limit window, as the CLI reported it. `model` names a window that counts one
 * model's use alone — the provider's own word, such as `opus` — and is absent for the
 * window every model counts towards.
 */
export interface PlanWindow {
  readonly kind: "five_hour" | "seven_day"
  readonly model?: string
  /** The share used, 0–100. */
  readonly utilization: number
  /** When the window resets, epoch milliseconds. Absent where the CLI gave none. */
  readonly resetsAt?: number
}

/**
 * Why there is no reading. `shape`: the CLI reports its quota without the windows the
 * indicator draws, as an older `claude` does.
 */
type UsageUnavailable = { readonly reason: "shape" }

/** Where one CLI's plan usage stands. `at` is when a turn reported it, epoch milliseconds. */
export type PlanUsage = Data.TaggedEnum<{
  /** No turn has reported since the engine started. */
  NotRead: {}
  Read: { readonly at: number; readonly windows: readonly PlanWindow[] }
  Unavailable: { readonly at: number; readonly why: UsageUnavailable }
}>
export const PlanUsage = Data.taggedEnum<PlanUsage>()

/**
 * One CLI's plan usage, and whether one of the engine's turns on that CLI is running —
 * the only time a new reading can arrive.
 */
export interface CliUsage {
  readonly cli: UsageCli
  readonly polling: boolean
  readonly usage: PlanUsage
}
