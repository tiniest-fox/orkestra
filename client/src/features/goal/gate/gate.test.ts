// Tier 1: what a goal gate's card is fed, and what its answer sends.

import { describe, expect, it } from "vitest"
import type { GoalEventDto } from "../../../api/types"
import { answerAction, answerTo, reportAction } from "./gate"

const QUESTIONS = [
  { question: "Rotate?", options: [{ label: "Yes", recommended: true }, { label: "No" }] },
  { question: "How far?", context: "The CLI too?", options: [] },
]

const ask = (call: string) => ({ _tag: "Escalated", call, questions: QUESTIONS }) as const

const answered = (answers: readonly [string, ...string[]], note?: string): GoalEventDto => ({
  _tag: "GoalActed",
  action: { _tag: "Answer", answers, ...(note === undefined ? {} : { note }) },
})

describe("answerTo", () => {
  it("is the first answer after the escalation, and none once a newer one is asked", () => {
    const first = ask("e1")
    const second = ask("e2")
    expect(answerTo([first, answered(["Yes", "All"]), answered(["No", "Some"])], first)).toEqual({
      answers: ["Yes", "All"],
    })
    expect(answerTo([first, second, answered(["No", "Some"])], first)).toBeUndefined()
    expect(answerTo([first, second, answered(["No", "Some"], "Soon")], second)).toEqual({
      answers: ["No", "Some"],
      note: "Soon",
    })
  })
})

describe("answerAction", () => {
  it("sends every answer, and the note apart from them", () => {
    expect(answerAction({ answers: ["Yes", "All"] })).toEqual({
      _tag: "Answer",
      answers: ["Yes", "All"],
    })
    expect(answerAction({ answers: ["Yes", "All"], note: "Soon" })).toEqual({
      _tag: "Answer",
      answers: ["Yes", "All"],
      note: "Soon",
    })
  })
})

describe("reportAction", () => {
  it("sends Done with or without a note, and Couldn't only with one", () => {
    expect(reportAction(true, "  ")).toEqual({ _tag: "Reported", done: true })
    expect(reportAction(true, " went fine ")).toEqual({
      _tag: "Reported",
      done: true,
      note: "went fine",
    })
    expect(reportAction(false, " ")).toBeUndefined()
    expect(reportAction(false, "no access")).toEqual({
      _tag: "Reported",
      done: false,
      note: "no access",
    })
  })
})
