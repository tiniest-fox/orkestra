// Tier 1: how the goal's log and its composer's transcript become one thread.

import { describe, expect, it } from "vitest"
import type { GoalEventDto, TranscriptEntryDto } from "../../api/types"
import { makeGoal } from "../../fixtures"
import { asksNow, planChange, threadOf, type GateMoveDto } from "./thread"
import { lineWords } from "./words"

const opened: GoalEventDto = {
  _tag: "TrakOpened",
  at: 20,
  call: "toolu_1",
  trak: "t1",
  title: "Index the logs",
  mode: "auto",
}
const call = (id: string, at: number): TranscriptEntryDto => ({
  _tag: "Tool",
  name: "mcp_tool_call",
  kind: "Mcp",
  detail: "orkestra-goal/open_trak",
  call: id,
  at,
})
const read = (at: number): TranscriptEntryDto => ({
  _tag: "Tool",
  name: "Read",
  kind: "Read",
  detail: "src/a.ts",
  at,
})

describe("threadOf", () => {
  it("draws a call the goal recorded as its move, splitting the work around it", () => {
    const thread = threadOf([opened], [read(10), call("toolu_1", 21), read(30)])
    expect(thread.map((i) => i._tag)).toEqual(["Work", "Move", "Work"])
    const move = thread[1]
    expect(move?._tag === "Move" && move.call?.detail).toBe("orkestra-goal/open_trak")
  })

  it("leaves a call the engine refused as an ordinary call in its run", () => {
    // No event carries this id: the open was refused, so nothing was recorded for it.
    const thread = threadOf([], [read(10), call("toolu_9", 11)])
    expect(thread).toEqual([{ _tag: "Work", entries: [read(10), call("toolu_9", 11)] }])
  })

  it("places the goal's own lines by when they happened", () => {
    const woke: GoalEventDto = { _tag: "TrakWoke", at: 15, trak: "t1", kind: "landed" }
    const thread = threadOf([woke], [read(10), read(20)])
    expect(thread.map((i) => i._tag)).toEqual(["Work", "Line", "Work"])
  })

  it("draws a move no transcript line answers where its log line falls", () => {
    const thread = threadOf([opened], [read(10), read(30)])
    expect(thread.map((i) => i._tag)).toEqual(["Work", "Move", "Work"])
    const move = thread[1]
    expect(move?._tag === "Move" && move.call).toBeUndefined()
  })

  it("draws nothing for a turn's ending", () => {
    expect(threadOf([{ _tag: "GoalTurnEnded", at: 5 }], [])).toEqual([])
  })
})

describe("planChange", () => {
  it("names what a replan added and dropped against the plan before it", () => {
    const plan: GoalEventDto = {
      _tag: "PlanProposed",
      call: "c1",
      traks: [
        { title: "A", description: "a", mode: "auto" },
        { title: "B", description: "b", mode: "smart" },
      ],
    }
    const replan = {
      _tag: "Replanned",
      call: "c2",
      why: "B is covered",
      traks: [
        { title: "A", description: "a", mode: "auto" },
        { title: "C", description: "c", mode: "auto" },
      ],
    } as const
    const change = planChange([plan, replan], replan)
    expect(change.added.map((t) => t.title)).toEqual(["C"])
    expect(change.dropped.map((t) => t.title)).toEqual(["B"])
  })
})

const ask = (n: string): GateMoveDto => ({
  _tag: "Escalated",
  call: n,
  questions: [{ question: "Drop the test?", options: [{ label: "Yes" }] }],
})

describe("asksNow", () => {
  it("is the newest escalation, and only at the escalation gate", () => {
    const first = ask("c1")
    const second = ask("c2")
    const at = { state: { _tag: "AtGate", gate: "escalation" } } as const
    expect(asksNow(at, [first, second], second)).toBe(true)
    expect(asksNow(at, [first, second], first)).toBe(false)
    expect(asksNow({ state: { _tag: "Watching" } }, [first, second], second)).toBe(false)
  })
})

describe("lineWords", () => {
  const shot = {
    name: "shot.png",
    type: "image/png",
    size: 10,
    path: ".orkestra/.attachments/0a1b2c3d-shot.png",
  }

  it("reads a chat's files off its action, and an opening sentence's off the event", () => {
    const chat: GoalEventDto = {
      _tag: "GoalActed",
      at: 1,
      action: { _tag: "Chat", message: "look", attachments: [shot] },
    }
    const asked: GoalEventDto = { _tag: "GoalAsked", at: 0, asked: "fix it", attachments: [shot] }
    expect(lineWords(chat, makeGoal(), [])).toEqual({
      _tag: "Said",
      text: "look",
      attachments: [shot],
    })
    expect(lineWords(asked, makeGoal(), [])).toEqual({
      _tag: "Said",
      text: "fix it",
      attachments: [shot],
    })
  })
})
