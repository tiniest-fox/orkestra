/**
 * Tier 2 (`testing-tiers`): RTL, no network — the form's own decisions.
 *
 * **Three of these are about a wrong answer rather than a missing one**, which is what
 * makes them worth a render test. `AnswerQuestionsActionDto` is a bare list of strings and
 * the engine numbers it against questions it still holds in its session, so an answer in
 * the wrong slot, a short list, or a blank entry is not an error anywhere on the wire — it
 * is the agent answering confidently against the wrong question. The engine cannot catch
 * any of the three, and this is the last place that can.
 *
 * Assertions are on roles and text, because the markup is what carries them.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { QuestionDto } from "../../../../api/types"
import AnswerForm from "./AnswerForm"
import type { Answering } from "../../useAnswer"

afterEach(cleanup)

/** The two questions, named — the fields are found by them, as a person would. */
const WHICH = "Which subcommands should take the flag?"
const DEFAULT_ON = "Should it default on?"
/** The box that answers nothing, found by its own label rather than by a question. */
const NOTE = "Additional thoughts"

const OPEN_DEFAULT: QuestionDto = {
  question: DEFAULT_ON,
  context: "Existing scripts would change behaviour.",
  options: [],
}

const QUESTIONS: readonly QuestionDto[] = [
  {
    question: WHICH,
    options: [
      { label: "list only", description: "Smallest change." },
      { label: "all commands", description: "Touches every handler." },
    ],
  },
  OPEN_DEFAULT,
]

/**
 * The same two questions with a recommendation on each, so the whole round is answerable
 * on the first render — the state the pre-fill was asked for and the one it is dangerous in.
 */
const WHICH_RECOMMENDED: QuestionDto = {
  question: WHICH,
  options: [
    { label: "list only", description: "Smallest change.", recommended: true },
    { label: "all commands", description: "Touches every handler." },
  ],
}

const RECOMMENDED: readonly QuestionDto[] = [
  WHICH_RECOMMENDED,
  { question: DEFAULT_ON, options: [{ label: "no", recommended: true }, { label: "yes" }] },
]

/** One recommended, one open: the pair a naive pre-fill gets wrong. */
const ONE_RECOMMENDED: readonly QuestionDto[] = [WHICH_RECOMMENDED, OPEN_DEFAULT]

const answering = (over: Partial<Answering> = {}): Answering => ({
  send: vi.fn<Answering["send"]>(),
  isPending: false,
  disabled: false,
  said: undefined,
  ...over,
})

/** The field for one question, found the way a person finds it — by the question. */
const fieldFor = (question: string): HTMLElement => screen.getByLabelText(question)

const press = (): HTMLElement => screen.getByRole("button", { name: /answer|Send answers/ })

describe("AnswerForm", () => {
  it("sends one answer per question, in the order they were asked", () => {
    const act = answering()
    render(<AnswerForm questions={QUESTIONS} answering={act} />)

    fireEvent.change(fieldFor(WHICH), { target: { value: "list only" } })
    fireEvent.change(fieldFor(DEFAULT_ON), { target: { value: "no" } })
    fireEvent.click(press())

    expect(act.send).toHaveBeenCalledWith({ answers: ["list only", "no"] })
  })

  /**
   * The gap `nonEmpty` re-asks over in `src/ork.ts`. A short or blank list is accepted by
   * the schema — only an empty one is refused — and it lands as a numbered gap the agent
   * reads as an answer.
   */
  it("will not send while any question is unanswered, and says how many are left", () => {
    const act = answering()
    render(<AnswerForm questions={QUESTIONS} answering={act} />)

    expect(press()).toHaveProperty("disabled", true)
    expect(screen.getByRole("button", { name: "2 still to answer" })).toBeTruthy()

    fireEvent.change(fieldFor(WHICH), { target: { value: "list only" } })
    fireEvent.click(press())

    expect(act.send).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "1 still to answer" })).toBeTruthy()
  })

  /** Whitespace is a blank: it reaches the prompt as a numbered gap just the same. */
  it("counts a field of spaces as unanswered", () => {
    render(<AnswerForm questions={QUESTIONS} answering={answering()} />)

    fireEvent.change(fieldFor(WHICH), { target: { value: "   " } })

    expect(screen.getByRole("button", { name: "2 still to answer" })).toBeTruthy()
  })

  /**
   * An option is a suggestion rather than a closed choice — `system/questions-shape.md`
   * writes the contract assuming this surface adds its own escape hatch — so a press puts
   * the label in the field and leaves it editable.
   */
  it("fills the field from an option, and lets it be edited afterwards", () => {
    const act = answering()
    render(<AnswerForm questions={QUESTIONS} answering={act} />)

    fireEvent.click(screen.getByRole("button", { name: /list only/ }))
    expect(fieldFor(WHICH)).toHaveProperty("value", "list only")

    fireEvent.change(fieldFor(WHICH), {
      target: { value: "list only, behind the flag" },
    })
    fireEvent.change(fieldFor(DEFAULT_ON), { target: { value: "no" } })
    fireEvent.click(press())

    expect(act.send).toHaveBeenCalledWith({ answers: ["list only, behind the flag", "no"] })
  })

  /**
   * The note is the one field that answers nothing, so it is also the one that must never
   * hold the send back — the whole point of it is that it costs no extra turn and no extra
   * decision.
   */
  it("enables the send on the answers alone, and sends no note when the box is left alone", () => {
    const act = answering()
    render(<AnswerForm questions={QUESTIONS} answering={act} />)

    fireEvent.change(fieldFor(WHICH), { target: { value: "list only" } })
    fireEvent.change(fieldFor(DEFAULT_ON), { target: { value: "no" } })

    expect(press()).toHaveProperty("disabled", false)
    fireEvent.click(press())
    expect(act.send).toHaveBeenCalledWith({ answers: ["list only", "no"] })
  })

  it("sends the note beside the answers, never as one of them", () => {
    const act = answering()
    render(<AnswerForm questions={QUESTIONS} answering={act} />)

    fireEvent.change(fieldFor(WHICH), { target: { value: "list only" } })
    fireEvent.change(fieldFor(DEFAULT_ON), { target: { value: "no" } })
    fireEvent.change(fieldFor(NOTE), { target: { value: "we ship this on Friday" } })
    fireEvent.click(press())

    // The list is exactly as long as the questions. A note appended to it would be an
    // answer to a question that was never asked, which no layer below this can catch.
    expect(act.send).toHaveBeenCalledWith({
      answers: ["list only", "no"],
      note: "we ship this on Friday",
    })
  })

  /** Blank is absent everywhere, and the form does not put an empty heading on the wire. */
  it("sends nothing for a note of only spaces", () => {
    const act = answering()
    render(<AnswerForm questions={QUESTIONS} answering={act} />)

    fireEvent.change(fieldFor(WHICH), { target: { value: "list only" } })
    fireEvent.change(fieldFor(DEFAULT_ON), { target: { value: "no" } })
    fireEvent.change(fieldFor(NOTE), { target: { value: "   " } })
    fireEvent.click(press())

    expect(act.send).toHaveBeenCalledWith({ answers: ["list only", "no"] })
  })

  /**
   * `client-style`'s contract for an action that spends: non-submittable while something
   * holds the trak, not merely spinning. The server cannot tell a deliberate press from a
   * second drive racing the first.
   */
  it("is unpressable while something is driving the trak", () => {
    const act = answering({ disabled: true })
    render(<AnswerForm questions={QUESTIONS} answering={act} />)

    fireEvent.change(fieldFor(WHICH), { target: { value: "list only" } })
    fireEvent.change(fieldFor(DEFAULT_ON), { target: { value: "no" } })
    fireEvent.click(press())

    expect(act.send).not.toHaveBeenCalled()
  })

  /** What was typed stays, because the same press is what a reader tries next. */
  it("shows why the last send did not land, without clearing the answers", () => {
    render(
      <AnswerForm
        questions={QUESTIONS}
        answering={answering({ said: "Something is driving this trak" })}
      />,
    )

    expect(screen.getByRole("alert").textContent).toBe("Something is driving this trak")
  })
})

