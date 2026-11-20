/**
 * One turn: why it ran, what it did, and what it filed at the end of it.
 *
 * **A turn's document belongs to the turn, not to the position.** Every output at a
 * position used to be drawn after every turn's log, which is right for one turn and wrong
 * for two: a conversational step that answered, was answered back, and answered again put
 * both of its messages at the bottom of the pane, stacked, with the reply to the first one
 * and a whole second turn's log above them. So the pane read *log · reply · log · the
 * thing being replied to*, and the newest thing on screen was the oldest thing that
 * happened. `filed.ts` carries how an output is paired with the turn that produced it.
 *
 * On a one-turn position nothing moves — the document is still the last thing in the pane,
 * where it is read.
 *
 * **A turn can have no transcript and still have a document.** Every file written before
 * the engine stamped positions is that shape, so `turn` is optional and its absence draws
 * the card alone rather than nothing at all.
 */

import type { ReactNode } from "react"
import type { MarkDto, TranscriptEntryDto } from "../../../api/types"
import { withoutWorktree } from "../../../format/paths"
import type { CheckRun } from "../checks/check"
import type { Ending, Filed, Why } from "../filed"
import StepOutputView from "./output/StepOutputView"
import type { Answering } from "../useAnswer"
import type { Stopping } from "../useStop"
import type { StoppingJob } from "../useStopJob"
import {
  lateFrom,
  groupEntries,
  withoutEndedPauses,
  withoutEnvelopes,
  workOnly,
} from "../../../format/transcriptRows"
import { withoutFailure, withoutSpoken, type Turn } from "./turns"
import TurnEnding from "./output/TurnEnding"
import TurnHead from "./TurnHead"
import TurnRows from "./TurnRows"
import TurnSpent from "../tokens/TurnSpent"
import type { TurnSpend } from "../tokens/usage"
import WhyRan from "./output/WhyRan"

