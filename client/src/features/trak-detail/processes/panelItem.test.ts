import { describe, expect, it } from "vitest"
import { makeHostedProcess } from "../../../fixtures"
import { shownItem } from "./panelItem"

const DEV = makeHostedProcess({ name: "dev" })
const API = makeHostedProcess({ name: "api" })

describe("which item the side panel draws", () => {
  it("draws the pull request where it was picked", () => {
    expect(shownItem([DEV], true, { kind: "pull" })).toStrictEqual({ kind: "pull" })
  })

  it("falls back to the first process once the pull request is gone", () => {
    expect(shownItem([DEV, API], false, { kind: "pull" })).toStrictEqual({
      kind: "process",
      process: DEV,
    })
  })

  it("draws the process picked, or the first where it is no longer declared", () => {
    expect(shownItem([DEV, API], true, { kind: "process", name: "api" })).toStrictEqual({
      kind: "process",
      process: API,
    })
    expect(shownItem([DEV], true, { kind: "process", name: "api" })).toStrictEqual({
      kind: "process",
      process: DEV,
    })
  })

  it("draws the pull request for a project that declares no process, and nothing without one", () => {
    expect(shownItem([], true, undefined)).toStrictEqual({ kind: "pull" })
    expect(shownItem([], false, undefined)).toBeUndefined()
  })
})