/** The pre-fill and the mark, which only a marked envelope produces. */
describe("AnswerForm — a recommended option", () => {
  /**
   * `system/questions-shape.md` tells an agent to mark the option it would pick. On screen
   * that is a word a reader who cannot see the star still gets, and it is on the option
   * rather than on the question — the other option of the same question carries nothing.
   */
  it("calls out the recommended option, and only that one", () => {
    render(<AnswerForm questions={ONE_RECOMMENDED} answering={answering()} />)

    expect(screen.getByRole("button", { name: /list only.*recommended/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /all commands.*recommended/ })).toBeNull()
  })

  /** The recommendation is offered as the answer, so a round of marked questions is one press. */
  it("opens holding each recommended label, with the send live before anything is typed", () => {
    const act = answering()
    render(<AnswerForm questions={RECOMMENDED} answering={act} />)

    expect(fieldFor(WHICH)).toHaveProperty("value", "list only")
    expect(fieldFor(DEFAULT_ON)).toHaveProperty("value", "no")
    expect(screen.getByRole("button", { name: /list only/ }).getAttribute("aria-pressed")).toBe(
      "true",
    )
    expect(press()).toHaveProperty("disabled", false)

    fireEvent.click(press())
    expect(act.send).toHaveBeenCalledWith({ answers: ["list only", "no"] })
  })

  /**
   * The one a seeded implementation fails: `typed` is rebuilt on every keystroke, so a
   * pre-fill held in it would be wiped from every question but the one being typed in.
   */
  it("keeps one question's pre-fill while another is typed into", () => {
    const act = answering()
    render(<AnswerForm questions={ONE_RECOMMENDED} answering={act} />)

    fireEvent.change(fieldFor(DEFAULT_ON), { target: { value: "no" } })

    expect(fieldFor(WHICH)).toHaveProperty("value", "list only")
    fireEvent.click(press())
    expect(act.send).toHaveBeenCalledWith({ answers: ["list only", "no"] })
  })

  /**
   * Cleared is not untouched: the box stays empty rather than springing back to the
   * recommendation, and the footer goes back to counting what is missing.
   */
  it("leaves a cleared pre-fill empty, and counts it as unanswered again", () => {
    render(<AnswerForm questions={RECOMMENDED} answering={answering()} />)

    fireEvent.change(fieldFor(WHICH), { target: { value: "" } })

    expect(fieldFor(WHICH)).toHaveProperty("value", "")
    expect(screen.getByRole("button", { name: "1 still to answer" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /list only/ }).getAttribute("aria-pressed")).toBe(
      "false",
    )
  })

  /**
   * The dashed edge means *the machine put this here and nobody has touched it*, and it is
   * the one thing that tells a pre-fill from an answer somebody pressed. It firms up on the
   * first act on that question — here the person pressing the recommended option itself.
   */
  it("draws a pre-filled option as unconfirmed until the person acts on it", () => {
    render(<AnswerForm questions={RECOMMENDED} answering={answering()} />)
    const option = screen.getByRole("button", { name: /list only/ })

    expect(option.className).toContain("border-dashed")
    fireEvent.click(option)
    expect(option.className).not.toContain("border-dashed")
    expect(option.getAttribute("aria-pressed")).toBe("true")
  })
})
