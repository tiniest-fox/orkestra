/**
 * Tier 1: which rows of the list wear a ring, and what the ring is a fraction of.
 */

import { describe, expect, it } from "vitest"
import { makeTrak } from "../../fixtures"
import { contextShare } from "./contextShare"

const held = {
  inputTokens: 20,
  outputTokens: 1_000,
  cacheReadTokens: 119_000,
  cacheWriteTokens: 4_980,
}

describe("contextShare", () => {
  it("is the reading over the window the engine resolved, and nothing scaled against other rows", () => {
    expect(contextShare(makeTrak({ context: { held, window: 200_000 } }))).toBeCloseTo(0.625, 6)
    expect(contextShare(makeTrak({ context: { held, window: 100_000 } }))).toBeCloseTo(1.25, 6)
  })

  it("draws no ring where the engine sent no reading, which is every ended trak and every unread position", () => {
    // The engine leaves the field off a merged or finished trak and off a step whose
    // agent has said nothing yet; the ring asks nothing of the state itself.
    expect(contextShare(makeTrak())).toBeUndefined()
    expect(contextShare(makeTrak({ state: { _tag: "Merged", sha: "abc1234" } }))).toBeUndefined()
    expect(
      contextShare(makeTrak({ state: { _tag: "AgentWorking", step: 2 }, running: true })),
    ).toBeUndefined()
  })

  it("draws no ring against no window, rather than against a guessed one", () => {
    expect(contextShare(makeTrak({ context: { held } }))).toBeUndefined()
    expect(contextShare(makeTrak({ context: { held, window: 0 } }))).toBeUndefined()
  })
})
