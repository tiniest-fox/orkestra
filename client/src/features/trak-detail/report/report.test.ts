import { describe, expect, it } from "vitest"
import { makeReport } from "../../../fixtures"
import { cutWords, detailRows, isLink, logLocked, logNote, piecesOf } from "./report"
import { outcomeOf } from "./useReport"

describe("piecesOf", () => {
  it("cuts a line at each redaction mark, keeping the words between", () => {
    expect(piecesOf("env GH_TOKEN=[redacted] and [redacted]")).toEqual([
      { key: 0, text: "env GH_TOKEN=", removed: false },
      { key: 13, text: "[redacted]", removed: true },
      { key: 23, text: " and ", removed: false },
      { key: 28, text: "[redacted]", removed: true },
    ])
    expect(piecesOf("nothing taken")).toEqual([{ key: 0, text: "nothing taken", removed: false }])
  })
})

describe("logNote", () => {
  it("says how much of a cut log goes and how much was left out", () => {
    const log = {
      _tag: "Included",
      lines: [],
      kept: { lines: 2000, bytes: 1 },
      leftOut: { lines: 14212, bytes: 1 },
      redactions: 0,
    } as const
    expect(logNote(log)).toBe(
      "The last 2,000 lines. 14,212 earlier lines are left out, and the report says how many.",
    )
    expect(logNote({ ...log, leftOut: { lines: 0, bytes: 0 } })).toBe(
      "The whole log, 2,000 lines, cleaned of secrets.",
    )
  })
})

const left = (reason: "secrets-unreadable" | "undecodable" | "turned-off") =>
  logLocked(makeReport({ log: { _tag: "LeftOut", reason } }))

describe("logLocked", () => {
  it("is the reason for a log the engine could not clean or decode, and nothing otherwise", () => {
    expect(left("secrets-unreadable")).toMatch(/could not read its list of secrets/)
    expect(left("undecodable")).toMatch(/will not decode/)
    expect(left("turned-off")).toBeUndefined()
    expect(logLocked(makeReport())).toBeUndefined()
    expect(logLocked(undefined)).toBeUndefined()
  })
})

describe("isLink", () => {
  it("opens an http or https reference and only copies anything else", () => {
    expect(isLink("https://reports.example/42")).toBe(true)
    expect(isLink("FB-20261127-0042")).toBe(false)
    expect(isLink("javascript:alert(1)")).toBe(false)
  })
})

describe("detailRows", () => {
  it("lists only the details the report carries", () => {
    const rows = detailRows(makeReport())
    expect(rows.map(([key]) => key)).toEqual(["trak", "position", "state", "agent", "engine"])
    expect(rows.at(-1)).toEqual(["engine", "orkestra 0.41.2 · darwin"])
  })
})

describe("outcomeOf", () => {
  it("reads the host's reference, its reason, and a request that failed", () => {
    expect(outcomeOf(undefined, null)).toBeUndefined()
    expect(outcomeOf({ _tag: "Sent", reference: "FB-1" }, null)).toEqual({ sent: "FB-1" })
    expect(outcomeOf({ _tag: "NotSent", reason: "No." }, null)).toEqual({ failed: "No." })
    expect(outcomeOf(undefined, new Error("down"))).toEqual({
      failed: "The report did not reach the engine.",
    })
  })
})

describe("cutWords", () => {
  it("says how many bytes the cut took off a text", () => {
    expect(cutWords(123_456)).toBe("⋯ 123,456 more bytes left out")
  })
})
