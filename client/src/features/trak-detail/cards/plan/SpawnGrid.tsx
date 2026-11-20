/**
 * What a spawn will actually create: one column per child trak, that child's plan down it.
 *
 * **A column each, not an indented list.** A vertical stack of children has five y
 * positions, so anything reaching them travels down, and down reads as order — which is the
 * one thing a spawn does not say. Only geometry says *at once*, so the layout is the claim
 * and there is no rail, fan or indent to go with it.
 *
 * **Step k of every child sits in row k, with a rule across.** A ragged set needs a
 * reference or it reads as damage: columns of different depths, each dividing its own steps
 * wherever its text happened to reach, are unrelated rules at unrelated heights. Aligning
 * them gives the spawn one grid, so a child that stops early leaves a visibly empty cell
 * rather than an unexplained void. The cost is a claim the grid cannot support — the k-th
 * steps of independent traks do not happen together — and it is accepted because nothing
 * has run at a gate, so there is no pace for it to be wrong about.
 *
 * **A column is a child's whole plan**, which the composer writes as a list of steps — so a
 * ragged grid is ordinary data now rather than a capability held in reserve. A spawn of
 * one-step pieces still draws one row and no rules, which is the common case.
 *
 * The rules are `guide`, not `border`: `styles.css` tunes `border` to the threshold of
 * visibility, for an edge you are meant to feel rather than see, and these lines *are* the
 * drawing.
 *
 * **A piece that waits draws its rule inside its own column.** A column is a child's whole
 * plan, so a wait in it splits that plan the way one splits the card's list — above the
 * first step that waits, and once per condition down the column. The card's list draws a
 * rule of its own above the entry after the spawn, because that entry waits for the
 * pieces; `waits.ts` holds both readings.
 */

import type { ReactNode } from "react"
import type { AgentDto, ChildDto } from "../../../../api/types"
import { agentGlyph } from "../../../../format/glyph"
import PlanStep from "./PlanStep"
import WaitRule from "../../waits/WaitRule"
import { columnWaits } from "../../waits/waits"

const SpawnGrid = ({
  at,
  columns,
  agents,
}: {
  /** The spawn's own mark in the plan. Every piece's mark is built from it. */
  readonly at: string
  /** The library, for each child step's mark — `ProposalCard`'s, straight across. */
  readonly agents: readonly AgentDto[]
  /**
   * One entry per child trak, holding that child's plan in order.
   *
   * `SpawnStepDto.children` is exactly this, so a proposal's spawn passes straight through.
   */
  readonly columns: readonly (readonly ChildDto[])[]
}): ReactNode => {
  // A spawn of nothing is a shape the wire permits — `children` is an unbounded array — and
  // a grid of no columns is invalid CSS rather than an empty one. The spawn's own row above
  // still says what it was for.
  const depth = Math.max(0, ...columns.map((steps) => steps.length))
  if (depth === 0) return undefined

  return (
    <ol
      // A rule between the spawn's own instruction and its pieces. That instruction is the
      // composer's argument for the set rather than a heading, and without a line it ran
      // into the first row of children as though it were one of them.
      className="mt-2 grid min-w-0 border-t border-guide pt-2"
      style={{ gridTemplateColumns: `repeat(${String(columns.length)}, minmax(0, 1fr))` }}
    >
      {/* Child by child, placed explicitly. The grid is what puts the k-th steps on one
          line; the DOM order is free, so it follows each child's plan in sequence — which
          is what a reader who cannot see the columns, or who copies the card, gets. */}
      {columns.map((steps, j) => {
        const waits = columnWaits(agents, steps)
        return Array.from({ length: depth }, (_, k) => {
          const step = steps[k]
          const here = step !== undefined
          const fresh = waits[k] ?? []

          // **An empty cell draws no rules of its own**: a rule is a divider and there is
          // nothing on its far side to divide, so a column that has run out simply stops.
          // The left rule is the exception — it separates two columns, so one of them
          // still having a step at this depth is enough to need it.
          const left = columns[j - 1]?.[k] !== undefined
          const below = steps[k + 1] !== undefined

          return (
            <li
              key={`${String(j)}-${String(k)}`}
              // Nothing to announce, and an empty list item announces itself.
              aria-hidden={here ? undefined : true}
              style={{ gridColumn: j + 1, gridRow: k + 1 }}
              className={`min-w-0 px-2.5 ${j > 0 && (here || left) ? "border-l border-guide" : ""} ${
                k > 0 && here ? "border-t border-guide pt-2" : ""
              } ${below ? "pb-2" : ""}`}
            >
              {step === undefined ? undefined : (
                <div className="flex min-w-0 flex-col gap-1.5">
                  {fresh.length > 0 ? <WaitRule names={fresh} column /> : undefined}
                  <PlanStep
                    // Every step of a child is marked, not only its first. Beside a column
                    // of a different depth, an unmarked block cannot be told from the tail
                    // of the paragraph above it.
                    mark={
                      steps.length === 1
                        ? `${at}·${String(j + 1)}`
                        : `${at}·${String(j + 1)}.${String(k + 1)}`
                    }
                    glyph={agentGlyph(agents, step.agent)}
                    agent={step.agent}
                    instruction={step.instruction}
                  />
                </div>
              )}
            </li>
          )
        })
      })}
    </ol>
  )
}

export default SpawnGrid
