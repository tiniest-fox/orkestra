/**
 * The questions, with somewhere to answer them.
 *
 * **One field per question, in the order they were asked, because the answers are
 * positional.** `AnswerQuestionsActionDto` carries a bare list of strings and
 * `composer-answers.md` numbers it against the questions the agent still holds in its
 * session — nothing on the wire joins an answer to a question but its place in the list.
 * So a single box for a two-question ask would send one answer and silently misattribute
 * it, which is a wrong answer rather than a missing one.
 *
 * **Every field must be filled, for the reason `nonEmpty` re-asks in `src/ork.ts`:** a
 * blank arrives as a numbered gap in the prompt. The schema refuses an empty *list* and
 * nothing else, so this is the only place it can be caught before it is spent.
 *
 * **The note is the exception, and it never blocks the send.** It answers no question, so
 * it is one box at the foot rather than another numbered field, and leaving it alone is
 * the ordinary case — `ready` does not read it at all. An empty one is dropped here as
 * well as in `actFromDto`, which is belt and braces on purpose: the mapping is what makes
 * the rule true of every caller, and this is what keeps a wire body that says nothing off
 * the network.
 *
 * **An option fills the field rather than being the answer.** The engine takes free prose
 * either way and `system/questions-shape.md` writes the contract assuming this surface adds
 * its own escape hatch — *in the envelope a question reaches them as options to pick, in
 * prose as text to retype* — so a press drops the label in and leaves it editable. Picking
 * *list only* and then making it *list only, behind the flag* is one gesture, and a
 * question with no options is the same form with the presses absent.
 *
 * **A recommended option opens in the field, and the pre-fill is resolved per index at
 * read time** — `typed[i] ?? recommendedLabel(q) ?? ""` — never seeded into `typed`. Seeded,
 * the first keystroke in any question would rebuild the list and wipe the pre-fill from
 * every other one; resolved, an untouched slot stays `undefined` and only an edit produces
 * `""`. That `undefined` is also the only *touched* flag the card has: the dashed edge on
 * a pre-filled option reads off it, so `write` must leave the slots it did not write alone.
 *
 * **The submit is at the foot rather than in `CardShell`'s `actions` slot**, which is the
 * one place this departs from *a gate's presses go in the header*. That rule is about a
 * press that takes what is already on the table; this one commits fields below it, and a
 * header button reads as disabled for reasons the reader has not scrolled to yet. It says
 * what is missing instead of going quietly grey.
 *
 * The read-only rendering is still `QuestionsCard`'s, and the two are deliberately two
 * renderings rather than one with everything switched off: a disabled form at a position
 * nobody is being asked about is exactly the control-that-looks-pressable that card refuses
 * to draw.
 */

import type { FormEvent, ReactNode } from "react"
import { Fragment, useState } from "react"
import { Send, Star } from "lucide-react"
import type { QuestionDto } from "../../../../api/types"
import Button from "../../../../components/Button"
import Field from "../../../../components/Field"
import Markdown from "../../../../components/Markdown"
import { plainText } from "../../../../format/markdown"
import type { Answering } from "../../useAnswer"

/** The recommended option's label, when the question marks one. */
const recommendedLabel = (question: QuestionDto | undefined): string | undefined =>
  question?.options.find((o) => o.recommended === true)?.label

/**
 * How the edge reads. The accent means one thing — *the box holds this label* — and
 * `pencilled` is a grade of it rather than a second meaning: the machine put it there and
 * nobody has touched this question yet. It firms up to the solid edge on the first press
 * or keystroke. Whole literal class names, because Tailwind finds them by scanning text.
 */
const edge = (chosen: boolean, pencilled: boolean): string =>
  pencilled
    ? "border-dashed border-accent bg-surface"
    : chosen
      ? "border-accent bg-surface"
      : "border-border bg-surface hover:border-accent/60"

