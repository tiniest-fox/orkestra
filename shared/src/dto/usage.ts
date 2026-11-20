// Plan usage, per CLI. Part of the wire contract;
// `common.ts` says how the slices fit together.

import { Schema } from "effect"

/**
 * One rate-limit window of a CLI's plan, as the CLI reported it. `model` names a window
 * that counts one model alone, in the provider's own word (`opus`), and is absent for the
 * window every model counts towards. `resetsAt` is epoch milliseconds, absent where the
 * CLI gave none.
 */
export const PlanWindowDto = Schema.Struct({
  kind: Schema.Literal("five_hour", "seven_day"),
  model: Schema.optional(Schema.String),
  /** The share used, 0–100. */
  utilization: Schema.Number,
  resetsAt: Schema.optional(Schema.Number),
})
export type PlanWindowDto = Schema.Schema.Type<typeof PlanWindowDto>

/**
 * Why there is no reading — its own sentence on screen. `shape` is a CLI that reports its
 * quota without the windows the indicator draws.
 */
export const UsageUnavailableDto = Schema.Struct({ reason: Schema.Literal("shape") })
export type UsageUnavailableDto = Schema.Schema.Type<typeof UsageUnavailableDto>

/** No turn has reported since the engine started. */
export const UsageNotReadDto = Schema.TaggedStruct("NotRead", {})
/** The last reading, taken at `at`, epoch milliseconds. */
export const UsageReadDto = Schema.TaggedStruct("Read", {
  at: Schema.Number,
  windows: Schema.Array(PlanWindowDto),
})
/** The turns reported, at `at`, but never a reading. */
export const UsageUnavailableStateDto = Schema.TaggedStruct("Unavailable", {
  at: Schema.Number,
  why: UsageUnavailableDto,
})
export const PlanUsageDto = Schema.Union(UsageNotReadDto, UsageReadDto, UsageUnavailableStateDto)
export type PlanUsageDto = Schema.Schema.Type<typeof PlanUsageDto>

/**
 * One CLI's plan usage, as this engine last read it — memory only, so a restart is
 * `NotRead` again. `polling` is whether one of the engine's turns on that CLI is running,
 * which is the only time a reading arrives.
 */
export const CliUsageDto = Schema.Struct({
  /** The provider adapter's own name — the `<provider>/` a model is qualified with. */
  cli: Schema.Literal("claude", "codex"),
  polling: Schema.Boolean,
  usage: PlanUsageDto,
})
export type CliUsageDto = Schema.Schema.Type<typeof CliUsageDto>

/**
 * `GET /api/usage`: one entry per CLI some agent in the project runs on, Claude first, then
 * Codex. A CLI no agent names is absent.
 */
export const CliUsagesDto = Schema.Struct({ clis: Schema.Array(CliUsageDto) })
export type CliUsagesDto = Schema.Schema.Type<typeof CliUsagesDto>

/** One CLI's usage changed. Whole, so a watcher replaces the entry for that CLI. */
export const UsageFrameDto = Schema.TaggedStruct("Usage", { usage: CliUsageDto })
export type UsageFrameDto = Schema.Schema.Type<typeof UsageFrameDto>
