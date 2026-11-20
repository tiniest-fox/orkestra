/**
 * A spawn's pieces at the plan gate, every step of each one editable — `SpawnGrid`'s
 * subject, laid out for cells that carry controls:
 *
 * - **Two pieces across at a desk, one on a phone.** The agent-and-model pair needs about
 *   150px, and `SpawnGrid`'s one column per piece gives a five-piece spawn about 130px at
 *   a desk. Pieces past two wrap into rows of two; on a phone each is full width.
 * - **A piece that wraps sits on a wash** — `surface-2` at half strength, rounded, with a
 *   gap between pieces — because once pieces wrap, a rule between columns no longer says
 *   where one ends. Where nothing wraps — one piece, or two at a desk — the pieces keep
 *   `SpawnGrid`'s ruled columns.
 * - **No name or key above a piece.** A piece step is identified by its mark alone, as
 *   everywhere else.
 *
 * The same grid at both widths, with only its columns and each piece's ground changing at
 * the seam — a cosmetic difference, so `max-sm:` says it rather than `usePhone`.
 */

import type { ReactNode } from "react"
import type { AgentDto } from "../../../../api/types"
import EditablePieceStep from "./EditablePieceStep"
import { type Cell, type CellEdit, cellWaits } from "./planEdits"

/** The grid's classes, and each piece's by its column, for a spawn of `n` pieces. */
const layoutOf = (n: number): { readonly grid: string; readonly piece: (j: number) => string } => {
  if (n <= 1) return { grid: "grid-cols-1", piece: () => "px-2.5" }
  if (n === 2) {
    return {
      grid: "grid-cols-1 gap-y-3 sm:grid-cols-2 sm:gap-y-0",
      piece: (j) =>
        `max-sm:rounded-surface max-sm:bg-surface-2/50 max-sm:p-2 sm:px-2.5 ${j === 1 ? "sm:border-l sm:border-guide" : ""}`,
    }
  }
  return {
    grid: "grid-cols-1 gap-x-2 gap-y-3 sm:grid-cols-2",
    piece: () => "rounded-surface bg-surface-2/50 p-2",
  }
}

/** Where a press on a piece step lands: the piece, then the step, both as proposed. */
interface On {
  readonly edit: (
    piece: number,
    step: number,
    change: Pick<CellEdit, "instruction" | "removed">,
  ) => void
  readonly undo: (piece: number, step: number, field: "instruction" | "removed") => void
  readonly agent: (piece: number, step: number, agent: string) => void
  readonly model: (piece: number, step: number, model: string, own: string | undefined) => void
}

const EditablePieces = ({
  at,
  pieces,
  agents,
  models,
  on,
}: {
  /** The spawn's own mark in the plan. Every piece step's mark is built from it. */
  readonly at: string
  /** `Tile.pieces`: one entry per piece, each its steps as drawn. */
  readonly pieces: readonly (readonly Cell[])[]
  readonly agents: readonly AgentDto[]
  readonly models: readonly string[]
  readonly on: On
}): ReactNode => {
  const layout = layoutOf(pieces.length)
  return (
    // The rule between the spawn's own instruction and its pieces, as `SpawnGrid` draws it.
    <ol className={`mt-2 grid min-w-0 border-t border-guide pt-2 ${layout.grid}`}>
      {pieces.map((cells, j) => {
        const waits = cellWaits(agents, cells)
        return (
          <li key={`piece-${String(j)}`} className={`flex min-w-0 flex-col ${layout.piece(j)}`}>
            <ol className="flex min-w-0 flex-col">
              {cells.map((cell, k) => (
                <li
                  key={`step-${String(k)}`}
                  className={`min-w-0 ${k > 0 ? "border-t border-guide pt-2" : ""} ${
                    k < cells.length - 1 ? "pb-2" : ""
                  }`}
                >
                  <EditablePieceStep
                    cell={cell}
                    // Numbered as proposed, so a removal renumbers nothing under the thumb.
                    mark={
                      cells.length === 1
                        ? `${at}·${String(j + 1)}`
                        : `${at}·${String(j + 1)}.${String(k + 1)}`
                    }
                    conditions={waits[k] ?? []}
                    agents={agents}
                    models={models}
                    onEdit={(change) => {
                      on.edit(j, k, change)
                    }}
                    onUndo={(field) => {
                      on.undo(j, k, field)
                    }}
                    onAgent={(agent) => {
                      on.agent(j, k, agent)
                    }}
                    onModel={(model, own) => {
                      on.model(j, k, model, own)
                    }}
                  />
                </li>
              ))}
            </ol>
          </li>
        )
      })}
    </ol>
  )
}

export default EditablePieces
