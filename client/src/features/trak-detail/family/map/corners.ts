/**
 * What a plate's corners may carry, decided once for every surface that draws a plate.
 *
 * A plate has two corners and five facts that want one: the unread bolt (`gate`), the
 * hand-up arrow (`handUp`), the rail's count of background jobs (`count`), the badge on
 * a held entry or an asked-for compose (`badge`), and the continues mark (`continues`).
 * Each surface used to place its own — and the asked-for compose's hand landed on the
 * bolt's coordinates, so on an unattended trak a settled ask painted *automatically
 * approved* out of sight while both still read aloud.
 *
 * **The rule: the first fact present takes the right corner, the second the left, and a
 * third is not drawn.** `ORDER` is the precedence, and it is the only place it is written.
 * The right corner is the settled one — the bolt's since the marks began — so what a
 * reader has learned to look for stays where it was, and a second mark steps left the
 * way `ContinuesMark` always has. No row today carries three: the bolt sits on a gate the
 * trak passed and the held entry's badge on one it has not reached, the hand-up is the
 * ending's alone, and a compose entry continues nothing. Capping rather than stacking is
 * what keeps a sixth fact from silently overpainting a fifth; a test pins the cap.
 *
 * **Which facts a surface draws is the surface's**, passed in as `drawn`: the map says a
 * running row's count in words under its caption and the rail says nothing of gates, so
 * neither list is this file's to decide. The placement is.
 */

import type { MapRow } from "../rows"

export type CornerKind = "gate" | "handUp" | "count" | "badge" | "continues"

export type Corner = "right" | "left"

/** Precedence: earlier takes the right corner. */
const ORDER: readonly CornerKind[] = ["gate", "handUp", "count", "badge", "continues"]

const CORNERS: readonly Corner[] = ["right", "left"]

/**
 * Whether the row carries the fact. `gate` is a mark the engine made, never a person's
 * `Held`, which the band inside the document draws instead; `count` is gated on `running`
 * for `MapRow.outstanding`'s reason.
 */
const carries = (row: MapRow, kind: CornerKind): boolean => {
  switch (kind) {
    case "gate":
      return row.atGate !== undefined && row.atGate._tag !== "Held"
    case "handUp":
      return row.handUp !== undefined
    case "count":
      return row.status === "running" && row.outstanding > 0
    case "badge":
      return row.badge !== undefined
    case "continues":
      return row.continues !== undefined
  }
}

/**
 * Where each fact the row carries, among the ones this surface draws, goes — absent from
 * the map means not drawn.
 */
export const corners = (
  row: MapRow,
  drawn: readonly CornerKind[],
): ReadonlyMap<CornerKind, Corner> => {
  const placed = new Map<CornerKind, Corner>()
  for (const kind of ORDER) {
    const corner = CORNERS[placed.size]
    if (corner === undefined) break
    if (drawn.includes(kind) && carries(row, kind)) placed.set(kind, corner)
  }
  return placed
}

/** The offset that puts a 14px disc on the plate's corner, half outside it. */
export const cornerClass: Record<Corner, string> = { right: "-right-1", left: "-left-1" }
