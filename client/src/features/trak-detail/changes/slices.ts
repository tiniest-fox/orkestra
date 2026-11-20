/**
 * Which slices of the work the Changes picker offers, and which one it is showing.
 *
 * **Two rows always, and a third that follows the rail.** All changes and Uncommitted are
 * facts about the trak; the third is a fact about wherever the reader is standing, so
 * stepping the arrows moves what the picker offers as well as what the pane draws.
 *
 * **A position that committed nothing has no third row at all**, rather than a disabled
 * one. A compose entry, a step that has not kept anything and the trak's ending have no
 * commit of the position's own, and a tab that cannot be pressed is a tab claiming there
 * is something there.
 *
 * Kind `pure`: `api/types`, a sibling pure module, and no React.
 */

import type { StepOutputDto } from "../../../api/types"
import type { MapRow } from "../family/rows"

/** What `?at=` carries for the two rows that are always on offer. */
export const ALL = "all"
export const UNCOMMITTED = "uncommitted"

/**
 * One row of the picker: what it is called, what it asks the engine for, and which of the
 * four slices it is.
 *
 * **`kind` is carried rather than read back off `at`.** Two of the four have a fixed `at`
 * and the other two are both a position's index, so the string cannot tell a step's turn
 * from a spawn's join — and `emptyWords` has different news for those two. It comes from
 * `MapRow.pieces`, which comes from the plan entry's own type.
 */
export interface Slice {
  /** The `at=` value, and the key this slice is cached under. */
  readonly at: string
  readonly label: string
  readonly kind: "all" | "uncommitted" | "step" | "join"
}

/**
 * The rows on offer at a position.
 *
 * **The third row is a *step's own commit*, so it takes both halves of that: a row whose
 * `kind` is `step`, carrying a sha.** A sha alone is not the question. `endRow` puts the
 * merge commit in the slot a step's commit takes — the map's right-hand side answers *what
 * did this leave behind* on every row — so the trak's ending carries one, at `at: -1` and
 * titled with the state's own word. Gated on the sha alone this offers `-1 · Merged` and
 * asks the engine for `at=-1`, at the position a merged trak's drawer *opens* on, since
 * `opensAt` prefers the ending over every other row. That sha is a commit on the *host*
 * branch besides, so an engine willing to resolve `-1` would answer about the wrong range.
 *
 * **A spawn's join is offered, and it is the one third row that is not one agent's turn.**
 * A spawn is `kind: "step"` like every other non-compose entry, and it commits at its own
 * position: `ChildrenJoined` decides `keepStep(step)` (`decide.ts`), so `CommitWork` runs
 * there as at any step boundary and the sha is the parent's branch tip once every piece's
 * merge has landed. That slice is all the pieces' work together, which is the only place
 * it can be read as one thing — a piece's own steps are read inside that piece.
 *
 * The label is the position's index and whatever the drawer calls it — `3 · builder` for a
 * step, `2 · 5 pieces` for a spawn, which is `row.title` either way, because those are the
 * two things every other surface names a position by.
 */
export const slicesFor = (row: MapRow | undefined): readonly Slice[] => {
  const fixed: readonly Slice[] = [
    { at: ALL, label: "All changes", kind: "all" },
    { at: UNCOMMITTED, label: "Uncommitted", kind: "uncommitted" },
  ]
  if (row === undefined || row.kind !== "step" || row.sha === undefined) return fixed
  return [
    ...fixed,
    {
      at: String(row.at),
      label: `${String(row.at)} · ${row.title}`,
      kind: row.pieces === undefined ? "step" : "join",
    },
  ]
}

/**
 * Which row is showing: what the reader picked, or All changes.
 *
 * **The fallback is what the third row disappearing costs.** Picking a step and then
 * stepping to a compose leaves a selection nothing offers any more, and a picker with
 * nothing lit would be the pane drawing a slice with no row to say which.
 */
export const showing = (slices: readonly Slice[], picked: string | undefined): string =>
  picked !== undefined && slices.some((slice) => slice.at === picked) ? picked : ALL

/**
 * Why a slice with no files in it is empty, in words — the title and the line under it.
 *
 * **Four wordings, because the four are not the same news.** Nothing uncommitted is a clean
 * tree and good; a step that changed nothing may be a review or a plan turn; a spawn that
 * changed nothing is several turns of that at once, and calling it *this step* names one
 * agent where several ran; a branch with nothing on it has not started. A single *No
 * changes* would read as a failure at three of the four.
 *
 * **It takes the row rather than its `at` string**, which is the whole of what makes the
 * fourth wording possible: a step's index and a spawn's are both a number, so the string
 * cannot tell them apart and answering from it gave a join one agent's sentence.
 *
 * `undefined` is a row the picker is not offering, and it reads as All changes — the same
 * fallback `showing` takes, so the two agree by construction rather than by anyone keeping
 * them in step.
 */
export const emptyWords = (
  slice: Slice | undefined,
): { readonly title: string; readonly line: string } => {
  switch (slice?.kind) {
    case "uncommitted":
      return {
        title: "Nothing uncommitted",
        line: "Everything in the checkout is committed to the branch.",
      }
    case "step":
      return {
        title: "This step changed no files",
        line: "It ran and filed its work without touching the checkout.",
      }
    case "join":
      return {
        title: "These pieces changed no files",
        line: "Every one of them ran and merged back without touching the checkout.",
      }
    case "all":
    case undefined:
      return {
        title: "No changes yet",
        line: "Nothing has been committed to this branch since it was cut.",
      }
  }
}

/**
 * Which slice a document filed at this row describes, and what to call it — or `undefined`
 * where no slice can say.
 *
 * **The step's own commit once it has one, and the uncommitted work until then.** A build's
 * document is read at its gate, before `CommitWork` runs at the approval, so its changes
 * are still in the checkout; once the step is kept they are its commit and nowhere else.
 *
 * **Uncommitted only while the row is the live one** — at its gate, running, or failed.
 * A step the trak has moved past without a commit changed nothing, and the checkout's
 * uncommitted work at that point is some later step's, which the figure does not describe.
 * So such a row has no slice, and its change map draws standalone.
 *
 * A spawn's join is not offered: its slice is every piece's work, and no one document there
 * describes it.
 */
export const documentSlice = (
  row: MapRow | undefined,
): { readonly at: string; readonly name: string } | undefined => {
  if (row === undefined || row.kind !== "step" || row.pieces !== undefined) return undefined
  if (row.sha !== undefined)
    return { at: String(row.at), name: `step ${String(row.at)} · ${row.title}` }
  return row.status === "gate" || row.status === "running" || row.status === "failed"
    ? { at: UNCOMMITTED, name: "the uncommitted work" }
    : undefined
}

const CHANGES_FENCE = /^```changes[ \t]*$/m

/**
 * Whether anything this position filed draws a change map — which is the only reason to
 * ask git for its slice while a reader is on the step rather than on Changes.
 */
export const drawsChangeMap = (filed: readonly StepOutputDto[]): boolean =>
  filed.some(
    (output) =>
      output.type === "artifact" &&
      Object.values(output.sections).some((text) => CHANGES_FENCE.test(text)),
  )
