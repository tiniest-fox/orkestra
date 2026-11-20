/**
 * What the agent did at one position, turn by turn, and what it filed at the end.
 *
 * **One chronology, and each turn is a section of it.** The log runs top to bottom, each
 * turn after the first headed by the reason it ran, and each turn's document at the end of
 * that turn — which is where it happened, so it is where it is read.
 * Not above the log, and not docked to the pane's edge, which would separate it from the
 * turn that wrote it. `TurnSection` carries what a second turn changed and why.
 *
 * **One gap, 8px, between everything in this pane.** A tool row, a message, the reason a
 * turn ran, a delegation, a filed document, the effects card and the stopped notice are all
 * the same distance from their neighbour, and each keeps whatever padding it has inside its
 * own box — an element that spaces itself out here is the one spaced unlike the rest.
 * **The lists nested inside a row are the exception and stay tight** — an opened run's
 * paths and a delegation's own log are the contents of one row rather than entries in this
 * chronology, and a forty-call run spaced like the pane is three screens.
 *
 * **An element drawn into both takes a margin of its own, and `AgentMessage` is the only
 * one.** The rule above assumes each element has one container, so the container can own
 * the spacing; the bubble has two, and they disagree by design — this list gives 8px, a
 * delegation card's gives none. Nothing either container can be told fixes that, so the
 * element carries a small margin and reads as a compromise in both. **The test for a
 * second such element is whether it is drawn inside a nested list as well as here** — not
 * whether it would look better with more air, which is what the rule exists to refuse.
 *
 * **No panel and no heading.** The bar above already says which position this is, so a
 * bordered surface titled *Transcript* would be the drawer saying it a third time.
 */

import type { ComponentProps, ReactNode } from "react"
import type { AgentDto, CheckRunDto, EventDto, StepOutputDto } from "../../../api/types"
import type { Answering } from "../useAnswer"
import { runOf } from "../checks/check"
import ComposerOutputView from "./output/ComposerOutputView"
import type { PlanGate } from "../cards/plan/ProposalCard"
import { type HandOffBase, openedOn } from "../cards/plan/handOff"
import EffectsCard from "./output/EffectsCard"
import {
  composerAnswersIn,
  composerEndedIn,
  composerEnvelopesIn,
  composerFiledIn,
  effectsAt,
  endedAt,
  envelopesAt,
  filedAt,
  filedByTurn,
  settledByTurn,
  whyRan,
} from "../filed"
import QuestionsCard from "../cards/questions/QuestionsCard"
import type { MapRow } from "../family/rows"
import { spokenBelow } from "./turns"
import type { Stopping } from "../useStop"
import type { StoppingJob } from "../useStopJob"
import TurnSection from "./TurnSection"
import { turnSpends } from "../tokens/usage"
import WhyRan from "./output/WhyRan"

/** `0 … n-1`, the section numbers. */
const indices = (n: number): readonly number[] => Array.from({ length: n }, (_, i) => i)

/** Narrows a filed output to a question the step asked — `findLast`'s guard for the foot form. */
const isQuestions = (o: StepOutputDto): o is Extract<StepOutputDto, { type: "questions" }> =>
  o.type === "questions"

/**
 * The answer form at the foot, once a prose reply has taken the question card's slot: at a
 * question gate the form leaves the card the reply pushed up the transcript and stands below
 * the reply, so the thing a person acts on is the newest thing at the position.
 */
const footForm = (
  log: readonly EventDto[],
  at: number,
  proseNewest: boolean,
  answering: Answering | undefined,
): ReactNode => {
  const questions = proseNewest ? filedAt(log, at).findLast(isQuestions) : undefined
  return answering !== undefined && questions !== undefined ? (
    <QuestionsCard questions={questions} answering={answering} head="Your answers" />
  ) : undefined
}

