/**
 * Tier 1: one run of one check, from two sources that each know half of it.
 *
 * What could go wrong quietly here is attribution and invention — the daemon's memory of
 * an *earlier* attempt drawn on the newest document, and a duration or an exit code
 * printed for a run that reported neither. Both look like facts on screen, so both are
 * what is asserted.
 */

import { describe, expect, it } from "vitest"
import { makeCheckRun } from "../../../fixtures"
import {
  askedText,
  autoFace,
  clock,
  faceFor,
  runOf,
  skippedText,
  verdictText,
  verdictTone,
  type CheckRun,
} from "./check"
import type { Settled } from "../filed"

/** This turn's check failed, as the log says it. */
const FAILED: Settled = {
  _tag: "Failed",
  failed: { name: "verify", output: "1 failed", attempts: 2, exitCode: 1 },
}

/** This turn's check passed, which is all `ChecksPassed` has to say. */
const PASSED: Settled = { _tag: "Passed" }

const run = (over: Partial<CheckRun> = {}): CheckRun => ({
  name: "verify",
  command: "bash .orkestra/checks/verify.sh",
  phase: "running",
  output: "",
  limit: 300,
  startedAt: 1_000_000,
  took: undefined,
  exitCode: undefined,
  attempts: 0,
  place: undefined,
  ...over,
})

describe("runOf", () => {
  it("draws a run in flight off the daemon, which is the only thing that has the output", () => {
    const live = makeCheckRun({ step: 3, output: "compiling\n", limit: 300, startedAt: 1_000 })
    expect(runOf(undefined, live, undefined)).toEqual({
      name: "verify",
      command: "bash /repo/.orkestra/checks/verify.sh",
      phase: "running",
      output: "compiling\n",
      limit: 300,
      startedAt: 1_000,
      took: undefined,
      exitCode: undefined,
      attempts: 0,
    })
  })

  it("takes the checkout off the front of the line it was spawned as", () => {
    // The engine may not assert a relative form it did not run, so the wire carries the
    // absolute path and the shortening is the surface's.
    const live = makeCheckRun({ command: "bash /repo/.orkestra/checks/verify.sh" })
    expect(runOf(undefined, live, "/repo")?.command).toBe("bash .orkestra/checks/verify.sh")
  })

  it("reports how long a settled run took, in whole seconds", () => {
    const live = makeCheckRun({
      startedAt: 1_000,
      finished: { verdict: "passed", exitCode: 0, at: 162_400 },
    })
    expect(runOf(PASSED, live, undefined)?.phase).toBe("passed")
    expect(runOf(PASSED, live, undefined)?.took).toBe(161)
  })

  it("falls back to the log for a failure the daemon has forgotten", () => {
    // A daemon restart takes the run's memory with it. `CheckFailed` is what is left, and
    // it has no times to give — so the run says none rather than inventing one.
    expect(runOf(FAILED, undefined, undefined)).toEqual({
      name: "verify",
      command: undefined,
      phase: "failed",
      output: "1 failed",
      limit: undefined,
      startedAt: undefined,
      took: undefined,
      exitCode: 1,
      attempts: 2,
    })
  })

  it("carries where the run happened, from the daemon while it holds it and the log after", () => {
    const place = { _tag: "Remote", runner: "A sandbox.", sandbox: "sb_1", exec: "ex_1" } as const
    expect(runOf(undefined, makeCheckRun({ place }), undefined)?.place).toEqual(place)
    const failed: Settled = {
      _tag: "Failed",
      failed: { name: "verify", output: "1 failed", attempts: 1, place },
    }
    expect(runOf(failed, undefined, undefined)?.place).toEqual(place)
  })

  it("draws nothing at all where a pass is only on the log", () => {
    // `ChecksPassed` carries the names and no output whatever, so the strip it would buy
    // is a tab leading to an empty console. This is what a passed run costs after a
    // restart, and it is the whole of what it costs.
    expect(runOf(PASSED, undefined, undefined)).toBeUndefined()
  })

  /**
   * **A settled run is paired by the log, and these four are the whole of that rule.** The
   * daemon holds one run per trak with a position on it and no turn, so a re-entered
   * position offers it a document it may never have judged — and the newest document is by
   * construction the one no check has run over yet.
   */
  it("draws a settled run only where this turn's own settlement matches it", () => {
    const passed = makeCheckRun({
      step: 3,
      startedAt: 1_000,
      finished: { verdict: "passed", exitCode: 0, at: 61_000 },
    })
    const failedRun = makeCheckRun({
      step: 3,
      startedAt: 1_000,
      finished: { verdict: "failed", exitCode: 1, at: 61_000 },
    })
    expect(runOf(PASSED, passed, undefined)?.phase).toBe("passed")
    expect(runOf(FAILED, failedRun, undefined)?.phase).toBe("failed")
    // The two crossings, each of which would draw one verdict over the other's document.
    expect(runOf(FAILED, passed, undefined)?.phase).toBe("failed")
    expect(runOf(PASSED, failedRun, undefined)).toBeUndefined()
  })

  it("keeps a passed run off a document filed after it, which nothing has judged", () => {
    // **The defect this replaced.** A person chats at the approval gate, the agent files
    // again, and until the new check starts the daemon still holds the run that passed
    // over the *previous* document — so the newest card drew `verify passed` and the
    // previous run's console over work no check had run on.
    const live = makeCheckRun({
      step: 3,
      output: "611 passed",
      startedAt: 1_000,
      finished: { verdict: "passed", exitCode: 0, at: 61_000 },
    })
    expect(runOf(undefined, live, undefined)).toBeUndefined()
  })

  it("leaves the previous attempt's failure where it belongs rather than on the new one", () => {
    // The same rule from the other side, and the case that was already right: a settled
    // failure with nothing in this turn's window is the run the turn below already draws.
    const live = makeCheckRun({ step: 3, finished: { verdict: "failed", exitCode: 1, at: 9_000 } })
    expect(runOf(undefined, live, undefined)).toBeUndefined()
  })

  it("still draws a run in flight, which is always over what was just filed", () => {
    // `decide` issues `RunChecks` from its `artifact` arm on the document that was just
    // filed, so an unfinished run needs no settlement to be paired — and cannot have one.
    expect(runOf(undefined, makeCheckRun({ step: 3 }), undefined)?.phase).toBe("running")
  })

  it("keeps the daemon's copy of a failure this turn did earn, since it says more", () => {
    const live = makeCheckRun({
      step: 3,
      output: "the whole run",
      startedAt: 1_000,
      finished: { verdict: "failed", exitCode: 1, at: 61_000 },
    })
    const drawn = runOf(FAILED, live, undefined)
    expect(drawn?.output).toBe("the whole run")
    expect(drawn?.attempts).toBe(2)
  })
})

