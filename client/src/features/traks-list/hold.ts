/**
 * The GitHub hold, decided over the groups the list draws — never over the flat trak
 * list, because a finished trak is not always a row. A piece on a running parent's band
 * resolves onto the band, where there is no pile for the forge to decide: it must
 * neither hold the page nor buy a ghost row, and its column keeps drawing its own
 * *Asking GitHub…* words while the block stands. The hold is about which pile a *row*
 * lands in, and a band column has none.
 *
 * **A group's pile is the forge's to decide** when it is placed at or below *Ready to
 * merge* with at least one member the forge was asked about — `Finished`, and something
 * kept on its branch. Below that line every placement comes off such a member's rung —
 * or its absence, which is the bottom rung's own claim — except the piles a *state* put
 * there: the archive, and RESOLVED, whose branch nothing was committed to and
 * which is therefore never asked about at all (`rungsOf`). A member like that gets no
 * rung of any kind, so counting it would make every page carrying one hold forever —
 * `ASKING` is what *still in the question* is, and it never says that. Such a group is
 * **still in the question** while every asked member's rung is `ASKING`; one member with
 * a better answer than a ghost — a verdict, a remembered one, `UNASKED` — and the group
 * can be drawn.
 *
 * **The page holds while at least one group is the forge's to decide and every one of
 * them is still in the question.** *Every* rather than *any*, because
 * `keepPreviousData` holds the old answer across a trak finishing, so one
 * newly-`ASKING` group on an answered page is ordinary — and blanking a page of
 * classified piles for it would be a worse flicker than the one the hold removes.
 * Derived from the rung map rather than tracked, because the map already distinguishes
 * everything the hold must not cover: a page with no finished work never asks the
 * forge, and a reload whose remembered answers cover the branches gives the rows real
 * rungs.
 *
 * **A question still in flight is `ASKING`, whatever the machine turns out to be**, so
 * a `gh` that is absent holds the block for the length of the engine's call — its
 * ten-second timeout at worst — before the rows land under *Finished*, `UNASKED` the
 * moment that answer arrives. The block cannot tell a slow forge from an absent one and
 * does not claim to; what it buys is that neither draws
 * a pile nobody vouched for.
 *
 * The comparison is to the `ASKING` rung itself: `rungsOf` sets that one constant for
 * every branch still in the question, so identity is exactly the fact being asked.
 */

import type { TrakSummaryDto } from "../../api/types"
import { ASKING, type Rungs } from "./pullRung"
import { asSections, placementOf, SECTION_ORDER, type Section } from "./sections"
import { asTree, type TrakRow } from "./tree"

/** The members the forge was asked about — the same two facts `rungsOf` reads, so a
 *  member counted here is one a rung can arrive for. */
const askedOf = (row: TrakRow): readonly TrakSummaryDto[] =>
  [row.trak, ...row.band].filter((member) => member.state._tag === "Finished" && member.branchMoved)

/** Placed at or below *Ready to merge*, with at least one member the forge was asked
 *  about — the endings a state put down there have none, and neither has RESOLVED;
 *  none of them is anybody's to wait on. */
const forgeDecided = (row: TrakRow, rungs: Rungs): boolean =>
  SECTION_ORDER.indexOf(placementOf(row, rungs)) >= SECTION_ORDER.indexOf("ready") &&
  askedOf(row).length > 0

/** Nothing has come back about any member whose rung decides this group's pile. */
const stillAsking = (row: TrakRow, rungs: Rungs): boolean =>
  askedOf(row).every((member) => rungs.get(member.id) === ASKING)

export interface DrawnList {
  readonly sections: readonly Section[]
  /** How many groups the placeholder stands in for — 0 when the page is not held. */
  readonly held: number
}

/**
 * The list as the page draws it: the placed sections, minus the groups the hold stands
 * in for while it stands.
 *
 * The whole list reaches the grouping either way — the drop happens per *group*, after
 * placement, so no band column is lost and no child is promoted to a row while the
 * block is up. Dropping a group can only empty the piles the forge decides: a group is
 * dropped only where its placement came off `ASKING`, which is the `finished` pile,
 * and every other forge pile holding a group would have kept the page from holding.
 */
export const withHold = (traks: readonly TrakSummaryDto[], rungs: Rungs): DrawnList => {
  const decided = asTree(traks).filter((row) => forgeDecided(row, rungs))
  const sections = asSections(traks, rungs)
  if (decided.length === 0 || !decided.every((row) => stillAsking(row, rungs)))
    return { sections, held: 0 }
  const dropped = new Set(decided.map((row) => row.trak.id))
  return {
    sections: sections
      .map(({ key, rows }) => ({ key, rows: rows.filter((row) => !dropped.has(row.trak.id)) }))
      .filter(({ rows }) => rows.length > 0),
    held: decided.length,
  }
}
