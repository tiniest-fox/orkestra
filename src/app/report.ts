// One trak's problem report, `orkestra-report/1`: the trak's details, the person's note, and
// the trak's log — its events and the engine's warning and error lines naming it, merged by
// time — cleaned and then cut. Gathered the way `snapshot_logs` gathers the same two sources.
//
// **Every line is cleaned before anything is measured or cut**, as `redactor` requires: a
// cut through a secret leaves a half no form matches. Cleaning takes out every secret value
// the engine holds and every token-shaped string; where the list of secrets cannot be read,
// the report carries no log at all rather than a log cleaned of shapes alone.
//
// **Nothing is kept between a preview and a send.** Both build the report from the log as
// it is at the call, so a send carries what happened after the preview was drawn.

import { Clock, Effect, Either, Exit, Schema } from "effect"
import {
  REPORT_FORMAT,
  REPORT_MOST_BYTES,
  REPORT_MOST_LINES,
  type ReportDto,
  type ReportLogDto,
  ReportLogIncludedDto,
  ReportLogLeftOutDto,
  type ReportTrakDto,
} from "@orkestra/shared/dto/report"
import { artifactKey, isCompose, isSpawn } from "../workflow/domain/outputs/proposal.js"
import { Event } from "../workflow/domain/event.js"
import { replayHistory } from "../workflow/domain/replay.js"
import type { Trak, TrakId } from "../workflow/domain/trak.js"
import { EngineLog, type EngineLogLine } from "../workflow/ports/engine-log.js"
import { EngineVersion } from "../workflow/ports/engine-version.js"
import { GoalStore } from "../workflow/ports/goal-store.js"
import { Store } from "../workflow/ports/store.js"
import { People } from "./people.js"
import { reportCleaner } from "./redact.js"
import { heldSecrets } from "./tool-answer.js"

/** What the person chose: their note, and whether the log goes. */
export interface ReportAsked {
  readonly note: string | undefined
  readonly includeLog: boolean
}

/** Everything one report is made from, read at the call. */
export interface ReportSources {
  readonly id: TrakId
  /** The trak's events, or `undefined` where its stored log will not decode. */
  readonly events: readonly Event[] | undefined
  /** The engine's lines naming the trak and no trak or goal its owner may not read. */
  readonly engine: readonly EngineLogLine[]
  /** Every secret value the engine holds, or `undefined` where the list could not be read. */
  readonly secrets: readonly string[] | undefined
  readonly version: string
  readonly platform: string
  readonly now: number
}

/** One line of the merged log, and the instant it is ordered by. */
interface Timed {
  readonly at: number
  readonly line: string
}

/** An event as the store encodes it, or its tag where it will not encode. */
const eventLine = (e: Event): string => {
  const encoded = Schema.encodeEither(Event)(e)
  return Either.isRight(encoded) ? JSON.stringify(encoded.right) : JSON.stringify({ _tag: e._tag })
}

/**
 * The events and the engine's lines, oldest first. An event with no time of its own takes
 * the time of the one before it, so it keeps its place in the log; the sort is stable, so
 * an event and an engine line at the same instant keep that order.
 */
export const mergedLog = (
  events: readonly Event[],
  engine: readonly EngineLogLine[],
): readonly string[] => {
  let last = 0
  const fromEvents = events.map((e): Timed => {
    last = e.at ?? last
    return { at: last, line: eventLine(e) }
  })
  const fromEngine = engine.map(
    (l): Timed => ({
      at: l.at,
      line: JSON.stringify({
        at: new Date(l.at).toISOString(),
        level: l.level,
        message: l.message,
      }),
    }),
  )
  return [...fromEvents, ...fromEngine].toSorted((a, b) => a.at - b.at).map((t) => t.line)
}

const bytesOf = (line: string): number => Buffer.byteLength(line) + 1

/**
 * The newest lines that fit both bounds, and what the cut left out. A newest line that is
 * alone over the byte bound is left out too, so the cut never splits a line.
 */
