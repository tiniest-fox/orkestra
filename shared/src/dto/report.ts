// A problem report about one trak: the contract a receiver maps from, and the routes that
// preview and send one. Part of the wire contract; `common.ts` says how the slices fit
// together. `docs/reports.md` is the same contract written for a receiver.
//
// **Orkestra sends the report in its own terms and shapes nothing for any receiver.** A
// change to `ReportDto` that a receiver could misread is a new `format`, never an edit to
// `orkestra-report/1`, because a receiver tells the versions apart by that field alone.

import { Schema } from "effect"

/** The version tag every report carries. */
export const REPORT_FORMAT = "orkestra-report/1"

/** The most of the log a report carries: its newest lines within both bounds. */
export const REPORT_MOST_LINES = 2000
export const REPORT_MOST_BYTES = 256 * 1024

/**
 * The most of each free-text field a report carries — the note, and the trak's title and
 * description — in bytes, from its start. Cut after cleaning, as the log is.
 */
export const REPORT_TEXT_MOST_BYTES = 64 * 1024

/** The longest note a person may send, in characters. */
export const REPORT_NOTE_MOST = 20_000

/** What stands in a line or the note where a secret or a token-shaped string was. */
export const REDACTION_MARK = "[redacted]"

/**
 * The trak the report is about, as the engine holds it. `title` and `description` are
 * cleaned as the log is and cut to `REPORT_TEXT_MOST_BYTES`.
 */
export const ReportTrakDto = Schema.Struct({
  id: Schema.String,
  /** The plan's title, or the request where no plan exists yet. */
  title: Schema.String,
  /** What the person asked for, as they asked it. */
  description: Schema.String,
  /** The goal that opened the trak, where one did. */
  goal: Schema.optional(Schema.String),
  /** The state's name, such as `AgentWorking` or `Failed`. */
  state: Schema.String,
  /** The step the state names, as `<index>-<agent>`, where it names one. */
  position: Schema.optional(Schema.String),
  /** The agent of that step, where the step has one. */
  agent: Schema.optional(Schema.String),
})
export type ReportTrakDto = Schema.Schema.Type<typeof ReportTrakDto>

/** The engine that made the report. */
export const ReportEngineDto = Schema.Struct({
  version: Schema.String,
  /** Node's `process.platform`: `darwin`, `linux`. */
  platform: Schema.String,
})
export type ReportEngineDto = Schema.Schema.Type<typeof ReportEngineDto>

/** A count of lines and the bytes they take, each line counted with its newline. */
export const ReportSizeDto = Schema.Struct({ lines: Schema.Number, bytes: Schema.Number })
export type ReportSizeDto = Schema.Schema.Type<typeof ReportSizeDto>

/**
 * The cleaned log, cut to its newest lines. Each line is one JSON object: an event of the
 * trak's log as the engine stores it, or `{ at, level, message }` for an engine warning or
 * error naming the trak, merged oldest first by time. Every secret the engine holds and
 * every token-shaped string is replaced by `[redacted]`; `redactions` counts them.
 */
export const ReportLogIncludedDto = Schema.TaggedStruct("Included", {
  lines: Schema.Array(Schema.String),
  kept: ReportSizeDto,
  /** The older lines the cut left out. Zero lines where the whole log fits. */
  leftOut: ReportSizeDto,
  redactions: Schema.Number,
})
export type ReportLogIncludedDto = Schema.Schema.Type<typeof ReportLogIncludedDto>

/**
 * Why the report carries no log: the person turned it off, the engine could not read its
 * list of secrets to clean it with, or the trak's stored log would not decode.
 */
export const ReportLeftOutReasonDto = Schema.Literal(
  "turned-off",
  "secrets-unreadable",
  "undecodable",
)
export type ReportLeftOutReasonDto = Schema.Schema.Type<typeof ReportLeftOutReasonDto>

export const ReportLogLeftOutDto = Schema.TaggedStruct("LeftOut", {
  reason: ReportLeftOutReasonDto,
})
export type ReportLogLeftOutDto = Schema.Schema.Type<typeof ReportLogLeftOutDto>

export const ReportLogDto = Schema.Union(ReportLogIncludedDto, ReportLogLeftOutDto)
export type ReportLogDto = Schema.Schema.Type<typeof ReportLogDto>

/**
 * One report, as the host is handed it to send and as `GET /api/traks/:id/report` previews
 * it. The preview carries no note; a send rebuilds the report from the log as it is then.
 */
export const ReportDto = Schema.Struct({
  format: Schema.Literal(REPORT_FORMAT),
  /** When the engine made it, as an ISO 8601 instant. */
  madeAt: Schema.String,
  /**
   * What the person wrote, cleaned as the log is and cut to `REPORT_TEXT_MOST_BYTES`.
   * Absent where they wrote nothing.
   */
  note: Schema.optional(Schema.String),
  /**
   * The bytes each free-text field lost to the cut, naming only the fields that were cut;
   * absent where none was.
   */
  /**
   * Present where the engine could not read its list of secrets: the note is then absent,
   * `trak.title` is the trak's id and `trak.description` is empty, because nothing typed
   * can be shown to hold no secret.
   */
  withheld: Schema.optional(Schema.Literal("secrets-unreadable")),
  cut: Schema.optional(
    Schema.Struct({
      note: Schema.optional(Schema.Number),
      title: Schema.optional(Schema.Number),
      description: Schema.optional(Schema.Number),
    }),
  ),
  trak: ReportTrakDto,
  engine: ReportEngineDto,
  log: ReportLogDto,
})
export type ReportDto = Schema.Schema.Type<typeof ReportDto>

/** `POST /api/traks/:id/report`'s body. */
export const ReportSendRequestDto = Schema.Struct({
  note: Schema.optional(Schema.String.pipe(Schema.maxLength(REPORT_NOTE_MOST))),
  includeLog: Schema.Boolean,
})
export type ReportSendRequestDto = Schema.Schema.Type<typeof ReportSendRequestDto>

/** The host sent it, and the receiver filed it under `reference` — a URL, or any text. */
export const ReportSentDto = Schema.TaggedStruct("Sent", { reference: Schema.String })
/** The host could not send it, and says why in a sentence. */
export const ReportNotSentDto = Schema.TaggedStruct("NotSent", { reason: Schema.String })
export const ReportSendAnswerDto = Schema.Union(ReportSentDto, ReportNotSentDto)
export type ReportSendAnswerDto = Schema.Schema.Type<typeof ReportSendAnswerDto>
