/**
 * A turn asking you something — and, once the ask is settled, what came back.
 *
 * **One component whoever is asking.** A step's questions and the composer's are the same
 * shape on the wire — `QuestionsDto` carries nothing that says who asked — and drawn
 * separately they came out different: different numbering, different handling of
 * `context`, a different header. That was duplication rather than a decision.
 *
 * **One grid, so the answer's left edge lands on the question's.** It was a flex row for
 * the question and a padding guess for what sat under it, which put the second line eight
 * pixels inside the first — close enough to read as a mistake rather than as an indent.
 * Alignment is a property of the layout here, not a number matched by eye.
 *
 * **Two renderings, off one fact.** `answering` says an answer is owed *and* this surface is
 * where it is given, and those stopped being two questions when the drawer began acting for
 * whichever trak owns the position on screen: there is no longer anywhere an ask is live and
 * unanswerable.
 *
 *   · owed — `AnswerForm`, a field per question and a press per option
 *   · not owed — `SettledAsk`, the record of what was decided
 *
 * **There was a third, and what it was for is worth keeping.** `AskedElsewhere` drew a live
 * ask with its controls off, for a spawn's piece read from its parent's drawer: the form was
 * withheld there because it would have posted at the parent's position, and this card took
 * that absence for *nobody owes an answer* and headed a live question `Never answered`. The
 * withholding is gone rather than the lesson — **an absent form is not evidence an ask is
 * settled**, so a caller that ever withholds one again owes this card the fact separately.
 *
 * **A settled ask never draws `waiting`, nor its options as spans that cannot be
 * pressed.** `waiting` means *a human owes an action*, so a log of six settled asks would
 * claim six outstanding debts; and an option that looks pressable and is not is a broken
 * control.
 *
 * Answering spends money — it resumes the session of whoever asked and runs another turn,
 * the same cost as `pnpm ork` — which is the whole reason the offer is decided from
 * `state` in `controls.ts` and never from the fact that a questions envelope is on screen.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { ClipboardCheck, MessageCircleQuestion } from "lucide-react"
import type { QuestionDto, StepOutputDto } from "../../../../api/types"
import AnswerForm from "./AnswerForm"
import CardShell from "../CardShell"
import type { Answered } from "../../filed"
import type { Answering } from "../../useAnswer"

type Questions = Extract<StepOutputDto, { type: "questions" }>

/**
 * What the header says in place of the body while folded.
 *
 * An ask nobody answered summarises to **what was asked**, not to a count of nothing: the
 * head already says it was never answered, and repeating that spends the one line the fold
 * has on saying the same thing twice. `" · "` is the join `record.ts` already picked for a
 * step's answers, so the separator is decided rather than invented.
 */
const summarise = (questions: readonly QuestionDto[], answers: readonly string[]): string =>
  answers.length === 0
    ? questions.map((q) => q.question).join(" · ")
    : `${String(answers.length)} of ${String(questions.length)} answered · ${answers.join(" · ")}`

/**
 * An ask that is off the table, drawn as the record of what was decided.
 *
 * **The answer is the content and the question is its label.** Nobody rereads a settled
 * question; they reread the decision. So the answer takes the ink, the weight and the
 * position, and the question drops to a caption above it — not the form drawn back with
 * its fields locked, and not the reply drawn as a chat plate.
 *
 * **Nothing auto-collapses.** A settled card renders open however many are in the log —
 * roughly 1200px of drawer for a trak that asked six times, a cost taken knowingly. Folding
 * survives as a press on the header, so a card can still be put away by hand.
 *
 * **A long answer is drawn whole**, never capped at two or three lines: an answer is prose
 * a person wrote, and both cuts land before the sentence where they said what they actually
 * meant.
 *
 * `context` is not drawn at all. It is the paragraph an agent wrote to make its question
 * answerable, and it is provenance for a question nobody is being asked any more.
 */
