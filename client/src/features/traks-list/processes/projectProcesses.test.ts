// Tier 1: what the git bar says about the project checkout's processes. The marks are what
// a person reads at rest to decide whether to open the list, so the ordering — a failure
// before a count of what is up — is asserted case by case.

import { describe, expect, it } from "vitest"
import type { HostedStateDto } from "../../../api/types"
import { makeHostedProcess } from "../../../fixtures"
import { pageAddress, processCount, rowLine, tally } from "./projectProcesses"

const AT = Date.UTC(2026, 9, 23, 15, 40)

const RUNNING: HostedStateDto = {
  _tag: "Running",
  port: 30377,
  startedAt: AT - 120_000,
  readyAt: AT - 90_000,
  url: "http://[::1]:30377/",
}
const EXITED: HostedStateDto = {
  _tag: "Exited",
  port: 30411,
  startedAt: AT - 60_000,
  at: AT,
  code: 1,
}
const IDLE: HostedStateDto = { _tag: "NotStarted" }

const set = (...states: readonly HostedStateDto[]) =>
  states.map((state, i) => makeHostedProcess({ name: `p${String(i)}`, state }))

describe("the project checkout's processes on the git bar", () => {
  it("tallies what is up and what is down on the strip", () => {
    expect(tally(set(RUNNING, RUNNING))).toBe("2 running")
    expect(tally(set(RUNNING, EXITED))).toBe("1 up · 1 down")
    expect(tally(set(EXITED, IDLE))).toBe("1 down")
    expect(tally(set(IDLE, IDLE))).toBe("none running")
  })
  it("counts the dock tab's badge the same way", () => {
    expect(processCount(set(RUNNING, EXITED))).toEqual({ n: 1, tone: "bad" })
    expect(processCount(set(RUNNING, RUNNING, IDLE))).toEqual({ n: 2, tone: "good" })
    expect(processCount(set(IDLE))).toBeUndefined()
  })
  it("says a row's state in a short line", () => {
    const [running, exited, idle] = set(RUNNING, EXITED, IDLE)
    expect(running && rowLine(running, AT)).toBe("up 1m 30s")
    expect(exited && rowLine(exited, AT)).toBe("exited 1")
    expect(idle && rowLine(idle, AT)).toBe("not started")
    expect(
      rowLine(makeHostedProcess({ state: { _tag: "Starting", port: 5173, startedAt: AT } }), AT),
    ).toBe("starting · port 5173")
  })
})

const origins = (name: string): string | undefined =>
  name.length > 10 ? undefined : `https://${name}--checkout--proj.example.com`

describe("where a row's page link opens", () => {
  it("is the page's own hostname behind a page domain, the path kept", () => {
    const process = makeHostedProcess({
      name: "atelier",
      state: { ...RUNNING, url: "http://[::1]:30377/at/" },
    })
    expect(pageAddress(process, origins)).toBe("https://atelier--checkout--proj.example.com/at/")
  })

  it("is the loopback address with no page domain, or a name too long for a hostname", () => {
    expect(pageAddress(makeHostedProcess({ state: RUNNING }), undefined)).toBe(RUNNING.url)
    const long = makeHostedProcess({ name: "a-long-process-name", state: RUNNING })
    expect(pageAddress(long, origins)).toBe(RUNNING.url)
  })

  it("is nowhere for a process with no page, or one that is not up", () => {
    expect(pageAddress(makeHostedProcess({ page: false, state: RUNNING }), origins)).toBeUndefined()
    expect(pageAddress(makeHostedProcess({ state: IDLE }), origins)).toBeUndefined()
  })
})
