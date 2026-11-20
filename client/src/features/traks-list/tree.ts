/**
 * The flat list the engine returns, as the rows the list draws: a trak, and the pieces
 * it currently has out.
 *
 * A spawn of four is one row, not five. Flat, the children are four unrelated pieces of
 * work with unrelated descriptions; gathered onto their parent's band they are one
 * thing happening at once, which is what a spawn is.
 *
 * **It is handed the whole list, not one section's traks.** Grouping runs first and
 * placement second (`sections.ts`), so a group is never split by a boundary drawn after
 * it: a piece at a gate under a parent still running stays on its parent's band and the
 * *group* is what moves up. There is no arrangement of states that produces a child root
 * here, which is what makes "a subtrak is never a row of its own" hold by construction
 * rather than by a second pass. The one root with a parent is one whose parent the list
 * does not hold.
 */

import type { TrakStateDto, TrakSummaryDto } from "../../api/types"

export interface TrakRow {
  readonly trak: TrakSummaryDto
  /**
   * The children still out, in plan order, drawn abreast beneath the trak. Empty for
   * every trak that is not a spawn with pieces in flight — which is almost all of them.
   */
  readonly band: readonly TrakSummaryDto[]
}

/**
 * Whether a child is **still out** — moving, or wanting something from you.
 *
 * The axis is not busy-versus-idle, it is folded back in or not. Three states mean the
 * piece is done with and gone from the band; everything else means it is either moving
 * or standing there waiting, `Failed` and `Finished` included.
 *
 * **`Finished` is on the shown side, and it is the one worth arguing.** It reads like
 * an ending and is not one: a child's work enters its parent when it is landed — by a
 * human's press, or by its run mode as the plan runs out; `ChildLanded` is written at
 * that moment — so a child sitting at `Finished` is a child waiting to be landed
 * rather than one that is done with.
 *
 * **This decides whether the piece is on the list at all.** A child of a parent the list
 * holds is a band column or nothing, so `Merged`, `Closed` and `Abandoned` leave the page
 * with the band. Nothing is being hidden and no rule is owed about where they went: a
 * merged piece *is* its parent now, and a closed or abandoned one is work somebody stopped
 * on purpose. Neither is outstanding, and the list owes an account of the work still out
 * rather than of every row in the store.
 *
 * Exhaustive, so a state the server grows is a compile error here rather than a piece
 * that quietly stays on the band forever.
 */
export const stillOut = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    // Folded back in, filed away, or stopped on purpose. Nothing is owed and the
    // parent carries the work now.
    case "Merged":
    case "Closed":
    case "Abandoned":
      return false
    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Merging":
    case "Closing":
    case "Finished":
    case "Failed":
      return true
  }
}

/** The parent this list actually contains, which is not always the one recorded. */
const parentHere = (trak: TrakSummaryDto, present: ReadonlySet<string>): string | undefined => {
  const parent = trak.parent
  return parent !== undefined && present.has(parent.id) ? parent.id : undefined
}

/** Plan order, which is what `child` is: the position in the spawn that made them. */
const byPosition = (a: TrakSummaryDto, b: TrakSummaryDto): number =>
  (a.parent?.child ?? 0) - (b.parent?.child ?? 0)

/**
 * Roots in the order they arrived, each carrying the pieces it still has out.
 *
 * **Roots keep the store's order**, which is what lets the caller decide it: `sections.ts`
 * sorts the groups this returns, and only the band is re-ordered here. Plan order is what
 * a band exists to show, so it wins inside a spawn even though the page around it is
 * ordered by time.
 *
 * One level, because that is all there is: a trak at depth 1 may not spawn. **A child
 * whose parent is not in the list is a root here rather than dropped** — a wiped parent
 * is a thing that happens, and a trak that exists and is reachable from nowhere is the
 * one failure this must not have. It is also the only root with a parent, and so the one
 * exception to a subtrak never standing on its own.
 *
 * **A child that has been folded back in is on no band**, and with grouping run over the
 * whole list that is now the whole of what happens to it: `Merged`, `Closed` and
 * `Abandoned` leave the page, because the parent still on it is where that work went.
 */
export const asTree = (traks: readonly TrakSummaryDto[]): readonly TrakRow[] => {
  const present = new Set(traks.map((t) => t.id))
  const rows: TrakRow[] = []
  for (const trak of traks) {
    if (parentHere(trak, present) !== undefined) continue
    rows.push({
      trak,
      band: traks
        .filter((t) => parentHere(t, present) === trak.id && stillOut(t.state))
        .sort(byPosition),
    })
  }
  return rows
}
