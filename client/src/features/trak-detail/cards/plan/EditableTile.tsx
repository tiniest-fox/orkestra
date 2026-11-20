/**
 * One entry of a proposed plan at its gate, editable in place: the rules above it, then
 * the tile — or the folded row a removed tile leaves.
 *
 * The rules it holds to:
 *
 * - **No edit mode.** Every top-level tile is live the whole time the gate is open.
 * - **The instruction is the press.** Tapping it opens a field in place, which closes
 *   when focus leaves; no pencil is drawn. Emptied, it goes back to what was proposed —
 *   the engine refuses a blank step, and nobody meant one.
 * - **Remove is a trash press at the end of the name line**, and a removed tile folds to
 *   one dashed row with its number, its struck name and Undo, so nothing below it moves.
 * - **A clock is removed at its rule's end**, and stays drawn struck, with Undo.
 * - **A condition's rule is read-only where its names are all the agent file's.** A
 *   step's own `waitFor` is the plan's, and the one remove takes it with the clock: the
 *   press sits on the clock's rule where there is one and on the condition's otherwise,
 *   and a removed `waitFor` stays drawn struck on that rule — live instead where the
 *   agent file declares the same name, since the agent still waits on it. `tileWaits`.
 * - **An agent step's agent and model are pickers on the name line**, where its name is —
 *   `RunsOnControl`, handed in as `lead`. A spawn or a re-compose keeps its plain name.
 *
 * A spawn's pieces are edited too, each step with the same controls, and are handed in as
 * `pieces` — `EditablePieces`.
 */

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Trash2 } from "lucide-react"
import Button from "../../../../components/Button"
import ClockRule from "../../waits/ClockRule"
import WaitRule from "../../waits/WaitRule"
import { tileWaits } from "../../waits/waits"
import ContinuesMenu from "./ContinuesMenu"
import InstructionPress from "./InstructionPress"
import type { Continuable, Tile, TileEdit } from "./planEdits"
import PlanStep from "./PlanStep"
import RemovedTile, { Undo } from "./RemovedTile"

/** The trash press — 30px at a desk, 44px on a phone, as `Button` sizes an icon alone. */
export const Remove = ({
  what,
  onPress,
}: {
  readonly what: string
  readonly onPress: () => void
}): ReactNode => (
  <Button
    variant="ghost"
    size="md"
    icon={Trash2}
    aria-label={what}
    title={what}
    onClick={onPress}
  />
)

const EditableTile = ({
  tile,
  mark,
  glyph,
  name,
  lead,
  conditions,
  declared,
  options,
  pieces,
  onEdit,
  onUndo,
}: {
  readonly tile: Tile
  /** Its number on the card. */
  readonly mark: string
  readonly glyph: LucideIcon
  readonly name: string
  /** What stands for the glyph and the name on a live tile — the agent step's pickers. */
  readonly lead: ReactNode
  /** The conditions first waited on here, for the rule above it — `planWaits`. */
  readonly conditions: readonly string[]
  /** The conditions the step's agent file declares, which the gate cannot remove. */
  readonly declared: readonly string[]
  /** What it may continue — `continuable`. */
  readonly options: readonly Continuable[]
  /** A spawn's pieces, editable, drawn under its instruction — nothing on any other entry. */
  readonly pieces: ReactNode
  readonly onEdit: (change: TileEdit) => void
  readonly onUndo: (field: keyof TileEdit) => void
}): ReactNode => {
  const { now, proposed } = tile
  if (tile.removed)
    return <RemovedTile mark={mark} glyph={glyph} name={name} onUndo={() => onUndo("removed")} />
  const clock = proposed.type === "agent" ? proposed.waitUntil : undefined
  const own = proposed.type === "agent" ? proposed.waitFor : undefined
  const { names, struck } = tileWaits(conditions, own, declared, tile.waitCleared)
  const press = tile.waitCleared ? (
    <Undo onPress={() => onUndo("waitCleared")} />
  ) : (
    <Remove what="Remove wait" onPress={() => onEdit({ waitCleared: true })} />
  )
  const continues = now.type === "agent" ? now.continues : undefined
  return (
    <>
      {clock === undefined ? undefined : (
        <li className="flex min-w-0 flex-col py-0.5">
          <ClockRule until={clock} struck={tile.waitCleared} end={press} />
        </li>
      )}
      {names.length > 0 || struck.length > 0 ? (
        <li className="flex min-w-0 flex-col py-0.5">
          <WaitRule
            names={names}
            struck={struck}
            end={clock === undefined && own !== undefined ? press : undefined}
          />
        </li>
      ) : undefined}
      <li className="flex min-w-0 flex-col rounded-surface border border-border p-2.5">
        <PlanStep
          mark={mark}
          glyph={glyph}
          agent={name}
          lead={lead}
          instruction={now.instruction}
          edited={tile.changes > 0}
          end={
            <>
              {/* Wherever there is a choice to make, or was one the composer made — so a
                  step whose conversation was removed from under it says *new session*. */}
              {now.type === "agent" &&
              (options.length > 0 ||
                (proposed.type === "agent" && proposed.continues !== undefined)) ? (
                <ContinuesMenu
                  mark={mark}
                  now={continues}
                  options={options}
                  onPick={(key) => onEdit({ continues: { key } })}
                />
              ) : undefined}
              <Remove what="Remove step" onPress={() => onEdit({ removed: true })} />
            </>
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
        {pieces}
      </li>
    </>
  )
}

export default EditableTile