/**
 * One suggestion. **A quiet button's treatment picked rather than a fill invented**: at
 * rest and on hover it is `Button`'s `quiet` exactly, and chosen is the accent on the edge
 * and the label. The system already says a selected thing is marked with the accent; what
 * it has no name for is a plate this list would have had to grow.
 *
 * **The recommendation is a star pinned to the corner, in every state.** It is a fact about
 * the option rather than about the answer, so it stays whether the option is chosen,
 * passed over or the box was cleared — and it is pinned rather than laid out so every
 * label still starts on the same left edge, which is the column a reader scans. Drawn in
 * `source-machine` rather than the accent: the accent is already on this card meaning
 * *chosen*, and the mark has to be legible beside it on a different option.
 */
const OptionPress = ({
  option,
  chosen,
  touched,
  disabled,
  onPick,
}: {
  readonly option: QuestionDto["options"][number]
  readonly chosen: boolean
  readonly touched: boolean
  readonly disabled: boolean
  readonly onPick: () => void
}): ReactNode => {
  const recommended = option.recommended === true
  return (
    <button
      type="button"
      aria-pressed={chosen}
      disabled={disabled}
      onClick={onPick}
      // `max-sm:min-h-11` is `Button`'s touch floor, carried by hand: this is the one
      // acting control on a gate drawn as a raw `<button>` rather than through `Button`,
      // so nothing gives it the floor for free. Measured by `e2e/phone.spec.ts`.
      className={`relative mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-control border py-1.5 pl-2.5 text-left transition-colors max-sm:min-h-11 disabled:cursor-not-allowed disabled:opacity-45 ${
        recommended ? "pr-8" : "pr-2.5"
      } ${edge(chosen, recommended && chosen && !touched)}`}
    >
      <span className={`shrink-0 text-base font-medium ${chosen ? "text-accent" : "text-fg"}`}>
        {option.label}
      </span>
      {/* **Drawn whole, wrapping onto its own line where it does not fit beside the label.**
        It truncated to one line, and what a description says is what picking that option
        costs — so the cut landed mid-sentence on exactly the options that needed reading,
        and a reader choosing between them had the same first four words twice. `flex-wrap`
        rather than a stack, because a short one belongs beside its label and a flex item
        moves whole: the long one takes the row below and the full width with it.

        Still flattened rather than rendered. That is about where it sits — a button holds
        an inline label, and a list or a fenced block inside a control is not a thing this
        surface can draw — not about how many lines it has. */}
      {option.description === undefined ? undefined : (
        <span className="min-w-0 text-sm text-fg-muted">{plainText(option.description)}</span>
      )}
      {recommended ? (
        <span className="absolute right-2.5 top-2 flex items-center text-source-machine">
          <Star size={12} aria-hidden />
          {/* The glyph is the only thing on this surface saying it, so a reader who cannot
              see it gets the word — the same shape as `TrakMap`'s mark. */}
          <span className="sr-only">recommended</span>
        </span>
      ) : undefined}
    </button>
  )
}

/**
 * One question, its options and the field it is answered in.
 *
 * Lifted out whole rather than split further: the number in the gutter, the option
 * presses and the field are one row of a grid the parent declares, so anything that
 * moved half of them would move the alignment this card is built on.
 */
