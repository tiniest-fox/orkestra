import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { TranscriptEntry } from "./transcript-entry.js"

// `Schema` rather than the module's own `decodeTranscriptEntry`/`encodeTranscriptEntry`:
// those are Effects, and `types/` is pure — see `where-code-goes`. The sync pair
// decodes the same schema and throws, which is all an assertion needs.
const decode = Schema.decodeUnknownSync(TranscriptEntry)
const encode = Schema.encodeSync(TranscriptEntry)

describe("the position a transcript entry carries", () => {
  it("decodes a line written before the field existed, and does not invent one", () => {
    // The whole of the compatibility story, asserted where the guarantee lives.
    // Every `transcript.jsonl` already on disk looks like this, and there is no
    // version field and no migration to make it not.
    const old = decode({ _tag: "Spawned", pid: 41 })

    expect(old).toStrictEqual({ _tag: "Spawned", pid: 41 })
    expect("position" in old).toBe(false)
  })

  it("survives a round trip without the absent key becoming a present undefined", () => {
    // `exactOptionalPropertyTypes` is what makes absent mean absent, and a round
    // trip is where a re-encode would quietly turn it into `{"position":null}`.
    expect(encode({ _tag: "Note", text: "Result(20 chars)" })).toStrictEqual({
      _tag: "Note",
      text: "Result(20 chars)",
    })
  })

  it("takes a step index and the composer's own marker", () => {
    // Two facts that are not each other, and neither is absence: a turn with no
    // position is the composer's, a line with no field is an older log's.
    expect(decode({ _tag: "Session", id: "s-0", position: 3 })).toMatchObject({ position: 3 })
    expect(decode({ _tag: "Session", id: "s-p", position: "composer" })).toMatchObject({
      position: "composer",
    })
  })

  it("refuses a position that is neither", () => {
    expect(
      Schema.decodeUnknownEither(TranscriptEntry)({ _tag: "Note", text: "x", position: "step-3" })
        ._tag,
    ).toBe("Left")
  })
})

describe("the time a transcript entry carries", () => {
  it("is absent on a line written before the store stamped one", () => {
    // The same compatibility story `position` has, asserted separately because a
    // duration read off a missing stamp is a wrong number rather than a missing one.
    const old = decode({ _tag: "Tool", name: "Bash", kind: "Bash" })

    expect("at" in old).toBe(false)
  })

  it("rides on every tag, not just the ones a duration is drawn between", () => {
    expect(decode({ _tag: "Spawned", pid: 41, at: 1000 })).toMatchObject({ at: 1000 })
    expect(decode({ _tag: "Note", text: "Thinking", at: 2000 })).toMatchObject({ at: 2000 })
    expect(decode({ _tag: "Subagent", call: "t-1", at: 3000 })).toMatchObject({ at: 3000 })
  })
})

describe("the entries this audit added", () => {
  it("keeps a detached call apart from an inline one, and absence means inline", () => {
    expect(
      decode({ _tag: "Tool", name: "Agent", kind: "Task", call: "t-1", backgrounded: true }),
    ).toMatchObject({ backgrounded: true })
    expect("backgrounded" in decode({ _tag: "Tool", name: "Agent", kind: "Task" })).toBe(false)
  })

  it("round-trips a retry, and keeps a reported status apart from none", () => {
    const withStatus = { _tag: "ApiRetry", attempt: 2, of: 5, status: "429", waitedMs: 1200 }

    expect(encode(decode(withStatus))).toStrictEqual(withStatus)
    // A transport failure has no HTTP status, and the key is absent rather than empty.
    expect("status" in decode({ _tag: "ApiRetry", attempt: 1, of: 5 })).toBe(false)
  })
})
