// The daemon, as `ork` reaches it.
//
// **This module has no engine in it.** Everything it knows about a trak arrives as a
// DTO and everything it does to one is a request — which is the whole of what one
// writer bought. A second process driving `advance` is exactly what `Runs.claim` used
// to guard against and what the permit inside the daemon replaced; reaching into
// `workflow/` from here would put that problem back, so the lint config forbids it.
//
// A port rather than a bare `fetch`, for the reason every other port here is one: the
// gate loop is the interesting part and a test of it should not need a daemon, a
// socket, or a real `claude`.

import { Context, Data, type Effect, type Stream } from "effect"
import type {
  ActRequestDto,
  CreatedDto,
  MergePreviewDto,
  ResumePreviewDto,
} from "@orkestra/shared/dto/actions"
import type { RefusalDto } from "@orkestra/shared/dto/common"
import type { McpToolCallDto, McpToolListDto, McpToolResultDto } from "@orkestra/shared/dto/goals"
import type { EngineFrameDto } from "@orkestra/shared/dto/stream"
import type { TrakDetailDto, TrakListDto } from "@orkestra/shared/dto/trak"

/**
 * Nothing is listening for this project.
 *
 * Its own tag rather than a `RequestFailed` with a reason, because it is the one
 * failure with an action attached: start the daemon. Everything else the transport can
 * raise is something to report.
 */
export class NoEngine extends Data.TaggedError("NoEngine")<{
  /** The project root nothing answered for — what `--dir` names, or where we stood. */
  readonly project: string
  /** Where it looked, so the message can say why the obvious answer did not work. */
  readonly tried: readonly number[]
}> {}

/** The engine answered, and said no. `refusal` is why, as a value worth switching on. */
export class Refused extends Data.TaggedError("Refused")<{
  readonly refusal: RefusalDto
}> {}

/** The engine could not be reached, or answered something this build cannot read. */
export class EngineFailed extends Data.TaggedError("EngineFailed")<{
  readonly reason: string
}> {}

export type EngineError = Refused | EngineFailed

/**
 * What `ork` can ask of the daemon.
 *
 * One method per command, named for the command rather than the route, because that is
 * the vocabulary on both sides of it — a reader following `ork archive` should not have
 * to translate through a verb and a path. The archive is the one command with two
 * routes behind it, so it is two methods: the wire's `/close` for a finished trak and
 * `/abandon` for one still going, and only the second interrupts a drive.
 *
 * **The acting ones answer immediately and mean nothing has happened yet.** They report
 * that the drive was accepted; what happened next arrives on `watch`. That is the
 * shape async drive has, and it is why the gate loop subscribes before it acts.
 */
export interface EngineShape {
  /** The live traks as rows, and how many are put away — no row for those. */
  readonly list: () => Effect.Effect<TrakListDto, EngineError>
  readonly detail: (id: string) => Effect.Effect<TrakDetailDto, EngineError>
  readonly record: (id: string) => Effect.Effect<string, EngineError>
  /**
   * Rewrite the folder under `.orkestra/records/` of every trak whose checkout is gone.
   *
   * Listed with the reads rather than the acting ones because it spends nothing and
   * changes no trak — but it does write, and it answers when it has finished rather
   * than forking, since there is no drive to watch and nothing to wait on but disk.
   */
  readonly records: () => Effect.Effect<readonly string[], EngineError>
  readonly resumePreview: (id: string) => Effect.Effect<ResumePreviewDto, EngineError>
  readonly mergePreview: (id: string) => Effect.Effect<MergePreviewDto, EngineError>

  readonly start: (description: string) => Effect.Effect<CreatedDto, EngineError>
  readonly act: (id: string, request: ActRequestDto) => Effect.Effect<void, EngineError>
  readonly resume: (id: string, sessionId?: string) => Effect.Effect<void, EngineError>
  readonly merge: (id: string) => Effect.Effect<void, EngineError>
  readonly archive: (id: string) => Effect.Effect<void, EngineError>
  readonly archiveUnfinished: (id: string, reason: string) => Effect.Effect<void, EngineError>
  readonly reenter: (id: string, what: string) => Effect.Effect<void, EngineError>
  readonly wipe: (id?: string) => Effect.Effect<void, EngineError>
  /** Every browser session, on every device, logged out. Spends nothing. */
  readonly revokeSessions: () => Effect.Effect<void, EngineError>

  /** A goal composer's tools, as its `orkestra goal-tools` server lists them. Spends nothing. */
  readonly goalTools: (goal: string) => Effect.Effect<McpToolListDto, EngineError>
  /** One tool call, forwarded; the answer is what the model reads, a refusal included. */
  readonly goalToolCall: (
    goal: string,
    name: string,
    call: McpToolCallDto,
  ) => Effect.Effect<McpToolResultDto, EngineError>

  /** A step turn's engine tools, as its `orkestra trak-tools` server lists them. Spends nothing. */
  readonly trakTools: (id: string) => Effect.Effect<McpToolListDto, EngineError>
  /**
   * One call, forwarded, answered once the engine has finished it — a check that waits for
   * the exclusive turn and then runs for minutes holds this open as long, with no timeout.
   */
  readonly trakToolCall: (
    id: string,
    name: string,
    call: McpToolCallDto,
  ) => Effect.Effect<McpToolResultDto, EngineError>

  /**
   * Every append the daemon makes, from now on.
   *
   * A `Stream` rather than a callback, so watching is something a caller can compose
   * with: a gate loop runs it beside the command it sent and stops it when the trak
   * comes to rest. The connection's lifetime is the stream's.
   */
  readonly watch: () => Stream.Stream<EngineFrameDto, EngineError>
}

export class Engine extends Context.Tag("cli/Engine")<Engine, EngineShape>() {}
