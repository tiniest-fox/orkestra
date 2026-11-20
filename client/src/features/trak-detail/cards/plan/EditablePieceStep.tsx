/**
 * One step of one piece of a spawn at the plan gate, editable in place with a top-level
 * tile's controls in their settled look: `RunsOnControl` leading the name line, the trash
 * press ending it, the instruction as the press that opens a field, and the folded row
 * with Undo once removed.
 *
 * **A piece's last kept step draws no trash press**, and no sentence says why: a piece is
 * a trak whose plan is never empty, and a whole piece is not removed at this gate.
 */

import type { ReactNode } from "react"
import type { AgentDto } from "../../../../api/types"
import { agentGlyph } from "../../../../format/glyph"
import WaitRule from "../../waits/WaitRule"
import { Remove } from "./EditableTile"
import InstructionPress from "./InstructionPress"
import { type Cell, type CellEdit, cellModel } from "./planEdits"
import PlanStep from "./PlanStep"
import RemovedTile from "./RemovedTile"
import RunsOnControl from "./RunsOnControl"

const EditablePieceStep = ({
  cell,
  mark,
  conditions,
  agents,
  models,
  onEdit,
  onUndo,
  onAgent,
  onModel,
}: {
  readonly cell: Cell
  /** Its mark under the spawn's — `2·3.1`. */
  readonly mark: string
  /** The conditions first waited on here, for the rule above it — `cellWaits`. */
  readonly conditions: readonly string[]
  readonly agents: readonly AgentDto[]
  /** `models.yaml`'s list, which a step's model is picked from. */
  readonly models: readonly string[]
  readonly onEdit: (change: Pick<CellEdit, "instruction" | "removed">) => void
  readonly onUndo: (field: "instruction" | "removed") => void
  readonly onAgent: (agent: string) => void
  readonly onModel: (model: string, own: string | undefined) => void
}): ReactNode => {
  const { now } = cell
  const glyph = agentGlyph(agents, now.agent)
  if (cell.removed) {
    return (
      <ol className="min-w-0">
        <RemovedTile mark={mark} glyph={glyph} name={now.agent} onUndo={() => onUndo("removed")} />
      </ol>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {conditions.length > 0 ? <WaitRule names={conditions} column /> : undefined}
      <PlanStep
        mark={mark}
        glyph={glyph}
        agent={now.agent}
        instruction={now.instruction}
        edited={cell.changes > 0}
        lead={
          <RunsOnControl
            mark={mark}
            agent={now.agent}
            model={cellModel(cell, agents)}
            locked={false}
            agents={agents}
            models={models}
            onAgent={onAgent}
            onModel={onModel}
          />
        }
        end={
          cell.last ? undefined : (
            <Remove what="Remove step" onPress={() => onEdit({ removed: true })} />
          )
        }
        body={
          <InstructionPress
            mark={mark}
            text={now.instruction}
            onChange={(instruction) => onEdit({ instruction })}
            onClose={(text) => {
              if (text.trim() === "") onUndo("instruction")
            }}
          />
        }
      />
    </div>
  )
}

export default EditablePieceStep
