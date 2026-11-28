import { describe, expect, it } from "vitest"
import {
  REDACTION_MARK,
  REPORT_FORMAT,
  REPORT_MOST_BYTES,
  REPORT_MOST_LINES,
  type ReportDto,
  type ReportLogIncludedDto,
} from "@orkestra/shared/dto/report"
import { type Event, Events } from "../workflow/domain/event.js"
import { TrakId } from "../workflow/domain/trak.js"
import { mergedLog, newestWithin, reportOf, type ReportSources } from "./report.js"

const ID = TrakId.make("careful-trak")
const HELD = "held-deploy-secret-0123"
const SHAPED = "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB"
const NOW = Date.parse("2026-11-28T12:00:00.000Z")

const at = (e: Event, when: number): Event => ({ ...e, at: when })

const sources = (over: Partial<ReportSources> = {}): ReportSources => ({
  id: ID,
  events: [
    at(Events.trakCreated("Add a --json flag"), NOW - 3000),
    at(Events.mergeFailed(`a conflict near ${HELD} and ${SHAPED}`), NOW - 1000),
  ],
  engine: [{ at: NOW - 2000, level: "WARN", message: `${ID} printed ${HELD}` }],
  secrets: [HELD],
  version: "0.41.2",
  platform: "linux",
  now: NOW,
  ...over,
})

const included = (report: ReportDto): ReportLogIncludedDto => {
  if (report.log._tag !== "Included") throw new Error(`log left out: ${report.log.reason}`)
  return report.log
}

describe("reportOf", () => {
  it("carries the format, the trak's details, the engine and the merged log, oldest first", () => {
    const report = reportOf(sources(), { note: "It stopped.", includeLog: true })
    expect(report.format).toBe(REPORT_FORMAT)
    expect(report.madeAt).toBe("2026-11-28T12:00:00.000Z")
    expect(report.note).toBe("It stopped.")
    expect(report.trak).toEqual({
      id: ID,
      title: "Add a --json flag",
      description: "Add a --json flag",
      state: "Failed",
    })
    expect(report.engine).toEqual({ version: "0.41.2", platform: "linux" })
    const log = included(report)
    expect(log.lines).toHaveLength(3)
    expect(log.lines[0]).toContain('"TrakCreated"')
    expect(log.lines[1]).toContain('"level":"WARN"')
    expect(log.lines[2]).toContain('"MergeFailed"')
    expect(log.leftOut).toEqual({ lines: 0, bytes: 0 })
  })

  it("takes every held value and token shape out of the log and the note, and marks each", () => {
    const report = reportOf(sources(), { note: `I pasted ${HELD} and ${SHAPED}`, includeLog: true })
    const sent = JSON.stringify(report)
    expect(sent).not.toContain(HELD)
    expect(sent).not.toContain(SHAPED)
    expect(report.note).toBe(`I pasted ${REDACTION_MARK} and ${REDACTION_MARK}`)
    const log = included(report)
    expect(log.redactions).toBe(3)
    expect(log.lines.join("\n").split(REDACTION_MARK)).toHaveLength(4)
  })

  it("leaves the log out, and says why, where the list of secrets cannot be read", () => {
    const report = reportOf(sources({ secrets: undefined }), {
      note: `still ${SHAPED}`,
      includeLog: true,
    })
    expect(report.log).toEqual({ _tag: "LeftOut", reason: "secrets-unreadable" })
    expect(JSON.stringify(report)).not.toContain(SHAPED)
  })

  it("leaves the log out where the stored log will not decode", () => {
    const report = reportOf(sources({ events: undefined }), { note: undefined, includeLog: true })
    expect(report.log).toEqual({ _tag: "LeftOut", reason: "undecodable" })
    expect(report.trak).toEqual({ id: ID, title: ID, description: "", state: "Unreadable" })
  })

  it("leaves the log out where the person turned it off, and drops an empty note", () => {
    const report = reportOf(sources(), { note: "   ", includeLog: false })
    expect(report.log).toEqual({ _tag: "LeftOut", reason: "turned-off" })
    expect(report.note).toBeUndefined()
  })
})

describe("mergedLog", () => {
  it("orders an event with no time of its own after the one before it", () => {
    const lines = mergedLog(
      [at(Events.trakCreated("x"), 10), { ...Events.mergeFailed("untimed"), at: undefined }],
      [{ at: 5, level: "ERROR", message: "early" }],
    )
    expect(lines).toEqual([
      expect.stringContaining("early"),
      expect.stringContaining("TrakCreated"),
      expect.stringContaining("MergeFailed"),
    ])
  })
})

describe("newestWithin", () => {
  it("keeps the newest lines within the line bound, and counts what it left out", () => {
    const lines = Array.from({ length: REPORT_MOST_LINES + 500 }, (_, i) => `line ${String(i)}`)
    const cut = newestWithin(lines)
    expect(cut.lines).toHaveLength(REPORT_MOST_LINES)
    expect(cut.lines.at(-1)).toBe(`line ${String(REPORT_MOST_LINES + 499)}`)
    expect(cut.lines[0]).toBe("line 500")
    expect(cut.leftOut.lines).toBe(500)
    const leftBytes = lines.slice(0, 500).reduce((sum, l) => sum + Buffer.byteLength(l) + 1, 0)
    expect(cut.leftOut.bytes).toBe(leftBytes)
    expect(cut.kept.lines).toBe(REPORT_MOST_LINES)
  })

  it("keeps the newest lines within the byte bound, and counts what it left out", () => {
    const line = "x".repeat(10 * 1024 - 1)
    const lines = Array.from({ length: 40 }, () => line)
    const cut = newestWithin(lines)
    expect(cut.lines).toHaveLength(25)
    expect(cut.kept).toEqual({ lines: 25, bytes: 25 * 10 * 1024 })
    expect(cut.kept.bytes).toBeLessThanOrEqual(REPORT_MOST_BYTES)
    expect(cut.leftOut).toEqual({ lines: 15, bytes: 15 * 10 * 1024 })
  })

  it("cuts a log over both bounds through the report, and the report says how much", () => {
    const events = Array.from({ length: 3000 }, (_, i) =>
      at(Events.mergeFailed(`${"y".repeat(200)} ${String(i)}`), NOW - 3000 + i),
    )
    const log = included(
      reportOf(sources({ events, engine: [] }), { note: undefined, includeLog: true }),
    )
    expect(log.kept.bytes).toBeLessThanOrEqual(REPORT_MOST_BYTES)
    expect(log.kept.lines).toBeLessThanOrEqual(REPORT_MOST_LINES)
    expect(log.kept.lines + log.leftOut.lines).toBe(3000)
    expect(log.lines.at(-1)).toContain(" 2999")
  })
})
