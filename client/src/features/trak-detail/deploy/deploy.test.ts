// Tier-1: what the deploy block is built from, off the wire's `deploy`, `landed` and
// `waiting`.

import { describe, expect, it } from "vitest"
import type { WaitingDto } from "../../../api/types"
import { makeAgentStep, makeComposeEntry, makeDeploy, makePlan } from "../../../fixtures"
import {
  deployAsked,
  deployRan,
  deployWords,
  headWords,
  heldEntries,
  heldHead,
  heldOnDeploy,
  shownUrl,
} from "./deploy"

/** The composer's entry, a step that ran, the held step, and one behind it. */
const plan = makePlan({
  steps: [
    makeComposeEntry(),
    makeAgentStep({ agent: "builder", instruction: "build the drawer" }),
    makeAgentStep({ agent: "verify-prod", instruction: "check the answers page" }),
    makeAgentStep({ agent: "announce", instruction: "post what shipped" }),
  ],
})

const held: WaitingDto = { step: 2, name: "deployed", stopped: false }

describe("deployAsked", () => {
  it("asks only where there is a merge commit to hand the script", () => {
    expect(deployAsked({ _tag: "Finished" }, undefined)).toBe(false)
    expect(deployAsked({ _tag: "Finished" }, { sha: "8c41d0e" })).toBe(true)
    expect(deployAsked({ _tag: "Merged", sha: "8c41d0e" }, undefined)).toBe(true)
    expect(deployAsked({ _tag: "Closed" }, undefined)).toBe(false)
    expect(deployAsked(undefined, undefined)).toBe(false)
  })
})

describe("deployRan", () => {
  it("hands back the answers a block can draw, and nothing for a trak with no deploy", () => {
    expect(deployRan(undefined)).toBeUndefined()
    expect(deployRan({ answer: "none" })).toBeUndefined()
    const ran = makeDeploy({ answer: "live" })
    expect(deployRan(ran)).toBe(ran)
  })
})

describe("heldOnDeploy", () => {
  it("is the wait only where the wait is the deploy's", () => {
    expect(heldOnDeploy(held)).toBe(held)
    expect(heldOnDeploy({ ...held, name: "merged" })).toBeUndefined()
    expect(heldOnDeploy({ ...held, name: "pr-merged" })).toBeUndefined()
    expect(heldOnDeploy(undefined)).toBeUndefined()
  })
})

describe("deployWords", () => {
  it("says the three answers in the tones the person chose", () => {
    expect(deployWords("live")).toEqual({ word: "Live", tone: "good" })
    // Never amber: nobody owes a waiting trak anything.
    expect(deployWords("not-yet")).toEqual({ word: "Not live yet", tone: "working" })
    // Red: a deploy that failed is the news.
    expect(deployWords("gave-up")).toEqual({ word: "Failed", tone: "bad" })
  })
})

describe("headWords", () => {
  it("is the script's answer while the wait is being asked, and Not live yet before it has run", () => {
    expect(headWords("live", false)).toEqual({ word: "Live", tone: "good" })
    expect(headWords("gave-up", false)).toEqual({ word: "Failed", tone: "bad" })
    expect(headWords(undefined, false)).toEqual({ word: "Not live yet", tone: "working" })
  })

  /** The pair the wire can carry once the sweep has dropped the wait and the page's own
   *  route has gone on asking: a stopped wait beside a deploy that has since gone live.
   *  Nothing will start the held step, so the head must not lead with a green *Live*. */
  it("says Gave up in the bad tone once the wait has stopped asking, whatever the deploy says", () => {
    expect(headWords("live", true)).toEqual({ word: "Gave up", tone: "bad" })
    expect(headWords("gave-up", true)).toEqual({ word: "Gave up", tone: "bad" })
    expect(headWords(undefined, true)).toEqual({ word: "Gave up", tone: "bad" })
  })
})

describe("shownUrl", () => {
  it("reads the address without its scheme", () => {
    expect(shownUrl("https://dashboard.render.com/web/srv-1/deploys/dep-2")).toBe(
      "dashboard.render.com/web/srv-1/deploys/dep-2",
    )
    expect(shownUrl("http://localhost:3000")).toBe("localhost:3000")
  })
})

describe("heldEntries", () => {
  it("is the held entry and everything behind it, numbered as the proposal card numbers them", () => {
    expect(heldEntries(held, plan)).toEqual([
      { mark: "3", entry: plan.steps[2] },
      { mark: "4", entry: plan.steps[3] },
    ])
  })

  it("survives a plan the detail has not got", () => {
    expect(heldEntries(held, undefined)).toEqual([])
  })
})

describe("heldHead", () => {
  it("names the relation and the condition, and nothing a step already says", () => {
    expect(heldHead(held, 2)).toEqual({ title: "Waiting on this deploy", fact: "deployed" })
  })

  it("says what a stop costs, counting what it drops", () => {
    expect(heldHead({ ...held, stopped: true }, 2).fact).toBe(
      "deployed · stopped asking · archiving drops them",
    )
    expect(heldHead({ ...held, stopped: true }, 1).fact).toBe(
      "deployed · stopped asking · archiving drops it",
    )
  })
})
