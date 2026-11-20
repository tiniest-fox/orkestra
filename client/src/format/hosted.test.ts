// Tier 1: what each of the eight states reads as. The words and the lines are what a
// person acts on — whether to look at the log, whether to start it again — so each state
// is asserted rather than sampled.

import { describe, expect, it } from "vitest"
import type { HostedStateDto } from "../api/types"
import { makeHostedProcess } from "../fixtures"
import {
  clockAt,
  failureOf,
  hostedLine,
  hostedTone,
  hostedWord,
  onPageOrigin,
  openerState,
  pageAbsent,
} from "./hosted"

const AT = new Date(2026, 9, 6, 10, 42).getTime()

const STATES: Record<HostedStateDto["_tag"], HostedStateDto> = {
  NotStarted: { _tag: "NotStarted" },
  Preparing: {
    _tag: "Preparing",
    port: 47213,
    startedAt: AT - 9_000,
    stage: { _tag: "Copying", sent: 120, total: 900 },
  },
  Starting: { _tag: "Starting", port: 47213, startedAt: AT - 6_000 },
  Running: {
    _tag: "Running",
    port: 47213,
    startedAt: AT - 720_000,
    readyAt: AT - 720_000,
    url: "http://[::1]:47213/",
  },
  DidNotComeUp: {
    _tag: "DidNotComeUp",
    port: 47213,
    startedAt: AT - 30_000,
    at: AT,
    reason:
      "It exited with code 127 before anything answered on port 47213.\natelier.sh: line 1: exec: atelier: not found",
  },
  Exited: { _tag: "Exited", port: 47213, startedAt: AT - 660_000, at: AT, code: 1 },
  Stopped: { _tag: "Stopped", port: 47213, startedAt: AT - 60_000, at: AT },
  StoppedByRestart: { _tag: "StoppedByRestart", at: AT },
}

const of = (tag: HostedStateDto["_tag"]) => makeHostedProcess({ name: "dev", state: STATES[tag] })

describe("a hosted process's state in words", () => {
  it("says each state's line, with the port and the clock", () => {
    expect(hostedLine(of("NotStarted"), AT)).toBe("dev.sh has not run in this checkout")
    expect(hostedLine(of("Preparing"), AT)).toBe("Copying files into the sandbox · 120 of 900 · 9s")
    expect(hostedLine(of("Starting"), AT)).toBe("Waiting for port 47213 to answer · 6s")
    expect(hostedLine(of("Running"), AT)).toBe("Running on port 47213 · up 12m 0s")
    expect(hostedLine(of("DidNotComeUp"), AT)).toBe(
      "It exited with code 127 before anything answered on port 47213.",
    )
    expect(hostedLine(of("Exited"), AT)).toBe("Exited with code 1 at 10:42, after 11m 0s")
    expect(hostedLine(of("Stopped"), AT)).toBe("Stopped at 10:42")
    expect(hostedLine(of("StoppedByRestart"), AT)).toBe(
      "Stopped when the engine restarted at 10:42",
    )
  })

  it("splits a failed start's reason from the last lines its script printed", () => {
    expect(failureOf("Nothing answered on port 1 in 30s.")).toEqual({
      said: "Nothing answered on port 1 in 30s.",
      tail: [],
    })
    const state = STATES.DidNotComeUp
    expect(state._tag === "DidNotComeUp" && failureOf(state.reason).tail).toEqual([
      "atelier.sh: line 1: exec: atelier: not found",
    ])
    expect(state._tag === "DidNotComeUp" && pageAbsent(state)).toBe(
      "It exited with code 127 before anything answered on port 47213.",
    )
  })

  it("says each stage a start waits on before its script runs", () => {
    const at = (stage: { readonly _tag: "Readying" } | { readonly _tag: "Launching" }) =>
      hostedLine(
        makeHostedProcess({
          state: { _tag: "Preparing", port: 1, startedAt: AT, stage },
        }),
        AT,
      )
    expect(at({ _tag: "Readying" })).toBe("Waking the sandbox · 0s")
    expect(at({ _tag: "Launching" })).toBe("Starting its script · 0s")
    expect(hostedTone("Preparing")).toBe("working")
  })

  it("says a signal where an exit has no code", () => {
    const killed = makeHostedProcess({
      state: { _tag: "Exited", port: 1, startedAt: AT, at: AT, signal: "SIGKILL" },
    })
    expect(hostedWord(killed.state)).toBe("Exited")
    expect(hostedLine(killed, AT)).toBe("Ended by SIGKILL at 10:42, after 0s")
  })

  it("is a failure only where nobody asked for it", () => {
    expect(hostedTone("DidNotComeUp")).toBe("bad")
    expect(hostedTone("Exited")).toBe("bad")
    expect(hostedTone("Stopped")).toBe("neutral")
    expect(hostedTone("StoppedByRestart")).toBe("neutral")
  })

  it("draws the clock in the browser's own time", () => {
    expect(clockAt(new Date(2026, 0, 1, 9, 5).getTime())).toBe("09:05")
  })
})

describe("the state the opener wears", () => {
  it("is the worst one, broken before moving before up", () => {
    expect(openerState([of("Running"), of("Exited"), of("Starting")])).toBe("Exited")
    expect(openerState([of("Running"), of("Starting")])).toBe("Starting")
    expect(openerState([of("Starting"), of("Preparing")])).toBe("Preparing")
    expect(openerState([of("Running"), of("Stopped")])).toBe("Running")
  })

  it("is nothing while every process is at rest", () => {
    expect(openerState([of("NotStarted"), of("Stopped"), of("StoppedByRestart")])).toBeUndefined()
    expect(openerState([])).toBeUndefined()
  })
})

describe("a loopback address at a page origin", () => {
  it("moves to the hostname, path, query and fragment kept", () => {
    expect(onPageOrigin("http://[::1]:5173/a?b#c", "https://dev--t--p.example.com")).toBe(
      "https://dev--t--p.example.com/a?b#c",
    )
  })
})
