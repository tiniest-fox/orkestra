import { describe, expect, it } from "vitest"
import {
  AgentWorkingDto,
  AwaitingComposerAnswersDto,
  AwaitingHumanDto,
  AwaitingProposalDto,
  FailedStateDto,
  FinishedStateDto,
} from "@orkestra/shared/dto/trak"
import { changed, noticeFor, phaseOf, type Wait } from "./notice.js"

/** Held by a condition nothing named. */
const HELD: Wait = { name: undefined, stopped: false }

const finished = FinishedStateDto.make({})

describe("which states a desktop notification is for", () => {
  it("names the three parked states as waiting on the person", () => {
    for (const state of [
      AwaitingProposalDto.make({}),
      AwaitingComposerAnswersDto.make({}),
      AwaitingHumanDto.make({ step: 2, kind: "approval" }),
    ]) {
      expect(noticeFor("t1", state, "Add a flag", undefined)).toEqual({
        trak: "t1",
        body: "Add a flag is waiting on you",
      })
    }
  })

  it("says finished and failed", () => {
    expect(noticeFor("t1", finished, "Add a flag", undefined)?.body).toBe("Add a flag finished")
    expect(
      noticeFor(
        "t1",
        FailedStateDto.make({ error: "boom", kind: "agent" }),
        "Add a flag",
        undefined,
      )?.body,
    ).toBe("Add a flag failed")
  })

  it("says nothing while the engine is working", () => {
    expect(
      noticeFor("t1", AgentWorkingDto.make({ step: 0 }), "Add a flag", undefined),
    ).toBeUndefined()
  })

  /** A step held behind a condition is not finished: the rest is silent, and the give-up
   *  is told, naming the script where the frame carried it and not where the list did. */
  it("is silent on a held trak, and says which condition gave up", () => {
    expect(noticeFor("t1", finished, "Add a flag", HELD)).toBeUndefined()
    expect(
      noticeFor("t1", finished, "Add a flag", { name: "pr-merged", stopped: false }),
    ).toBeUndefined()
    expect(
      noticeFor("t1", finished, "Add a flag", { name: "pr-merged", stopped: true })?.body,
    ).toBe("Add a flag gave up waiting on pr-merged")
    expect(noticeFor("t1", finished, "Add a flag", { name: undefined, stopped: true })?.body).toBe(
      "Add a flag gave up waiting on its condition",
    )
  })

  it("flattens the name to one line and cuts a long one with an ellipsis", () => {
    const long = `a long request\nthat runs on ${"x".repeat(80)}`
    const body = noticeFor("t1", finished, long, undefined)?.body ?? ""
    expect(body).toBe(
      `a long request that runs on ${"x".repeat(60 - "a long request that runs on ".length)}… finished`,
    )
    expect(body).not.toContain("\n")
  })

  it("counts only a change of phase as a transition", () => {
    const gate = AwaitingHumanDto.make({ step: 1, kind: "answers" })
    expect(changed(undefined, gate, undefined)).toBe(true)
    expect(changed("AgentWorking", gate, undefined)).toBe(true)
    expect(changed("AwaitingHuman", gate, undefined)).toBe(false)
    // A give-up leaves the tag at `Finished`; the phase is what makes it a transition,
    // and a held trak re-parked by a restart is the same phase twice.
    const held = phaseOf(finished, HELD)
    expect(changed(held, finished, HELD)).toBe(false)
    expect(changed(held, finished, { name: "pr-merged", stopped: true })).toBe(true)
    expect(changed(phaseOf(finished, undefined), finished, HELD)).toBe(true)
  })
})
