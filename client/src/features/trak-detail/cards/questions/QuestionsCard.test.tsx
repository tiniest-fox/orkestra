/**
 * Tier 2 (`testing-tiers`): RTL, no network — which of the card's two renderings is drawn,
 * and what each one says.
 *
 * **The failure worth a render test is a card that lies about what is owed.** A settled ask
 * drawn as the live one claims a person still has to answer it, and a never-answered one
 * drawn as answered claims somebody did. Neither is an error anywhere on the wire — each is
 * the card reading its own state wrong — so this is the only place they can be caught.
 *
 * **There was a third rendering and it is gone**, along with the case for it: a piece's ask
 * read from its parent's drawer, where the form was withheld and the card took the absence
 * for *settled*. The drawer answers a piece where it stands now, so an absent form and a
 * settled ask are one fact again — which is what the two describes below assert between
 * them, and it is why neither hands this card a *live but unanswerable* prop.
 *
 * Assertions are on roles and text, because the markup is what carries them.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { QuestionDto, StepOutputDto } from "../../../../api/types"
import QuestionsCard from "./QuestionsCard"
import type { Answering } from "../../useAnswer"

afterEach(cleanup)

const WHICH = "Which subcommands should take the flag?"
const DEFAULT_ON = "Should it default on?"

const QUESTIONS: readonly QuestionDto[] = [
  {
    question: WHICH,
    context: "Existing scripts would change behaviour.",
    options: [{ label: "list only" }, { label: "all commands" }],
  },
  { question: DEFAULT_ON, options: [] },
]

const asked = (
  questions: readonly QuestionDto[] = QUESTIONS,
): Extract<StepOutputDto, { type: "questions" }> => ({ type: "questions", questions })

/* Inert: answering is the gesture that spends money, and nothing here presses it. */
const ANSWERING: Answering = {
  send: () => undefined,
  isPending: false,
  disabled: false,
  said: undefined,
}

describe("an ask nobody is standing at", () => {
  it("says it was answered, and offers nothing to answer with", () => {
    render(
      <QuestionsCard
        questions={asked()}
        head="Has questions"
        answered={{ answers: ["list only", "no"] }}
      />,
    )

    expect(screen.getByText("Answered")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Send answers" })).toBeNull()
    expect(screen.queryByRole("textbox", { name: WHICH })).toBeNull()
  })

  it("draws each answer under the question it answers", () => {
    render(
      <QuestionsCard
        questions={asked()}
        head="Has questions"
        answered={{ answers: ["list only", "no"] }}
      />,
    )

    for (const text of [WHICH, DEFAULT_ON, "list only", "no"])
      expect(screen.getByText(text)).toBeDefined()
  })

  it("drops the options, which nothing on the wire says which of was picked", () => {
    render(
      <QuestionsCard
        questions={asked()}
        head="Has questions"
        answered={{ answers: ["list only", "no"] }}
      />,
    )

    // "list only" is on screen once — as the answer, not as an option beside it.
    expect(screen.getAllByText("list only")).toHaveLength(1)
    expect(screen.queryByText("all commands")).toBeNull()
  })

  it("does not draw the context, which is provenance for a question nobody is being asked", () => {
    render(
      <QuestionsCard
        questions={asked()}
        head="Has questions"
        answered={{ answers: ["list only", "no"] }}
      />,
    )

    expect(screen.queryByText("Existing scripts would change behaviour.")).toBeNull()
  })

  it("reads as never answered where nothing came back, without claiming an answer exists", () => {
    render(<QuestionsCard questions={asked()} head="Has questions" />)

    expect(screen.getByText("Never answered")).toBeDefined()
    expect(screen.queryByText("Answered")).toBeNull()
    expect(screen.getAllByText("not answered")).toHaveLength(2)
    // The questions are still readable — what goes away is the claim that one is owed.
    expect(screen.getByText(WHICH)).toBeDefined()
  })

  it("opens every time, and folds only when the header is pressed", () => {
    render(
      <QuestionsCard
        questions={asked()}
        head="Has questions"
        answered={{ answers: ["list only", "no"] }}
      />,
    )

    const header = screen.getByRole("button", { name: /Answered/ })
    expect(header.getAttribute("aria-expanded")).toBe("true")

    fireEvent.click(header)
    expect(screen.queryByText(WHICH)).toBeNull()
    // The fold summarises to the answers, not to a count on its own.
    expect(screen.getByText("2 of 2 answered · list only · no")).toBeDefined()
  })
})

/**
 * The arity `AnswerQuestionsActionDto` permits: it refuses an empty list and nothing else,
 * and the two client surfaces that enforce a per-question answer are not the only callers.
 * A short list must invent nothing and a long one must drop nothing.
 */
describe("an answer list that is not the question count", () => {
  it("marks the unanswered question rather than borrowing the answer above it", () => {
    render(
      <QuestionsCard
        questions={asked()}
        head="Has questions"
        answered={{ answers: ["list only"] }}
      />,
    )

    expect(screen.getByText("list only")).toBeDefined()
    expect(screen.getAllByText("not answered")).toHaveLength(1)
  })

  it("draws an answer past the end of the questions rather than dropping it", () => {
    render(
      <QuestionsCard
        questions={asked([{ question: WHICH, options: [] }])}
        head="Has questions"
        answered={{ answers: ["list only", "and behind the flag"] }}
      />,
    )

    expect(screen.getByText("and behind the flag")).toBeDefined()
  })
})

/**
 * The note is the one thing here that answers nothing, and the failure is the card's
 * worst one wearing a new hat: drawn as a row it is captioned by a question it does not
 * answer, and folded into the answers it becomes an answer somebody did not give.
 */
describe("the note a person sent alongside", () => {
  const withNote = { answers: ["list only", "no"], note: "we ship this on Friday" }

  it("draws it under a caption of its own, attributed to nothing that was asked", () => {
    render(<QuestionsCard questions={asked()} head="Has questions" answered={withNote} />)

    expect(screen.getByText("we ship this on Friday")).toBeDefined()
    expect(screen.getByText("Additional thoughts")).toBeDefined()
    // Still exactly two numbered rows: the note is beside the list, not in it.
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
  })

  it("draws nothing at all where nobody sent one", () => {
    render(
      <QuestionsCard
        questions={asked()}
        head="Has questions"
        answered={{ answers: ["list only", "no"] }}
      />,
    )

    expect(screen.queryByText("Additional thoughts")).toBeNull()
  })

  /** The join is the answers, in order. A note inside it reads as the last answer. */
  it("keeps it out of the fold's summary of what was answered", () => {
    render(<QuestionsCard questions={asked()} head="Has questions" answered={withNote} />)

    fireEvent.click(screen.getByRole("button", { name: /Answered/ }))
    expect(screen.getByText("2 of 2 answered · list only · no")).toBeDefined()
  })
})

describe("the ask a person is standing at", () => {
  it("draws the form, and is not foldable", () => {
    render(<QuestionsCard questions={asked()} head="Has questions" answering={ANSWERING} />)

    expect(screen.getByRole("textbox", { name: WHICH })).toBeDefined()
    // Nothing folds a gate you are standing at — the header is text, not a press.
    expect(screen.queryByRole("button", { name: /Has questions/ })).toBeNull()
  })

  it("keeps its caller's header, so the composer's ask still names the composer", () => {
    render(
      <QuestionsCard questions={asked()} head="The composer has questions" answering={ANSWERING} />,
    )

    expect(screen.getByText("The composer has questions")).toBeDefined()
  })
})
