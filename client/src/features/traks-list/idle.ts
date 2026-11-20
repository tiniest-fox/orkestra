/**
 * What the list reads off the engine's `idle` and `active`: which groups have been left,
 * when anything last happened to one, and how long ago that was in the row's own words.
 *
 * **The engine decides idle, never this file.** It holds the clock and the conditions it
 * still asks, and a client that re-derived *three days* from `active` would disagree with
 * it about every row on a machine whose clock drifts. The age here is only what the row
 * says, so it reads the browser's clock.
 */

import type { TrakSummaryDto } from "../../api/types"
import type { TrakRow } from "./tree"

const DAY = 24 * 60 * 60 * 1000

/**
 * Every member idle. The list never splits a group, so one live piece keeps the whole of
 * it active — and that piece draws on the band beside its faded siblings.
 */
export const idleOf = (row: TrakRow): boolean =>
  row.trak.idle === true && row.band.every((piece) => piece.idle === true)

/** The newest `active` anywhere in the group, or absent where no member has one. */
export const activeOf = (row: TrakRow): number | undefined =>
  newestOf(row, (member) => member.active)

/** The newest of one reading across the parent and its band. */
export const newestOf = (
  row: TrakRow,
  read: (member: TrakSummaryDto) => number | undefined,
): number | undefined => {
  let newest = read(row.trak)
  for (const piece of row.band) {
    const at = read(piece)
    if (at !== undefined && (newest === undefined || at > newest)) newest = at
  }
  return newest
}

/**
 * Whole days since `active` — `12d` — or absent where nothing was ever timestamped. A
 * clock behind the engine's reads as `0d` rather than a negative age.
 */
export const idleAge = (active: number | undefined, now: number): string | undefined =>
  active === undefined ? undefined : `${String(Math.max(0, Math.floor((now - active) / DAY)))}d`

/**
 * How many idle rows a pile draws before its `+N more` line: three on a desk, one on a
 * phone, where every row is 44px. **A cut never hides exactly one row** — a `+1 more`
 * line takes the room the row would, so the row is drawn instead.
 * Live rows are never cut; this is only ever handed the idle part of a section.
 */
export const idleCut = (count: number, phone: boolean): number => {
  const at = phone ? 1 : 3
  return count <= at + 1 ? count : at
}

/** The newest group's age in a pile — what a shelf line says of a whole section. */
export const pileAge = (rows: readonly TrakRow[], now: number): string | undefined => {
  let newest: number | undefined
  for (const row of rows) {
    const at = activeOf(row)
    if (at !== undefined && (newest === undefined || at > newest)) newest = at
  }
  return idleAge(newest, now)
}
