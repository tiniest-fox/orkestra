// Tier-1: which lines a rejoined turn skips, matched against what the dead engine wrote.

import { describe, expect, it } from "vitest"
import {
  SaidEntry,
  SessionEntry,
  SpawnedEntry,
  TextEntry,
  ToolEntry,
  type TranscriptEntry,
} from "../types/transcript-entry.js"
import { rejoinedLine, writtenBy } from "./rejoined.js"

const text = (t: string, at = 1): TranscriptEntry => TextEntry.make({ text: t, position: 2, at })
const tool = (detail: string): TranscriptEntry =>
  ToolEntry.make({ name: "Read", kind: "Read", detail, position: 2, at: 5 })

/** Every line of `replay` through `rejoinedLine`, and the ones it writes. */
const writes = (
  written: readonly TranscriptEntry[],
  replay: readonly TranscriptEntry[],
): readonly TranscriptEntry[] => {
  let matched = 0
  return replay.filter((line) => {
    const step = rejoinedLine(written, matched, line)
    matched = step.matched
    return !step.skip
  })
}

describe("writtenBy", () => {
  it("is the stream's lines after the first spawn of the exec, the engine's own left out", () => {
    const entries: readonly TranscriptEntry[] = [
      SpawnedEntry.make({ pid: 1, execId: "before" }),
      text("an earlier turn"),
      SpawnedEntry.make({ pid: 2, execId: "e1" }),
      SessionEntry.make({ id: "s" }),
      SaidEntry.make({ text: "a person's message" }),
      text("hello"),
      SpawnedEntry.make({ pid: 3, execId: "e1" }),
      tool("/a.ts"),
    ]
    expect(writtenBy(entries, "e1")).toEqual([
      SessionEntry.make({ id: "s" }),
      text("hello"),
      tool("/a.ts"),
    ])
  })

  it("is nothing for an exec no line names", () => {
    expect(writtenBy([text("x")], "e1")).toEqual([])
  })
})

describe("rejoinedLine", () => {
  it("skips the lines already written, whenever they were written, and writes the rest", () => {
    const written = [text("hello", 100), tool("/a.ts")]
    const replay = [text("hello", 900), tool("/a.ts"), text("after the restart")]
    expect(writes(written, replay)).toEqual([text("after the restart")])
  })

  it("writes the spawn that rejoined, without counting it against the record", () => {
    const spawn = SpawnedEntry.make({ pid: 9, execId: "e1" })
    expect(writes([text("hello")], [spawn, text("hello"), text("new")])).toEqual([
      spawn,
      text("new"),
    ])
  })

  it("writes everything from the first line that differs, rather than lose one", () => {
    const written = [text("hello"), text("world")]
    expect(writes(written, [text("hello"), text("other"), text("world")])).toEqual([
      text("other"),
      text("world"),
    ])
  })

  it("matches a line whose keys came back from the disk in another order", () => {
    const decoded = { detail: "/a.ts", kind: "Read", name: "Read", _tag: "Tool" } as const
    expect(writes([decoded], [tool("/a.ts")])).toEqual([])
  })
})
