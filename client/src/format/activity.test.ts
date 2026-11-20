/**
 * Tier 1: one transcript fact as one string, with no React and no fetch.
 */

import { describe, expect, it } from "vitest"
import { makeApiRetry, makeText, makeTool } from "../fixtures"
import { activityText, elapsedText, keepsTail, retryText } from "./activity"

describe("keepsTail", () => {
  it("keeps the end of a path, which is the part that says which file", () => {
    expect(keepsTail("Read")).toBe(true)
    expect(keepsTail("Edit")).toBe(true)
    expect(keepsTail("Write")).toBe(true)
  })

  it("keeps the start of a command, which is the part that says what it did", () => {
    expect(keepsTail("Bash")).toBe(false)
    expect(keepsTail("Grep")).toBe(false)
  })
})

describe("retryText", () => {
  it("says which attempt of how many, and what came back", () => {
    expect(retryText(makeApiRetry({ attempt: 2, of: 5, status: "429" }))).toBe(
      "retrying · 429 · attempt 2 of 5",
    )
  })

  it("drops the status where the provider reported none", () => {
    // A transport failure has no HTTP status, and `retrying · undefined` reads as a fact.
    expect(retryText(makeApiRetry({ attempt: 1, of: 5, status: undefined }))).toBe(
      "retrying · attempt 1 of 5",
    )
  })
})

describe("elapsedText", () => {
  const now = 1_786_400_000_000

  it("counts in seconds under a minute, which is most calls", () => {
    expect(elapsedText(now - 31_000, now)).toBe("31s")
    expect(elapsedText(now - 900, now)).toBe("0s")
  })

  it("counts in minutes and seconds up to an hour", () => {
    expect(elapsedText(now - 112_000, now)).toBe("1m 52s")
    expect(elapsedText(now - 60_000, now)).toBe("1m 0s")
  })

  it("drops to hours and minutes past one, where the seconds stop being the point", () => {
    expect(elapsedText(now - 4_320_000, now)).toBe("1h 12m")
  })

  it("says nothing where the engine stamped no time", () => {
    // Every line written before the stamp existed. A row with no duration has to read as
    // *we do not know*, and a `0s` there would read as *it was instant*.
    expect(elapsedText(undefined, now)).toBeUndefined()
  })

  it("says nothing about a stamp in the future rather than a negative duration", () => {
    // The browser's clock and the engine's disagreeing, which is a thing that happens.
    expect(elapsedText(now + 5_000, now)).toBeUndefined()
  })
})

const artifact = JSON.stringify({ type: "artifact", sections: { Summary: "done" } })
const fenced = "```json\n" + artifact + "\n```"

describe("activityText", () => {
  it("draws the agent's words whole — the envelope is taken out before it is asked", () => {
    expect(activityText(makeText({ text: fenced }))).toBe(fenced)
  })

  it("names the tool and what it touched", () => {
    expect(activityText(makeTool({ name: "Edit", kind: "Edit", detail: "src/app/dto.ts" }))).toBe(
      "Edit src/app/dto.ts",
    )
  })

  it("names an MCP call by its server and tool alone", () => {
    const mcp = makeTool({ name: "mcp_tool_call", kind: "Mcp", detail: "linear/get_issue" })
    expect(activityText(mcp)).toBe("linear/get_issue")
  })
})
