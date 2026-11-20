/**
 * The two places the page draws a trak's diff from, held together: the Changes tab, and
 * the change maps on the step's own documents — with the press that goes from one to the
 * other.
 *
 * One hook because the press is the joint: Open in Changes picks the tab's slice, lands
 * it on a file and shows it, so the three are one value at the page rather than three it
 * has to wire to each other.
 */

import type { Level } from "../../../components/StepBar"
import type { EventDto } from "../../../api/types"
import type { MapRow } from "../family/rows"
import { type Changes, useChanges } from "./useChanges"
import { type Landing, useLanding } from "./useLanding"
import { type StepSlice, useStepDiff } from "./useStepDiff"

export interface ChangeSurfaces {
  readonly tab: Changes
  /** The slice the position's own documents describe, once it is in. */
  readonly slice: StepSlice | undefined
  readonly landing: Landing
}

/**
 * Keyed to `at` like every press on the page, which at a spawn's piece is the piece; `row`
 * is the position the rail stands on, and `level` the altitude, which is what decides when
 * git is asked — the tab while it shows, the step's slice while the step shows a change map.
 */
export const useChangeSurfaces = (
  at: string,
  row: MapRow | undefined,
  log: readonly EventDto[] | undefined,
  level: Level,
  setLevel: (to: Level) => void,
): ChangeSurfaces => {
  const tab = useChanges(at, row, level === "changes")
  const slice = useStepDiff(at, row, log ?? [], level === "step")
  const landing = useLanding(tab.pick, () => {
    setLevel("changes")
  })
  return { tab, slice, landing }
}
