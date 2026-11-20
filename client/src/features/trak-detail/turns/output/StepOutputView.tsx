/**
 * What a step filed, whichever of the five things it was.
 *
 * **An exhaustive switch over the wire union, with no `default`.** `client-style`'s
 * regression checklist asks for this on every projection over a wire union, and the cost
 * of getting it wrong is specific here: a sixth output variant added to the engine would
 * otherwise render as *nothing at all*, which on this surface is indistinguishable from a
 * step that has not run. A pane silently missing the one thing it exists to show is the
 * failure mode this file is shaped to prevent, so the switch is total and a new variant
 * is a `tsc` failure in the client until somebody draws it.
 *
 * The five are not variations on each other: a document, a document with the Approve taken away, a
 * form, prose, and a failure that is not a document at all.
 *
 * **`actions` reaches the artifact card alone, and never the prose**: the page welds
 * Approve and Recompose into a document card only while that document is the newest thing
 * at the position, and once a prose reply takes the newest slot the presses move beside the
 * chat bar — as do every other gate's, none of which has a document card to carry them. So
 * the questions and stuck cards draw with no header press, the slot never carries an
 * approval to a card that filed nothing, and it is `undefined` on the prose card because the
 * page built nothing for it. `atGate` and `run` are the two that reach the artifact alone,
 * each for its own reason.
 *
 * **`answering` is the same rule with the branches swapped**, and it is the one place the
 * two slots are not mirror images: `decide` routes an `AnswerQuestions` at any of the five
 * kinds without a gate check, so this one does not end a trak drawn too wide — it hands the
 * agent a numbered list of answers to questions it never asked. `workAwaitsAnswers` is what
 * keeps it to the gate that has them on the table.
 */

import type { ReactNode } from "react"
import type { MarkDto, StepOutputDto } from "../../../../api/types"
import AgentMessage from "../activity/AgentMessage"
import ArtifactCard from "../../cards/gate/ArtifactCard"
import type { CheckRun } from "../../checks/check"
import type { Stopping } from "../../useStop"
import { FailedNotice } from "./FailedNotice"
import type { Answered } from "../../filed"
import QuestionsCard from "../../cards/questions/QuestionsCard"
import PermissionCard from "../../cards/PermissionCard"
import StuckCard from "../../cards/StuckCard"
import type { Answering } from "../../useAnswer"

const StepOutputView = ({
  output,
  head,
  actions,
  answering,
  answered,
  permitted,
  atGate,
  superseded = false,
  run,
  cancelling,
}: {
  readonly output: StepOutputDto
  /** What the header says, so a superseded attempt can name itself. */
  readonly head: string
  /** The gate's presses, when this is what a person is standing at. */
  readonly actions?: ReactNode
  /**
   * What happened at this document's gate.
   *
   * **Reaches the artifact and nothing else**, for the reason `actions` does: the gate the
   * rule takes is the approval gate, and the other four outputs are the kinds `decide`
   * parks at whatever the mode. A band on one of those would claim a gate that never
   * happened.
   */
  readonly atGate: MarkDto | undefined
  /** The gate's form, when this is what a person is standing at. */
  readonly answering?: Answering
  /**
   * What a person sent, where this turn asked and somebody answered it — the answers
   * and the note alongside them, as one value.
   *
   * **Reaches the questions branch and nothing else**, for the reason `actions` reaches
   * only the artifact: it belongs to what was filed. It is what a settled ask draws, where
   * `answering` is what says the ask is still on the table — so the two are never both
   * meaningful.
   */
  readonly answered?: Answered
  /**
   * Whether a person allowed the command, where this turn asked to run one and somebody
   * answered. Reaches the permission branch and nothing else, for `answered`'s reason.
   */
  readonly permitted?: boolean
  readonly superseded?: boolean
  /**
   * The check that judged this, where one ran.
   *
   * **Reaches the artifact and nothing else**, and here that is a fact about the engine
   * rather than a rule this file is keeping: `decide` issues `RunChecks` from its
   * `artifact` arm alone, so a step that asked, gave up or only replied has never had a
   * check run over it. A strip on one of those would be drawing a run that cannot exist.
   */
  readonly run?: CheckRun
  /**
   * The press that ends the check in flight, where the page offers one. Reaches the
   * artifact and nothing else, for `run`'s reason, and is required down to the strip with
   * `undefined` spelled out, for `atGate`'s.
   */
  readonly cancelling: Stopping | undefined
}): ReactNode => {
  switch (output.type) {
    case "artifact":
      return (
        <ArtifactCard
          document={{ sections: output.sections }}
          // **This envelope's requirements, never the trak's.** `TrakDetailDto.decisions`
          // is the accumulated channel — every step's, each stamped with the stage that
          // filed it — and the pane used to hand the whole of it down to every card, so
          // a step read as having settled what the steps before *and after* it settled.
          // The envelope carries its own list, which is the answer to *what did this
          // step settle*; the accumulated one is the trak pane's and stays there.
          //
          // A superseded attempt is drawn without them, as it was before this became a
          // per-envelope list: what a position settled is what its newest document says.
          requirements={superseded ? [] : (output.requirements ?? [])}
          corrections={output.corrections}
          uncovered={output.uncovered_work}
          head={head}
          actions={actions}
          atGate={atGate}
          superseded={superseded}
          run={run}
          cancelling={cancelling}
        />
      )
    case "stuck":
      // The engine files it as an ordinary document *as well* — its three fields are its
      // sections. This is the shape the agent was held to, and it is the one worth
      // drawing.
      return <StuckCard stuck={output} head="Could not do the work" actions={actions} />
    case "permission":
      return <PermissionCard permission={output} actions={actions} permitted={permitted} />
    case "questions":
      return (
        <QuestionsCard
          questions={output}
          head="Has questions"
          actions={actions}
          answering={answering}
          answered={answered}
        />
      )
    case "message":
      return <AgentMessage text={output.text} />
    case "failed":
      return <FailedNotice failed={output} />
  }
}

export default StepOutputView