const SettledAsk = ({
  questions,
  answers,
  note,
}: {
  readonly questions: readonly QuestionDto[]
  readonly answers: readonly string[]
  /**
   * What was sent alongside the answers, belonging to none of them — so it is drawn
   * below the numbered list with a caption of its own and **never as a row in it**.
   * A note given a number is attributed to a question it does not answer, which is
   * the one mistake this card exists not to make.
   */
  readonly note: string | undefined
}): ReactNode => {
  const [pressed, setPressed] = useState<boolean | undefined>(undefined)
  /* The state remembers a fold the reader asked for, and nothing else: the fallback is the
     constant `true` because nothing here auto-collapses. `SubagentGroup` is the same shape
     with a *derived* fallback, and there the pattern is load-bearing — a `useState(derived)`
     latches at mount and goes stale. There is nothing to derive here, so it cannot. */
  const open = pressed ?? true
  /* Every question, plus every answer past the last question. `AnswerQuestionsActionDto`
     refuses an empty list and nothing else — arity is enforced client-side by `AnswerForm`
     and `ork.ts`, so a third caller sends whatever length it likes. A short list must not
     invent an answer and a long one must not drop one. */
  const rows = Math.max(questions.length, answers.length)

  return (
    <CardShell
      icon={ClipboardCheck}
      tone="neutral"
      head={answers.length === 0 ? "Never answered" : "Answered"}
      open={open}
      onToggle={() => {
        setPressed(!open)
      }}
      summary={open ? undefined : summarise(questions, answers)}
    >
      {open ? (
        <>
          <ol className="flex min-w-0 flex-col gap-3">
            {Array.from({ length: rows }, (_, i) => {
              const asked = questions[i]
              const said = answers[i]

              return (
                /* The index is the identity: the answers are positional by definition, the
                 list is never reordered, and nothing on the wire gives a question an id. */
                // oxlint-disable-next-line react/no-array-index-key -- positional by definition
                <li
                  key={i}
                  className={`grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] ${
                    i > 0 ? "border-t border-border pt-3" : ""
                  }`}
                >
                  {/* Kept from the form, because the answers are positional and an answer
                    written in prose refers to the number. */}
                  <span className="mt-0.5 font-mono text-2xs text-fg-subtle">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    {/* No label where there is no question. An answer past the end of the
                      list is one the agent never asked for, and the alternative — captioning
                      it with the question above — attributes it to a question it does not
                      answer, which is the one mistake this card must not make. */}
                    {asked === undefined ? undefined : (
                      <span className="min-w-0 text-sm text-fg-subtle">{asked.question}</span>
                    )}
                    <span
                      className={`min-w-0 text-base leading-5 ${
                        said === undefined ? "italic text-fg-subtle" : "font-medium text-fg"
                      }`}
                    >
                      {said ?? "not answered"}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
          {/* Outside the list and past its last border, in the same two-column measure with
            the number gutter left empty — the absence of a number is what says it answers
            nothing. The caption is the form's label, so a reader recognises what they
            typed. */}
          {note === undefined ? undefined : (
            <div className="mt-3 grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] border-t border-border pt-3">
              <div className="col-start-2 flex min-w-0 flex-col gap-1">
                <span className="min-w-0 text-sm text-fg-subtle">Additional thoughts</span>
                <span className="min-w-0 text-base font-medium leading-5 text-fg">{note}</span>
              </div>
            </div>
          )}
        </>
      ) : undefined}
    </CardShell>
  )
}

const QuestionsCard = ({
  questions,
  answered,
  head,
  actions,
  answering,
}: {
  readonly questions: Questions
  /**
   * What a person sent, paired to this ask by `filed.ts` off the log. Absent is an ask
   * nobody answered — skipped, superseded, or replanned past — which is a state of its own
   * and not the same as the ask still being live.
   */
  readonly answered?: Answered
  /**
   * The header, for the ask a person is standing at — a step's and the composer's read
   * differently. The settled rendering names its own state instead, because *Answered* and
   * *Never answered* are facts about the card rather than about who filed it.
   */
  readonly head: string
  /** The gate's presses — the recompose, at the gate this parks. Built by the page. */
  readonly actions?: ReactNode
  /**
   * The gate's form, when this is the ask a person is standing at — **and the only thing
   * that says the ask is still on the table.** A caller hands it over when the trak that
   * asked is standing at the gate, so its absence and *nobody owes an answer* are the same
   * fact. See the file docstring for the shape that broke when they were not.
   */
  readonly answering?: Answering
}): ReactNode =>
  // The form first, so a surface offering one always draws it: `answering` arrives only
  // from a page that read the gate off `state`, and a card holding a second opinion about
  // that would drop the one rendering a person can act on.
  answering === undefined ? (
    <SettledAsk
      questions={questions.questions}
      answers={answered?.answers ?? []}
      note={answered?.note}
    />
  ) : (
    <CardShell icon={MessageCircleQuestion} tone="waiting" head={head} actions={actions}>
      <AnswerForm questions={questions.questions} answering={answering} />
    </CardShell>
  )

export default QuestionsCard
