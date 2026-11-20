import { describe, expect, it } from "vitest"
import { isUnreached, lastLine, runnerFailureOf, runnerReason } from "./runner-failure.js"

const ending = {
  file: ".orkestra/runner.sh",
  verb: "create",
  stderr: "pulling the image\ncreate: the region is full\n",
  limited: undefined,
  unreachable: undefined,
  lost: undefined,
  absent: undefined,
  failed: undefined,
}

describe("runnerFailureOf", () => {
  it("leads a verb that only exited with the last line of its stderr", () => {
    expect(runnerFailureOf(ending)).toEqual({
      kind: "failed",
      said: "create: the region is full",
      file: ".orkestra/runner.sh",
      verb: "create",
      stderr: ending.stderr,
    })
  })

  it("leads with the script's limit over a loss it reported too", () => {
    expect(
      runnerFailureOf({ ...ending, limited: "five starts a minute", lost: "would not start" }),
    ).toMatchObject({ kind: "limited", said: "five starts a minute" })
    expect(runnerFailureOf({ ...ending, lost: "would not start" })).toMatchObject({
      kind: "lost",
      said: "would not start",
    })
  })

  it("leads with an unreachable API over the loss it caused, and below a limit", () => {
    const both = {
      ...ending,
      unreachable: "the API did not answer",
      lost: "the connection dropped",
    }
    expect(runnerFailureOf(both)).toMatchObject({
      kind: "unreachable",
      said: "the API did not answer",
    })
    expect(runnerFailureOf({ ...both, limited: "five starts a minute" }).kind).toBe("limited")
    expect(runnerReason(runnerFailureOf({ ...both, stderr: "" }))).toBe(
      "the sandbox provider could not be reached: the API did not answer (.orkestra/runner.sh create)",
    )
  })

  it("counts an unreachable API and a loss as the sandbox not reached, and nothing else", () => {
    expect(isUnreached(runnerFailureOf({ ...ending, unreachable: "down" }))).toBe(true)
    expect(isUnreached(runnerFailureOf({ ...ending, lost: "dropped" }))).toBe(true)
    expect(isUnreached(runnerFailureOf({ ...ending, limited: "five a minute" }))).toBe(false)
    expect(isUnreached(runnerFailureOf({ ...ending, absent: "no sandbox" }))).toBe(false)
    expect(isUnreached(runnerFailureOf({ ...ending, failed: "refused (401)" }))).toBe(false)
    expect(isUnreached(runnerFailureOf(ending))).toBe(false)
    expect(isUnreached(undefined)).toBe(false)
  })

  it("leads an absent sandbox and a refused request with the script's own words", () => {
    expect(runnerFailureOf({ ...ending, absent: "there is no sandbox for t1" })).toMatchObject({
      kind: "absent",
      said: "there is no sandbox for t1",
    })
    expect(
      runnerFailureOf({ ...ending, failed: "the provider refused GET /x (401)" }),
    ).toMatchObject({
      kind: "failed",
      said: "the provider refused GET /x (401)",
    })
  })

  it("says so where the script printed nothing", () => {
    expect(runnerFailureOf({ ...ending, stderr: "" }).said).toBe("it printed nothing")
  })
})

describe("runnerReason", () => {
  it("names the kind, the sentence, the file and the verb, then the whole of stderr", () => {
    expect(runnerReason(runnerFailureOf({ ...ending, limited: "five starts a minute" }))).toBe(
      "the sandbox provider's limit was reached: five starts a minute (.orkestra/runner.sh create)\npulling the image\ncreate: the region is full",
    )
  })

  it("keeps to one line where stderr says no more than the sentence", () => {
    expect(runnerReason(runnerFailureOf({ ...ending, stderr: "no space left\n" }))).toBe(
      "the runner failed: no space left (.orkestra/runner.sh create)",
    )
  })
})

describe("lastLine", () => {
  it("skips the blank lines at the end", () => {
    expect(lastLine("one\ntwo\n\n  \n")).toBe("two")
    expect(lastLine("")).toBe("")
  })
})