/** The index of the last section that filed something, or `fallback` where none did. */
const newestFiled = (outputs: readonly unknown[], fallback: number): number =>
  outputs.reduce<number>((newest, filed, i) => (filed === undefined ? newest : i), fallback)

/**
 * The presses a section is handed, or the same four empty — see the comment at the call.
 *
 * `atGate` and `cancelling` are required-and-nullable rather than optional, so the empty
 * case names them: under `exactOptionalPropertyTypes` an omitted key is not an absent
 * value, and spreading `{}` would fail to type rather than draw nothing.
 */
type Presses = Pick<
  ComponentProps<typeof TurnSection>,
  "actions" | "answering" | "atGate" | "cancelling"
>
const NO_PRESSES: Presses = {
  actions: undefined,
  answering: undefined,
  atGate: undefined,
  cancelling: undefined,
}
const pressesAt = (here: boolean, presses: Presses): Presses => (here ? presses : NO_PRESSES)

const TurnsView = ({
  row,
  log,
  worktree,
  running,
  check,
  actions,
  answering,
  planning,
  failure,
  agents,
  handOffBase,
  cancelling,
  stopJob,
}: {
  /**
   * The position, as `rows.ts` computed it: its turns, its index, whether it is a step or
   * a run of the composer, and what happened at its gate.
   *
   * **One value rather than one prop per fact, and the difference is what a dropped fact
   * does.** `kind` was optional with a `"step"` default for one commit; `DrawerPane` never
   * passed it and every compose row silently drew no output, which on this surface is
   * indistinguishable from a run that produced nothing. The two gate marks were each an
   * optional prop threaded through six components, and a hop that forgot one drew no
   * band and failed no check. A fact read off the row cannot be forgotten by a caller,
   * and a fact `rows.ts` adds reaches here without a hop being edited.
   *
   * `kind` picks which question to ask the log rather than which component to draw: a
   * step's output is joined by `step`, a composer run's by its session, because
   * `ComposerReturned` carries no position at all.
   */
  readonly row: MapRow
  /** The trak's log — what a position filed and why it ran again are read off it. */
  readonly log: readonly EventDto[]
  /**
   * The checkout these turns ran in, so a path a call names is drawn relative to it.
   *
   * Passed through rather than read here: it belongs to the trak whose transcript this
   * is, and at a piece's step that is the piece rather than the parent. `TurnSection`
   * carries what is done with it. Absent before a worktree exists.
   */
  readonly worktree: string | undefined
  /**
   * Whether this position's last turn is the one something is driving right now —
   * custody held **and** this row running, both read by the caller off the trak whose
   * turns these are.
   *
   * **The only thing that lets a duration count up**, and it takes both halves. Custody
   * rather than the state, because a crashed run stays `AgentWorking` with nobody holding
   * it and a row counting up under one is a lie that never stops; the row's status as
   * well, because custody is the *trak's* and a reader scrolled back to an earlier
   * position would otherwise watch that position's dead last call count up. Only the last
   * turn of it gets this — every turn above has ended, whatever its last line looks like.
   *
   * Required rather than defaulted, for the reason `kind` is: a caller that forgot it
   * would draw a pane that silently never shows a duration, which on this surface is
   * indistinguishable from a trak nobody is driving.
   */
  readonly running: boolean
  /**
   * The newest check the daemon ran on the trak whose turns these are — its own memory,
   * not anything replayed, and the only thing that carries live output.
   *
   * Passed whole rather than narrowed by the caller, because two questions have to be
   * asked of it and only this file can ask either: whether it is *this* position's, and
   * whether it belongs to the newest document here. `check.ts` carries the second.
   *
   * Absent for every trak whose steps declare no check, which is half the agents here.
   */
  readonly check?: CheckRunDto
  /**
   * The gate's presses, for the card at the end of this position's log.
   *
   * Passed down rather than decided here: what a state offers is `controls.ts`, and a
   * hook that spends money belongs to the page. This view only knows where the slot is —
   * which is the last thing in the chronology, because that is the thing being decided
   * about.
   *
   * **One slot, offered to both ends, and only one of them can be drawn.** A position is
   * either a step or a run of the composer: `composed` is `undefined` on a step and
   * `outputs` is empty on a compose, so the press lands on whichever card exists. Deciding
   * here which of the two to hand it to would be this view holding a second opinion about
   * a question `controls.ts` has already answered from the state.
   */
  readonly actions?: ReactNode
  /**
   * The gate's form, for the card at the end of this position's log.
   *
   * Threaded exactly as `actions` is, and for the same reasons — the page reads `state`,
   * this view only knows where the slot is, and the one slot is offered to both ends
   * because a position is either a step or a run of the composer. It is a second prop
   * rather than a wider `actions` because the two are not the same kind of thing: a press
   * is a node the page can build, where a form needs the questions and only the card that
   * draws them has those.
   */
  readonly answering?: Answering
  /**
   * The plan gate, for the proposal at the end of a compose position's log — threaded as
   * `answering` is, and a third prop for the same reason: the card that draws the plan is
   * the only thing holding what its Approve sends. `undefined` on every step position.
   */
  readonly planning: PlanGate | undefined
  /**
   * Why the trak stopped, drawn after everything else because it is the newest thing that
   * happened — the same slot rule the pending `Said` row below follows.
   *
   * Built by the page, for the reason `actions` is: whether it exists is a question about
   * `state` and about who is driving, and the press inside it spends. This view only knows
   * where the slot is. `undefined` at every position but the one the trak stopped at.
   */
  readonly failure?: ReactNode
  /** The library, for each step's mark on a proposal this position returned. */
  readonly agents: readonly AgentDto[]
  /**
   * The branch a hand-off on the plan at the gate would be cut from —
   * `TrakDetailDto.handOffBase`, threaded as `agents` is. Required, `undefined` spelled
   * out: a hop that dropped it would draw a card naming no branch and fail no check.
   */
  readonly handOffBase: HandOffBase
  /**
   * The per-job stop, for a background job's card — built by the page for `actions`'
   * reason, and handed to every section rather than the newest: a job outlives the row
   * it was started on, so the card that needs the press is routinely not the last thing
   * here. `TurnSection` withholds it from every turn that is not live.
   */
  /**
   * The press that ends the check in flight, where the page offers one — the same slot
   * `actions` takes and the same section: a check runs over the newest document alone.
   * Required, `undefined` spelled out, for the row's reason.
   */
  readonly cancelling: Stopping | undefined
  readonly stopJob?: StoppingJob
}): ReactNode => {
  const { turns, at, kind, atGate } = row
  const isStep = kind === "step"
  /**
   * A message that has landed and whose turn has not started yet.
   *
   * **`whyRan` heads a turn with the reason it ran, which means it can only draw a
   * message once the turn it caused exists** — and a turn exists here when the CLI has
   * spawned and written its first transcript line. Between the `POST` landing and that
   * line there is a real gap, and what a person sees in it is their own paragraph
   * disappearing: the bar clears on success, and nothing on the surface has it.
   *
   * So the same question is asked one past the end. `whyRan` places a turn between the
   * ending before it and the ending after it, so asking it for the turn *after* the last
   * one is asking what has been recorded since the last ending — which is exactly the
   * pending cause, and `undefined` the moment the turn shows up and takes it. Nothing is
   * drawn twice and nothing is optimistic: this is the engine already having written it
   * down.
   *
   * Only `Said`. A pending `CheckFailed` has the notice below saying the same thing with
   * its output attached, and a `Restarted` is not addressed to anyone.
   */
  const composed = isStep ? undefined : composerFiledIn(log, turns.at(-1)?.session)
  /**
   * What this position sent outside the checkout, once its work was committed.
   *
   * Per position rather than per turn, and it is the one thing in this pane that is:
   * effects run downstream of the gate and the commit, so they belong to the position
   * as a whole rather than to whichever turn happened to file the document they sent.
   * Which is also why it draws below every section rather than inside one.
   */
  const sent = isStep ? effectsAt(log, at) : undefined
  /**
   * One entry per turn, each carrying whatever that turn filed.
   *
   * Longer than `turns` where the log knows about a turn the transcript does not, so no
   * document is dropped on the way to being placed — which is why this is the thing
   * mapped over rather than `turns` itself.
   */
  const outputs = isStep ? filedByTurn(log, at, turns.length) : []
  /**
   * How each turn ended, where a `TurnFailed` closed one — the fold for the two rows the
   * provider wrote, and the line that stands in their place.
   *
   * **Read per turn off the log, which is what makes it survive a restart.** It was one
   * error string handed down from the page and aimed at whichever turn was last, which
   * only held while the trak's state was still `Failed`: a restart moved the state on, the
   * string arrived `undefined`, and both the fold and the notice went with it. The log
   * still knows, and knows which turn.
   *
   * Keyed by session for a run of the composer, which has no position — the same split
   * `composerFiledIn` takes and for the same reason.
   */
  const endings = isStep
    ? endedAt(log, at, turns.length)
    : composerEndedIn(log, turns.at(-1)?.session, turns.length)
  /**
   * What each turn spent and whether a person stopped it — the same list read a fourth
   * time, keyed exactly as `endings` is, so the stamp lands on the turn that earned it.
   */
  const spends = turnSpends(log, row)
  const sections = indices(Math.max(turns.length, outputs.length, endings.length))
  const pending = isStep ? whyRan(log, at, sections.length) : undefined
  /**
   * The section a gate's press and an unresolved check belong to: the one holding the
   * newest document.
   *
   * **The last section, for every transcript the engine writes now** — outputs are
   * placed in turn order and a re-ask no longer starts a turn, so the newest is at the
   * end by construction. It differs on a file written before the `Reask` entry existed,
   * where the re-ask's spawn still reads as a turn that filed nothing: there the last
   * section is empty, and a press handed to it is drawn by nothing at all, leaving a
   * gate that cannot be answered from this surface. Following the document rather than
   * the chronology is what those traks need and what this one already does.
   *
   * Falls back to the last section where nothing was filed — a compose row, where the
   * press goes to `ComposerOutputView` below instead.
   */
  const pressAt = newestFiled(outputs, sections.length - 1)
  /**
   * How each turn's check came out, off the log — the account that outlives every restart,
   * and the only thing that can say which document the daemon's one run judged.
   */
  const settled = isStep ? settledByTurn(log, at, sections.length) : []
  /**
   * The daemon's run, where it is this position's. **Offered to the newest document
   * alone**, because a check in flight is over what a turn has just filed; whether a run
   * that has *ended* belongs to that document is a second question, and `runOf` answers it
   * off the settlement above rather than off the run.
   *
   * **Never a run the agent started.** One carrying a `call` was asked for mid-turn and
   * judged no filing — offered here it would read as the previous attempt's verdict. Its
   * own card in the transcript draws it.
   */
  const live = isStep && check?.step === at && check.call === undefined ? check : undefined
  // What the cards below this log say in the agent's own words, so the log does not say it
  // again as a row. Built from everything drawn below, which is what keeps the two in step.
  const spoken = spokenBelow([
    ...outputs.flatMap((f) => (f === undefined ? [] : [f.output])),
    ...(composed === undefined ? [] : [composed]),
  ])
  // And the JSON those same cards were filed as, which the log holds as a code block
  // above each one. Read off the log rather than found in the text: the engine reports
  // the slice it took, so what drops out here is exactly what it consumed.
  const envelopes = isStep ? envelopesAt(log, at) : composerEnvelopesIn(log, turns.at(-1)?.session)
  // Whether a prose reply is the newest thing this position filed — the case its card has
  // no slot for the gate's answer form, so `footForm` draws one at the foot below.
  const proseNewest = isStep && outputs[pressAt]?.output.type === "message"

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ol className="flex min-w-0 flex-col gap-2">
        {sections.map((i) => (
          // A turn carries no id of its own, and its session is not one either — a
          // conversation resumed at a gate runs two turns under the same session. The
          // transcript is append-only, so the position is a real identity.
          // oxlint-disable-next-line react/no-array-index-key -- append-only transcript
          <li key={i} className="flex min-w-0 flex-col gap-2">
            <TurnSection
              turn={turns[i]}
              nth={i + 1}
              why={whyRan(log, at, i)}
              spoken={spoken}
              envelopes={envelopes}
              ending={endings[i]}
              spent={spends[i]}
              // The notice below is the newest thing that happened to this trak, so what it
              // is saying is the last section's ending and never an earlier one — a turn
              // with another after it has been restarted past, which is what moved the
              // state off `Failed`. Where it exists, the line would be its headline again
              // twelve pixels up; where it does not — a failure something is already
              // driving a restart of — the line is the only thing saying what happened.
              noticed={failure !== undefined && i === sections.length - 1}
              worktree={worktree}
              filed={outputs[i]}
              // **Each attempt's own, and it is a card's second face rather than a plate
              // above it.** The evidence belongs to the document it disagrees with, so a
              // position re-entered after a failure keeps the failed run on the attempt
              // that earned it and draws the new one on the new document — where the plate
              // this replaces could only ever be about the newest.
              run={runOf(settled[i], i === pressAt ? live : undefined, worktree)}
              // Beside that same document, and a second reason: what a person is being
              // asked about is the newest thing this position filed, and every one above
              // it is an attempt it superseded.
              // **The same section, and all four for the same reason**: the newest document
              // is the one that was taken, and every one above it is an attempt it
              // superseded. `atGate` is offered to both ends exactly as `actions` is, with
              // one difference that is the point of the thing: it is not about where the
              // trak is standing now, so it draws at a position the reader scrolled back
              // to. Handed as one group because one decision places all four.
              {...pressesAt(i === pressAt, { actions, answering, atGate, cancelling })}
              // The last section only: every turn above it has ended, and an unanswered
              // call at the end of one of those is a turn that died rather than one still
              // going. `sections` counts what the log knows as well as what the transcript
              // does, so this is the last thing that happened at this position either way.
              live={running && i === sections.length - 1}
              stopJob={stopJob}
            />
          </li>
        ))}
      </ol>

      {composed === undefined ? undefined : (
        <ComposerOutputView
          output={composed}
          // The gate's three slots and its mark, as the sections above are handed theirs.
          {...{ actions, answering, planning, atGate }}
          // Keyed by session like the output above it, and joined to the ask by log order
          // rather than by `step` — a composer gate records a nominal `step: 0`, so a
          // position-keyed read would show position zero's answers here.
          answered={composerAnswersIn(log, turns.at(-1)?.session)}
          agents={agents}
          handOffBase={handOffBase}
          // Off this position's own log: the compose entry is the position the run
          // landed on, and the `HandedOff` and `GoalOpened` written for it name it.
          {...openedOn(log, row.at)}
        />
      )}

      {footForm(log, at, proseNewest, answering)}

      {/* Last, because it is the newest thing that happened: the card above is what the
          agent said and this is the answer to it. It moves up into the head of the turn
          it caused the moment that turn writes a line. */}
      {pending?._tag === "Said" ? (
        <ol className="flex min-w-0 flex-col gap-2">
          <WhyRan why={pending} />
        </ol>
      ) : undefined}

      {/* After the turns and their documents, because that is when it happened: the
          gate was taken, the work was committed, and then this ran. */}
      {sent === undefined ? undefined : <EffectsCard {...sent} />}

      {/* After even that: a message waiting for a turn that will never start is still
          older than the ending the engine wrote. */}
      {failure}
    </div>
  )
}

export default TurnsView