describe("verdictText", () => {
  it("counts a run in flight against the ceiling it has", () => {
    expect(verdictText(run({ startedAt: 1_000_000 }), 1_072_000)).toBe("verify · 1m12s of 5m00s")
  })

  it("says how long a pass took, and nothing where the run is only on the log", () => {
    expect(verdictText(run({ phase: "passed", took: 161 }), 0)).toBe("verify passed · 2m41s")
    expect(verdictText(run({ phase: "passed", took: undefined }), 0)).toBe("verify passed")
  })

  it("says what a failure exited with, and stays silent about a timeout", () => {
    // A timeout and a check that could not be spawned have no exit code at all, and
    // `verify failed · exit undefined` would read as one.
    expect(verdictText(run({ phase: "failed", exitCode: 1 }), 0)).toBe("verify failed · exit 1")
    expect(verdictText(run({ phase: "failed", exitCode: undefined }), 0)).toBe("verify failed")
  })

  it("reports no elapsed at all where the browser's clock is behind the engine's", () => {
    expect(verdictText(run({ startedAt: 1_000_000 }), 900_000)).toBe("verify")
  })

  it("is the five tones and no sixth", () => {
    expect(verdictTone("running")).toBe("working")
    expect(verdictTone("passed")).toBe("good")
    expect(verdictTone("failed")).toBe("bad")
  })
})

describe("clock", () => {
  it("keeps a fixed width past the minute, so a counting number does not move", () => {
    expect(clock(41)).toBe("41s")
    expect(clock(60)).toBe("1m00s")
    expect(clock(72)).toBe("1m12s")
    expect(clock(300)).toBe("5m00s")
  })
})

describe("faceFor", () => {
  it("opens on the gate while a check runs, and hands the document back when it passes", () => {
    expect(autoFace(run())).toBe("gate")
    expect(autoFace(run({ phase: "passed" }))).toBe("document")
  })

  it("opens on the gate for a failure, which is settled rather than configurable", () => {
    expect(autoFace(run({ phase: "failed" }))).toBe("gate")
  })

  it("stays where a person put it while the run stands as it did", () => {
    expect(faceFor(run(), { phase: "running", face: "document" })).toBe("document")
  })

  it("takes a reader who chose the document to the evidence when the run fails", () => {
    // The press on offer takes work a script says is wrong, so a choice made while it was
    // still going is not a standing answer about a run that has since come back.
    expect(faceFor(run({ phase: "failed" }), { phase: "running", face: "document" })).toBe("gate")
  })
})