export const newestWithin = (lines: readonly string[]) => {
  let bytes = 0
  let from = lines.length
  while (from > 0 && lines.length - from < REPORT_MOST_LINES) {
    const next = bytesOf(lines[from - 1] ?? "")
    if (bytes + next > REPORT_MOST_BYTES) break
    bytes += next
    from -= 1
  }
  const left = lines.slice(0, from)
  return {
    lines: lines.slice(from),
    kept: { lines: lines.length - from, bytes },
    leftOut: { lines: left.length, bytes: left.reduce((sum, l) => sum + bytesOf(l), 0) },
  }
}

/** The step a state names, where it names one. */
const stepIn = (trak: Trak): number | undefined =>
  "step" in trak.state && typeof trak.state.step === "number" ? trak.state.step : undefined

const trakDetails = (id: TrakId, events: readonly Event[] | undefined): ReportTrakDto => {
  if (events === undefined) return { id, title: id, description: "", state: "Unreadable" }
  const trak = replayHistory(id, events)
  const index = stepIn(trak)
  const step = index === undefined ? undefined : trak.plan?.steps[index]
  return {
    id,
    title: trak.plan?.title ?? trak.description,
    description: trak.description,
    ...(trak.goal === undefined ? {} : { goal: trak.goal }),
    state: trak.state._tag,
    ...(step === undefined || index === undefined ? {} : { position: artifactKey(step, index) }),
    ...(step === undefined || isCompose(step) || isSpawn(step) ? {} : { agent: step.agent }),
  }
}

/** The report, cleaned and cut. Pure: every source is read before it is called. */
export const reportOf = (src: ReportSources, asked: ReportAsked): ReportDto => {
  const cleaner = reportCleaner(src.secrets ?? [])
  const note = asked.note?.trim() === "" ? undefined : asked.note
  const logOf = (): ReportLogDto => {
    if (!asked.includeLog) return ReportLogLeftOutDto.make({ reason: "turned-off" })
    if (src.events === undefined) return ReportLogLeftOutDto.make({ reason: "undecodable" })
    if (src.secrets === undefined) return ReportLogLeftOutDto.make({ reason: "secrets-unreadable" })
    const cleaned = mergedLog(src.events, src.engine).map(cleaner.clean)
    return ReportLogIncludedDto.make({ ...newestWithin(cleaned), redactions: cleaner.marked() })
  }
  const log = logOf()
  return {
    format: REPORT_FORMAT,
    madeAt: new Date(src.now).toISOString(),
    // Cleaned after the log, so the log's count is the log's alone.
    ...(note === undefined ? {} : { note: cleaner.clean(note) }),
    trak: trakDetails(src.id, src.events),
    engine: { version: src.version, platform: src.platform },
    log,
  }
}

/** The engine's lines naming `id` and none of `hidden`. */
const linesAbout = (lines: readonly EngineLogLine[], id: string, hidden: readonly string[]) =>
  lines.filter((l) => l.message.includes(id) && !hidden.some((h) => l.message.includes(h)))

/** One trak's report, from the log, the engine's lines and the secrets as they are now. */
export const reportFor = (id: TrakId, asked: ReportAsked) =>
  Effect.gen(function* () {
    const events = yield* (yield* Store)
      .events(id)
      .pipe(Effect.catchTag("StoreUndecodable", () => Effect.succeed(undefined)))
    // A line naming a trak or goal the trak's owner may not read stays out, as it does
    // from a snapshot: the report leaves this engine.
    const readable = yield* (yield* People).readable({ trak: id })
    const hidden = [
      ...(yield* (yield* Store).list()).filter((t) => !readable.trak(t)),
      ...(yield* (yield* GoalStore).list()).filter((g) => !readable.goal(g)),
    ]
    // `exit` rather than a catch: reading the list may only die, and a list the engine
    // could not read is a log left out rather than a failed report.
    const secrets = yield* Effect.exit(heldSecrets)
    return reportOf(
      {
        id,
        events,
        engine: linesAbout(yield* (yield* EngineLog).lines, id, hidden),
        secrets: Exit.isSuccess(secrets) ? secrets.value : undefined,
        version: yield* EngineVersion,
        platform: process.platform,
        now: yield* Clock.currentTimeMillis,
      },
      asked,
    )
  })
