/**
 * What a run of the composer returned.
 *
 * **Three of its five outputs are shapes a step files too**, so they are drawn by the same
 * components: whoever is asking, a question is a question, and `QuestionsDto` carries
 * nothing that says who asked. Drawing the composer's separately is how the two drift.
 *
 * The other two are the composer's alone — the plan, and the answer that says the work is
 * already done — and only the first of them has a shape of its own.
 *
 * **The proposal is drawn**, and `ProposalCard` carries why the first answer — leave it
 * to the Map — was wrong: the Map draws the plan *as it stands*, and a re-composed trak's
 * plan matches no single proposal, so a run's card is the only place its own proposal
 * survives. A compose row that drew nothing also read as broken, which is the cheaper
 * half of the argument.
 *
 * Exhaustive with no `default`, for the reason `StepOutputView` is: a variant nobody has
 * drawn must be a compile error rather than a blank pane.
 *
 * **`planning` reaches the proposal, `actions` a finish that hands work off, and
 * `answering` the questions.** A gate belongs to what was filed, not to the run that filed it:
 * a composer that asked questions is at a different gate accepting a different action,
 * and one that failed or finished plainly is at none. A finish carrying a hand-off is the
 * one finish at a gate — the plan gate, taken as a plan with nothing to run — so it is
 * drawn as the plan it is, on `FinishedCard`, and the slot reaches it. Everywhere else the
 * slots would be drawing a control `decide` refuses. The page has already decided both
 * from `state`; these branches are where the same fact is read off what is actually on
 * screen.
 */

import type { ReactNode } from "react"
import type { AgentDto, ComposerOutputDto, MarkDto } from "../../../../api/types"
import AgentMessage from "../activity/AgentMessage"
import { FailedNotice } from "./FailedNotice"
import type { Answered } from "../../filed"
import type { HandOffBase } from "../../cards/plan/handOff"
import FinishedCard from "../../cards/plan/FinishedCard"
import ProposalCard, { type PlanGate } from "../../cards/plan/ProposalCard"
import QuestionsCard from "../../cards/questions/QuestionsCard"
import type { Answering } from "../../useAnswer"

const ComposerOutputView = ({
  output,
  actions,
  answering,
  answered,
  planning,
  atGate,
  agents,
  handOffBase,
  opened,
  goalOpened,
}: {
  readonly output: ComposerOutputDto
  /** The gate's presses, when this run is the one a person is standing at. */
  readonly actions?: ReactNode
  /**
   * What happened at this run's plan gate. Reaches the proposal branch alone, for the
   * reason `actions` does: the plan gate belongs to the plan, and a run that asked
   * questions, failed or finished reached no gate the rule may take, and approved no plan
   * for a hold to be spent on.
   */
  readonly atGate: MarkDto | undefined
  /** The gate's form, when this run is the one a person is standing at. */
  readonly answering?: Answering
  /**
   * The plan gate, when this run's proposal is the one a person is standing at. Reaches
   * the proposal alone: its Approve sends what the card holds, so the card builds the
   * press from this rather than taking `actions`, which a finish that hands work off
   * still takes.
   */
  readonly planning: PlanGate | undefined
  /**
   * What a person sent, where this run asked and somebody answered it — the answers and
   * the note alongside them. Reaches the questions branch alone, for the reason the other
   * two slots reach one branch each.
   */
  readonly answered?: Answered
  /** The library, for each proposed step's mark. Reaches the proposal branch alone. */
  readonly agents: readonly AgentDto[]
  /**
   * The branch a hand-off would be cut from while the gate is open — or the goal it goes
   * to — and the traks it was opened as once it went past. Both reach the two answers that can carry one — the
   * proposal and the finish — and are `undefined` on every run that hands nothing off.
   */
  readonly handOffBase: HandOffBase
  readonly opened: readonly string[] | undefined
  /** The goal a finish's proposal started as, once the trak finished. */
  readonly goalOpened: string | undefined
}): ReactNode => {
  switch (output.type) {
    case "proposal":
      return (
        <ProposalCard
          // Keyed by the proposal at the gate, so a new one — a chat brought it — starts
          // with no edits, and the card drawn once the gate has gone holds none either.
          key={planning === undefined ? "proposed" : String(planning.proposal)}
          proposal={output}
          planning={planning}
          atGate={atGate}
          agents={agents}
          handOffBase={handOffBase}
          opened={opened}
        />
      )
    case "questions":
      return (
        <QuestionsCard
          questions={output}
          head="The composer has questions"
          answering={answering}
          answered={answered}
        />
      )
    case "message":
      return <AgentMessage text={output.text} />
    // The composer's own sentence saying the job is already done, in the shape it says
    // everything else in. **Not a notice of its own**: nothing went wrong, so `Shell`'s
    // plate would be error ink on a trak that finished, and what this ended is drawn
    // where every ending is — the map's last row. Unless it hands work off, which makes
    // it a plan with nothing to run and puts it at the plan gate: then it is the card. So
    // does proposing a goal.
    case "finished":
      return output.handOff === undefined && output.goal === undefined ? (
        <AgentMessage text={output.reason} />
      ) : (
        <FinishedCard
          finished={output}
          actions={actions}
          atGate={atGate}
          handOffBase={handOffBase}
          opened={opened}
          goalOpened={goalOpened}
        />
      )
    case "failed":
      return <FailedNotice failed={output} />
  }
}

export default ComposerOutputView