const Asked = ({
  question,
  at,
  value,
  touched,
  disabled,
  onWrite,
}: {
  readonly question: QuestionDto
  readonly at: number
  readonly value: string
  /** Whether anything has been written into this question's box, a press included. */
  readonly touched: boolean
  readonly disabled: boolean
  readonly onWrite: (value: string) => void
}): ReactNode => (
  <li className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)]">
    <span className="mt-0.5 font-mono text-2xs text-fg-subtle">
      {String(at + 1).padStart(2, "0")}
    </span>
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-base font-medium leading-5 text-fg">{question.question}</span>
      {question.context === undefined ? undefined : (
        <div className="min-w-0 text-fg-subtle">
          <Markdown>{question.context}</Markdown>
        </div>
      )}
    </div>

    {question.options.map((option, j) => (
      <Fragment key={option.label}>
        {/* The same gutter letter the read-only card draws, and it stays for the
            same reason: an answer written in prose refers to it. */}
        <span className="pt-2.5 font-mono text-2xs text-fg-subtle">
          {String.fromCharCode(97 + j)}
        </span>
        <OptionPress
          option={option}
          chosen={value.trim() === option.label}
          touched={touched}
          disabled={disabled}
          onPick={() => {
            onWrite(option.label)
          }}
        />
      </Fragment>
    ))}

    <div className="col-start-2 mt-2 min-w-0">
      <Field
        id={`answer-${String(at)}`}
        label={question.question}
        value={value}
        onChange={onWrite}
        rows={1}
        disabled={disabled}
        placeholder={question.options.length > 0 ? "Answer, or pick one above" : "Answer"}
      />
    </div>
  </li>
)

const AnswerForm = ({
  questions,
  answering,
}: {
  readonly questions: readonly QuestionDto[]
  readonly answering: Answering
}): ReactNode => {
  /* Sparse on purpose: `undefined` is untouched, `""` is cleared, and the pre-fill below
     tells them apart. */
  const [typed, setTyped] = useState<readonly (string | undefined)[]>([])
  const [note, setNote] = useState("")

  /* Derived from `questions` rather than read straight out of state, so the two cannot
     disagree about how many answers there are when a poll lands a longer list. */
  const valueAt = (i: number): string => typed[i] ?? recommendedLabel(questions[i]) ?? ""
  const answers = questions.map((_, i) => valueAt(i).trim())
  const [first, ...rest] = answers
  const missing = answers.filter((given) => given === "").length
  /* `ready` narrows `first` to a `string`, which is what makes the non-empty tuple below
     type without an assertion — the check that enables the button and the check that
     produces the tuple are one check, made once. */
  const ready = !answering.disabled && missing === 0 && first !== undefined

  const write = (at: number, value: string): void => {
    setTyped((previous) => questions.map((_, j) => (j === at ? value : previous[j])))
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!ready) return
    const said = note.trim()
    answering.send({ answers: [first, ...rest], ...(said === "" ? {} : { note: said }) })
  }

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
      <ol className="flex min-w-0 flex-col gap-4">
        {questions.map((q, i) => (
          <Asked
            /* The index is the identity: the answers are positional by definition, the
               list is never reordered, and nothing on the wire gives a question an id. */
            // oxlint-disable-next-line react/no-array-index-key -- positional by definition
            key={i}
            question={q}
            at={i}
            value={valueAt(i)}
            touched={typed[i] !== undefined}
            disabled={answering.disabled}
            onWrite={(value) => {
              write(i, value)
            }}
          />
        ))}
      </ol>

      {/* The same two columns the questions use, with the gutter left empty — which is
          what says this belongs to no question while still landing on their left edge.
          A box the full width of the card would read as a field bolted underneath. */}
      <div className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)]">
        <div className="col-start-2 flex min-w-0 flex-col gap-1">
          <label htmlFor="answer-note" className="text-sm text-fg-subtle">
            Additional thoughts
          </label>
          <Field
            id="answer-note"
            label="Additional thoughts"
            value={note}
            onChange={setNote}
            rows={1}
            disabled={answering.disabled}
            placeholder="Optional — anything framing these answers"
          />
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-end gap-2">
        {/* The refusal the last press earned, beside the button rather than over the form:
            what was typed is still there, and a person who reads why it did not land
            presses the same button again. */}
        {answering.said === undefined ? undefined : (
          <span role="alert" className="min-w-0 truncate text-sm text-tone-bad">
            {answering.said}
          </span>
        )}
        <Button type="submit" size="sm" icon={Send} busy={answering.isPending} disabled={!ready}>
          {missing > 0 ? `${String(missing)} still to answer` : "Send answers"}
        </Button>
      </div>
    </form>
  )
}

export default AnswerForm
