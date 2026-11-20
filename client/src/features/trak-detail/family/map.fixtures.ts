/**
 * The family map, as the pane sees it after `family.ts` has read a log.
 *
 * `Band`, `Spot` and `Column` are the client's own view model rather than anything on the
 * wire, so nothing about a props type could invent one — which is what blocks `TrakMap`,
 * `TrakRail`, `RailSpawn` and `DrawerPane`.
 *
 * **These are written out rather than derived, and that is a compromise.** `familyBands`
 * would produce them from a log and stay true as the mapping changes; what stops that here
 * is that a band worth looking at needs a spawn with children, which means a log across
 * several traks rather than one. Written by hand, the shapes are exact and the values are
 * chosen; derived, they would be honest. Worth revisiting when the spawn case is what is
 * being designed.
 */

import { CircleDashed } from "lucide-react"
import type { Band, Column, Spot } from "./family"
import type { MapRow } from "./rows"
import { awaitingApproval, finished, working } from "../detail.fixtures"

const row = (
  key: string,
  at: number,
  kind: MapRow["kind"],
  status: MapRow["status"],
  tone: MapRow["tone"],
  title: string,
  caption: string,
): MapRow => ({
  key,
  at,
  kind,
  status,
  tone,
  // Which mark a row wears is `rows.ts`'s and is not what any of these fixtures is
  // about — one glyph for all of them, so a surface asserting on a specific one has to
  // build the row it means.
  mark: CircleDashed,
  title,
  caption,
  // No spawn among these: a piece count is what says a row is one, and every fixture here
  // is a compose, one agent's turn or the ending.
  pieces: undefined,
  sha: undefined,
  turns: [],
  atGate: undefined,
  handUp: undefined,
  outstanding: 0,
  continues: undefined,
  model: undefined,
  window: undefined,
  effort: undefined,
  badge: undefined,
  waiting: undefined,
})

/**
 * One row per kind, because `StepMark` draws a different mark for each and takes only
 * `kind`, `status` and `tone` — a full row is assignable to that `Pick`, so these serve
 * both surfaces.
 */
export const composeRow: MapRow = row("c", 0, "compose", "done", "good", "Compose", "the plan")
export const stepRow: MapRow = row("1", 1, "step", "done", "good", "Walk the exports", "builder")
export const runningRow: MapRow = row(
  "2",
  2,
  "step",
  "running",
  "working",
  "Split the branches",
  "builder",
)
export const gateRow: MapRow = row(
  "3",
  3,
  "step",
  "gate",
  "waiting",
  "Check the derived panel",
  "reviewer",
)
export const failedRow: MapRow = row(
  "4",
  4,
  "step",
  "failed",
  "bad",
  "Bump the provider",
  "builder",
)
export const todoRow: MapRow = row(
  "5",
  5,
  "step",
  "todo",
  "neutral",
  "Port the seed design",
  "builder",
)
export const endRow: MapRow = row("end", -1, "end", undefined, "good", "Finished", "")

export const spot: Spot = { key: "01HQ8G:2", row: runningRow, trak: working }
export const doneSpot: Spot = { key: "01HQ8G:1", row: stepRow, trak: working }
export const gateSpot: Spot = { key: "01HQ8H:3", row: gateRow, trak: awaitingApproval }
export const endSpot: Spot = { key: "01HQ8J:end", row: endRow, trak: finished }

/** A child's own plan, stacked under the spawn that made it. */
export const column: Column = { id: "01HQ8M", spots: [doneSpot, spot] }
export const secondColumn: Column = { id: "01HQ8P", spots: [gateSpot] }

/** No columns — every entry that is not a spawn, which is most of them. */
export const plainBand: Band = { spot: doneSpot, columns: [] }

/** A spawn with two children out, which is the case the rail exists to draw. */
export const spawnBand: Band = { spot, columns: [column, secondColumn] }

export const bands: readonly Band[] = [
  { spot: { key: "01HQ8G:0", row: composeRow, trak: working }, columns: [] },
  plainBand,
  spawnBand,
  { spot: gateSpot, columns: [] },
  { spot: endSpot, columns: [] },
]

export const columns: readonly Column[] = [column, secondColumn]
