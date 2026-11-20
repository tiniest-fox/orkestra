// The engine's event stream, one frame per append. Part of the wire contract;
// `common.ts` says how the slices fit together.

import { Schema, SchemaAST } from "effect"
import { TurnInFlightDto } from "./log.js"
import { TranscriptEntryDto } from "./transcript.js"
import { CheckRunDto, HostedProcessDto, PreparingPhaseDto, SeamStatusDto } from "./trak.js"
import { AppendedFrameDto, DriveFrameDto, RemovedFrameDto, ResyncFrameDto } from "./trak-frames.js"
import { UsageFrameDto } from "./usage.js"

// ============================================================================
// The stream — one frame per append, as it lands
// ============================================================================

/** A transcript line was written. `seq` counts `transcript.jsonl`, its own file. */
export const ActivityFrameDto = Schema.TaggedStruct("Activity", {
  trak: Schema.String,
  seq: Schema.Number,
  entry: TranscriptEntryDto,
})
export type ActivityFrameDto = Schema.Schema.Type<typeof ActivityFrameDto>

/**
 * A check started at a position. The run whole, so a watcher holding an earlier one
 * replaces `TrakDetailDto.check` rather than merging into it.
 */
export const CheckStartedFrameDto = Schema.TaggedStruct("CheckStarted", {
  trak: Schema.String,
  run: CheckRunDto,
})
export type CheckStartedFrameDto = Schema.Schema.Type<typeof CheckStartedFrameDto>

/**
 * What the check has printed since the last of these, already newline-terminated.
 *
 * **`seq` counts chunks within the run, not lines in a file** — the check family is the
 * one thing on this stream that no file holds. It is still the same gap detector: append
 * when it is `check.chunks + 1`, and ask the server again otherwise. Lines are gathered
 * for a fraction of a second before one goes out, because a frame per line would push
 * every other trak's frames out of the replay ring.
 */
export const CheckOutputFrameDto = Schema.TaggedStruct("CheckOutput", {
  trak: Schema.String,
  step: Schema.Number,
  seq: Schema.Number,
  chunk: Schema.String,
})
export type CheckOutputFrameDto = Schema.Schema.Type<typeof CheckOutputFrameDto>

/**
 * The check exited, timed out, or could not be spawned.
 *
 * Carries the run whole because `output` is **replaced** here rather than appended to:
 * what was watched is stdout in arrival order, and what is settled is the report the
 * agent is handed — stderr first, since that is what explains a failure.
 */
export const CheckEndedFrameDto = Schema.TaggedStruct("CheckEnded", {
  trak: Schema.String,
  run: CheckRunDto,
})
export type CheckEndedFrameDto = Schema.Schema.Type<typeof CheckEndedFrameDto>

/**
 * What the turn in flight has spent so far, or that nothing is in flight any more.
 *
 * On no log for `DriveFrameDto`'s reason: a turn's spend before it ends lives on the
 * run record, which its ending clears *after* the ending is appended — so the frame
 * that says the turn is over cannot be an `Appended`, and the release here is what
 * takes the estimate off a meter once the ending's own figure is on the log. Between
 * the spawn and the ending it is how a meter grows at every model call rather than
 * at the first time the work stops.
 *
 * `turn` whole rather than a delta, so a watcher replaces what it holds — the rule the
 * check family and `Drive` follow. Sent at most once per short window per trak, the
 * latest report winning, so a busy turn does not push every other trak's frames out
 * of the replay ring.
 */
export const InFlightFrameDto = Schema.TaggedStruct("InFlight", {
  trak: Schema.String,
  turn: Schema.optional(TurnInFlightDto),
})
export type InFlightFrameDto = Schema.Schema.Type<typeof InFlightFrameDto>

/**
 * The preparation a trak is in moved — `preparing` whole, absent once none is running —
 * so a watcher replaces what it holds, for `DriveFrameDto`'s reason.
 */
export const PreparingFrameDto = Schema.TaggedStruct("Preparing", {
  trak: Schema.String,
  preparing: Schema.optional(PreparingPhaseDto),
})
export type PreparingFrameDto = Schema.Schema.Type<typeof PreparingFrameDto>

/**
 * The trak's action at the seam moved — `seam` whole, absent once none is running — so a
 * watcher replaces what it holds, for `DriveFrameDto`'s reason.
 */
