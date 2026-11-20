import { describe, expect, it } from "vitest"
import type { TranscriptEntryDto } from "../../../../api/types"
import {
  makeAgentReturned,
  makeBackground,
  makeBackgroundStarted,
  makeSpawned,
  makeTool,
} from "../../../../fixtures"
import { outstandingJobs, outstandingNow } from "./outstanding"
import type { Turn } from "../turns"

const turn = (...entries: TranscriptEntryDto[]): Turn => ({ session: "s-1", at: 1, entries })

describe("outstandingJobs", () => {
  it("answers from the newest level alone — REPLACE semantics, empty included", () => {
    const one = turn(
      makeBackground({ tasks: [{ id: "b1" }, { id: "b2" }], at: 10 }),
      makeBackground({ tasks: [{ id: "b2" }], at: 20 }),
    )
    expect(outstandingJobs(one).map((j) => j.taskId)).toEqual(["b2"])
    expect(outstandingJobs(turn(...one.entries, makeBackground({ tasks: [], at: 30 })))).toEqual([])
  })

  it("answers nothing at all for a turn that never held a level, and for no turn", () => {
    expect(outstandingJobs(turn(makeTool()))).toEqual([])
    expect(outstandingJobs(undefined)).toEqual([])
  })

  it("joins the description and the start off the entries that carry them", () => {
    const one = turn(
      makeBackgroundStarted({ taskId: "b1", call: "c1", description: "sleep 300", at: 5 }),
      makeBackground({ tasks: [{ id: "b1" }], at: 6 }),
    )
    expect(outstandingJobs(one)).toEqual([{ taskId: "b1", description: "sleep 300", since: 5 }])
  })

  it("prefers the level's own description, and stamps a task the join never named", () => {
    const one = turn(
      makeBackground({ tasks: [{ id: "b1", description: "the level's words" }], at: 7 }),
    )
    expect(outstandingJobs(one)).toEqual([
      { taskId: "b1", description: "the level's words", since: 7 },
    ])
  })

  it("keeps a job's first stamp across levels, so the clock never restarts", () => {
    const one = turn(
      makeBackground({ tasks: [{ id: "b1" }], at: 10 }),
      makeBackground({ tasks: [{ id: "b1" }, { id: "b2" }], at: 50 }),
    )
    expect(outstandingJobs(one).map((j) => j.since)).toEqual([10, 50])
  })
})

describe("outstandingNow — the turn in flight, and no other", () => {
  // The review's probe: a turn killed with work outstanding leaves a level nothing
  // later on the wire supersedes, and the turn after it backgrounds nothing.
  const killedThenResumed = [
    makeSpawned({ at: 1 }),
    makeBackground({ tasks: [{ id: "dead-1" }], at: 2 }),
    makeSpawned({ at: 100 }),
    makeTool({ at: 101 }),
  ]

  it("reads the newest turn, so a dead turn's level is not the live list", () => {
    expect(outstandingNow(killedThenResumed, [], true)).toEqual([])
  })

  it("still reads a level the newest turn wrote itself", () => {
    const resumedIntoWork = [
      ...killedThenResumed,
      makeBackground({ tasks: [{ id: "live-1" }], at: 102 }),
    ]
    expect(outstandingNow(resumedIntoWork, [], true).map((j) => j.taskId)).toEqual(["live-1"])
  })

  it("answers nothing where nobody is driving, whatever the last level says", () => {
    const stopped = [makeSpawned({ at: 1 }), makeBackground({ tasks: [{ id: "dead-1" }], at: 2 })]
    expect(outstandingNow(stopped, [makeAgentReturned({ step: 1 })], false)).toEqual([])
  })
})