const TurnSection = ({
  turn,
  nth,
  why,
  spoken,
  envelopes,
  ending,
  spent,
  noticed = false,
  worktree,
  filed,
  run,
  actions,
  answering,
  atGate,
  cancelling,
  stopJob,
  live = false,
}: {
  /** The transcript this turn wrote. Absent where only the log knows the turn ran. */
  readonly turn: Turn | undefined
  /** Which turn of its position this is, from 1 — what a remote turn's head line names. */
  readonly nth: number
  /** What caused it, drawn at its head. Absent on a position's first turn, deliberately. */
  readonly why: Why | undefined
  /** The words a card is already showing, so the log does not draw them a second time. */
  readonly spoken: ReadonlySet<string>
  /** The JSON the turns below wrote their documents as, so the log does not draw it raw. */
  readonly envelopes: ReadonlySet<string>
  /**
   * How this turn ended, where the engine wrote a `TurnFailed` for it — read off the log,
   * so it survives every restart past it.
   *
   * **It does two things and they are not the same one.** The provider's error arrives as
   * a bubble and a raw `ApiError(…)` row, and both are folded away by `withoutFailure`
   * matching the string this carries; and the line below stands in their place, saying
   * what happened in the notice's own words. The fold is unconditional, because those rows
   * are always the pane saying the ending twice. Whether the *line* draws is `noticed`.
   */
  readonly ending: Ending | undefined
  /**
   * What this turn spent, read off the log as `ending` is. Drawn only where a person
   * cut the turn short — `TurnSpent` carries the rule — and required with `undefined`
   * spelled out, because a hop that dropped it would draw no stamp and fail no check.
   */
  readonly spent: TurnSpend | undefined
  /**
   * Whether a notice at the foot of this position is already saying this ending in full,
   * with the press out of it — so the line above would be its headline a second time,
   * twelve pixels up.
   *
   * `TurnsView` decides it, and only ever for the last turn: a notice is about the trak's
   * *standing* condition, and a turn with another after it has been restarted past.
   */
  readonly noticed?: boolean
  /**
   * The checkout this turn ran in, taken off the front of every path a call names.
   *
   * The third thing subtracted from the entries, and the only one that is a fact about
   * the trak rather than about what is drawn below — so it comes from the trak whose
   * transcript this is, which at a piece's step is the piece's own. Absent before a
   * worktree exists, and a detail with no root to subtract is drawn whole.
   */
  readonly worktree: string | undefined
  /** What it filed. Absent while it is still running, and where it died before filing. */
  readonly filed: Filed | undefined
  /**
   * The check that judged what this turn filed, where one ran and there is anything left
   * of it. It goes into the card rather than above it — `ArtifactCard` carries why.
   */
  readonly run: CheckRun | undefined
  /**
   * The gate's presses, for what this turn filed.
   *
   * Handed only to the last section, so it never lands on a superseded attempt: a
   * position's outputs are placed in turn order, and the newest is by construction the
   * one at the end.
   */
  readonly actions?: ReactNode
  /**
   * The gate's form, for what this turn asked. Handed to the last section for the same
   * reason `actions` is: a re-asked position's newest questions are the ones being
   * answered, and a form on a superseded attempt would send answers numbered against a
   * list the agent has already replaced.
   */
  readonly answering?: Answering
  /**
   * What happened at the gate of what this turn filed.
   *
   * Handed to the same section `actions` is, and it is the same fact from both sides: a
   * position's newest document is the one that was decided about, whether a person did
   * the deciding, the engine did, or a hold held the position until they accepted it.
   *
   * **Required down to the card, `undefined` spelled out.** It is `undefined` on every
   * section but the one that was taken, so an optional prop would read naturally — and
   * for as long as it was one, a hop that stopped forwarding it drew no band and failed
   * no check. Each of the five components between the row and the band declares it
   * without a `?` for that reason, and `pnpm check` is what says the chain is whole.
   */
  readonly atGate: MarkDto | undefined
  /**
   * The press that ends the check running over what this turn filed, where the page
   * offers one. Handed to the same section `actions` is, and required down to the strip
   * with `undefined` spelled out, for `atGate`'s reason.
   */
  readonly cancelling: Stopping | undefined
  /**
   * The per-job stop, for a background job's card while this turn is the live one — the
   * same press the strip at the chat bar draws, in the place a reader is already
   * looking at that job. Withheld below wherever `live` is false: a dead turn's job is
   * not running, whatever its card lacks a report to say.
   */
  readonly stopJob?: StoppingJob
  /**
   * Whether this is the turn something is still driving — the trak's custody, asked one
   * turn at a time by `TurnsView`.
   *
   * **This is where a duration is allowed to count up, and it is the only place.** A run
   * in a turn nothing is driving is over whatever its outcomes say — a turn that died
   * mid-call leaves one unanswered forever — so *how long has this been going* is a
   * question about the live turn and nowhere else.
   */
  readonly live?: boolean
}): ReactNode => {
  // Last of the five, and over the smallest list: the four above drop entries, and this
  // one rewrites what is left. Before the grouping, so a call nested inside a delegation
  // is shortened by the same rule as one on the turn's own log.
  //
  // The sixth filter is the only one that runs *after* the grouping, because what it drops
  // depends on where a row landed rather than on what it holds: the dots mean *it is
  // thinking now*, so every pause but the live tail is a wait that is already over. It is
  // also the only one that can leave a turn with fewer rows than it has stretches of work.
  const rowsOf = (entries: readonly TranscriptEntryDto[]) =>
    withoutEndedPauses(
      groupEntries(
        withoutEnvelopes(
          withoutFailure(withoutSpoken(workOnly(entries), spoken), ending?.reason),
          envelopes,
        ).map((entry) => withoutWorktree(entry, worktree)),
      ),
      live,
    )
  // Two lists where a person spoke after the answer: what led to the document above it,
  // and the exchange that followed below — `lateFrom` carries why. One list everywhere
  // else, and always while nothing is filed, since there is no document to stand between.
  const all = turn?.entries ?? []
  const cut = filed === undefined ? all.length : lateFrom(all)
  const rows = rowsOf(all.slice(0, cut))
  const late = rowsOf(all.slice(cut))
  // At the foot of the turn's own rows, which is where it happened — inside their list
  // rather than after it, so it takes the same gap from the row above as every other row
  // does. Outside it, the section's own gap would set it apart from the turn it ends.
  const ended = ending === undefined || noticed ? undefined : <TurnEnding ending={ending} />
  // Last of all, at the foot of the turn it measures: a turn's spend is known only once
  // the turn has ended, so a figure above its first line would be a number for something
  // that had not happened yet.
  const stamp =
    spent?.cut === undefined ? undefined : <TurnSpent spend={spent.spend} cut={spent.cut} />
  return (
    <>
      {turn === undefined &&
      why === undefined &&
      ended === undefined &&
      stamp === undefined ? undefined : (
        // **`gap-2` and no exceptions**, which is the pane's one spacing: a tool row, the
        // reason a turn ran, a message and a delegation are all 8px from their neighbour,
        // and each keeps whatever padding it has inside its own box. Nothing here marks
        // where a pause was dropped either — `withoutEndedPauses` carries what that costs.
        <ol className="flex min-w-0 flex-col gap-2">
          <TurnHead turn={turn} nth={nth} />
          {why === undefined ? undefined : <WhyRan why={why} />}
          <TurnRows rows={rows} live={live} stopJob={stopJob} />
          {ended}
          {stamp}
        </ol>
      )}

      {filed === undefined ? undefined : (
        <StepOutputView
          output={filed.output}
          run={run}
          actions={actions}
          answering={answering}
          atGate={atGate}
          cancelling={cancelling}
          // Every section's own, unlike the two above it: what a person answered belongs to
          // the ask they answered, and a position that asked twice has two settled cards
          // with different answers on them. `filed.ts` did the pairing.
          answered={filed.answered}
          permitted={filed.permitted}
          head={
            filed.of === 1
              ? "Filed its work"
              : `Attempt ${String(filed.nth)} of ${String(filed.of)}`
          }
          superseded={filed.nth < filed.of}
        />
      )}

      {late.length === 0 ? undefined : (
        <ol className="flex min-w-0 flex-col gap-2">
          <TurnRows rows={late} live={live} stopJob={stopJob} />
        </ol>
      )}
    </>
  )
}

export default TurnSection