export const SeamStatusFrameDto = Schema.TaggedStruct("SeamStatus", {
  trak: Schema.String,
  seam: Schema.optional(SeamStatusDto),
})
export type SeamStatusFrameDto = Schema.Schema.Type<typeof SeamStatusFrameDto>

/**
 * A hosted process changed state. The process whole, its log included, so a watcher
 * replaces what it holds — the rule the check family follows. `trak` is absent for a
 * process on the project checkout, whose list is `GET /api/processes`.
 */
export const ProcessFrameDto = Schema.TaggedStruct("Process", {
  trak: Schema.optional(Schema.String),
  process: HostedProcessDto,
})
export type ProcessFrameDto = Schema.Schema.Type<typeof ProcessFrameDto>

/**
 * What a hosted process has printed since the last of these, newline-terminated.
 * `seq` counts chunks within the run `run` names: append when it is that run's
 * `chunks + 1`, and ask `GET /api/traks/:id/processes` — or `GET /api/processes`, where
 * `trak` is absent — again otherwise.
 */
export const ProcessOutputFrameDto = Schema.TaggedStruct("ProcessOutput", {
  trak: Schema.optional(Schema.String),
  name: Schema.String,
  run: Schema.Number,
  seq: Schema.Number,
  chunk: Schema.String,
})
export type ProcessOutputFrameDto = Schema.Schema.Type<typeof ProcessOutputFrameDto>

/**
 * A goal's log or transcript grew: re-read `GET /api/goals/:id`, and the goal list. It
 * carries nothing to patch with — a goal screen re-reads the goal whole, which keeps
 * its projection the engine's alone.
 */
export const GoalFrameDto = Schema.TaggedStruct("Goal", { goal: Schema.String })
export type GoalFrameDto = Schema.Schema.Type<typeof GoalFrameDto>

export const EngineFrameDto = Schema.Union(
  AppendedFrameDto,
  ActivityFrameDto,
  RemovedFrameDto,
  ResyncFrameDto,
  CheckStartedFrameDto,
  CheckOutputFrameDto,
  CheckEndedFrameDto,
  DriveFrameDto,
  InFlightFrameDto,
  PreparingFrameDto,
  SeamStatusFrameDto,
  ProcessFrameDto,
  ProcessOutputFrameDto,
  GoalFrameDto,
  UsageFrameDto,
)
export type EngineFrameDto = Schema.Schema.Type<typeof EngineFrameDto>

/**
 * The `_tag` of every member of `EngineFrameDto`, read off the union itself.
 *
 * The server names each SSE event after the frame's `_tag` (`src/app/routes/stream.ts`), and an
 * `EventSource` dispatches only to a listener registered under that exact name — so the
 * client has to register one per tag, and this is the list it registers from. It is
 * derived rather than written out because the written-out copy drifted once: `Drive` was
 * added to the union above and not to the client's list, and the one frame the drawer's
 * buttons wait on was dropped by the transport with nothing to say so.
 *
 * Every member is a `TaggedStruct`, whose `_tag` is a literal on the type-side AST, so
 * the throw below is the unreachable branch of that narrowing rather than a case anything
 * handles. What makes it unreachable is `TaggedStruct` specifically: a member with no
 * `_tag` at all does not compile, because `fields._tag` would be missing on it, but a
 * plain `Schema.Struct` carrying a `_tag: Schema.Literal` field does compile and lands on
 * the throw, its `fields._tag.ast` being the `Literal` itself rather than a
 * `PropertySignatureDeclaration` wrapping one. That throws at the import of this module,
 * which every test loads, so it fails `pnpm verify` at the first file rather than
 * reaching a browser — loud, but a reason to add a member as a `TaggedStruct`.
 */
export const ENGINE_FRAME_TAGS: ReadonlyArray<string> = EngineFrameDto.members.map((member) => {
  const ast = member.fields._tag.ast
  if (
    ast._tag === "PropertySignatureDeclaration" &&
    SchemaAST.isLiteral(ast.type) &&
    typeof ast.type.literal === "string"
  ) {
    return ast.type.literal
  }
  throw new Error(`EngineFrameDto has a member whose _tag is not a string literal`)
})