describe("askedText", () => {
  it("says how many times it ran, because that is what makes it a gate", () => {
    expect(askedText(3)).toBe(
      "Ran 3 times and failed each time. Approving takes the work anyway; replying sends the agent back with what you say.",
    )
  })

  it("counts nothing where it ran once", () => {
    expect(askedText(1)).toBe(
      "Approving takes the work anyway; replying sends the agent back with what you say.",
    )
  })
})

/** This turn's check was ended by a person, as the log says it. */
const CANCELLED: Settled = { _tag: "Cancelled", name: "verify" }

/** This turn's checks were kept from running by a person's switch. */
const SKIPPED: Settled = { _tag: "Skipped", names: ["verify"] }

describe("runOf, on the two runs a person caused", () => {
  it("draws a run somebody ended off the daemon, with what it printed and how long it ran", () => {
    const live = makeCheckRun({
      step: 3,
      output: "compiling\n",
      startedAt: 1_000,
      finished: { verdict: "cancelled", at: 73_000 },
    })
    expect(runOf(CANCELLED, live, undefined)).toMatchObject({
      phase: "cancelled",
      output: "compiling\n",
      took: 72,
      exitCode: undefined,
    })
    // And only over the document it judged — a cancelled run is paired like any other.
    expect(runOf(PASSED, live, undefined)).toBeUndefined()
  })

  it("draws a run somebody ended off the log after a restart, without a console", () => {
    expect(runOf(CANCELLED, undefined, undefined)).toEqual({
      name: "verify",
      command: undefined,
      phase: "cancelled",
      output: "",
      limit: undefined,
      startedAt: undefined,
      took: undefined,
      exitCode: undefined,
      attempts: 0,
    })
    // The press raced the run starting, so the engine had no name to give.
    expect(runOf({ _tag: "Cancelled", name: undefined }, undefined, undefined)?.name).toBe("checks")
  })

  it("draws a skipped run off the log alone, since no run ever existed to be remembered", () => {
    expect(runOf(SKIPPED, undefined, undefined)).toMatchObject({
      name: "verify",
      phase: "skipped",
      output: "",
    })
    expect(
      runOf({ _tag: "Skipped", names: ["no-secrets", "verify"] }, undefined, undefined)?.name,
    ).toBe("no-secrets, verify")
  })
})

describe("runOf, on a pass taken from an earlier run", () => {
  it("draws it off the log, and pairs no remembered run with it", () => {
    const REUSED: Settled = { _tag: "Reused", names: ["verify"] }
    expect(runOf(REUSED, undefined, undefined)).toMatchObject({
      name: "verify",
      phase: "reused",
      output: "",
    })
    // The daemon's newest pass is an older run's: drawing it here would put that run's
    // console over a document it never judged.
    const older = makeCheckRun({ step: 3, finished: { verdict: "passed", at: 2_000 } })
    expect(runOf(REUSED, older, undefined)?.phase).toBe("reused")
  })
})

describe("what the two say on the strip", () => {
  it("says who ended a run, in the neutral tone, and how long it had run", () => {
    expect(verdictText(run({ phase: "cancelled", took: 72 }), 0)).toBe(
      "verify ended by you · 1m12s",
    )
    expect(verdictText(run({ phase: "cancelled" }), 0)).toBe("verify ended by you")
    expect(verdictTone("cancelled")).toBe("neutral")
  })

  it("says the checks were skipped, in the waiting tone, and opens on the document", () => {
    expect(verdictText(run({ phase: "skipped" }), 0)).toBe("checks skipped")
    expect(verdictTone("skipped")).toBe("waiting")
    expect(autoFace(run({ phase: "skipped" }))).toBe("document")
    // Nothing is behind the gate face, so a press that reached it lands on the document.
    expect(faceFor(run({ phase: "skipped" }), { phase: "skipped", face: "gate" })).toBe("document")
  })

  it("says a reused pass passed before, in the good tone, with no console to open", () => {
    expect(verdictText(run({ phase: "reused" }), 0)).toBe("verify passed before on these files")
    expect(verdictTone("reused")).toBe("good")
    expect(autoFace(run({ phase: "reused" }))).toBe("document")
    expect(faceFor(run({ phase: "reused" }), { phase: "reused", face: "gate" })).toBe("document")
  })

  it("opens a run somebody ended on the evidence, as a failure is", () => {
    expect(autoFace(run({ phase: "cancelled" }))).toBe("gate")
  })

  it("names what did not run in the card's body, singular and plural", () => {
    expect(skippedText(["verify"])).toBe("verify did not run. This step was accepted without it.")
    expect(skippedText(["no-secrets", "verify"])).toBe(
      "no-secrets and verify did not run. This step was accepted without them.",
    )
  })
})
