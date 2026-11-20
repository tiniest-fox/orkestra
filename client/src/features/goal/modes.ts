/**
 * Which run modes a new goal's traks may open on: a set the New Goal drawer toggles,
 * never empty — a goal that could open nothing is not one worth starting — and always in
 * the order the modes are offered.
 */

import type { RunModeDto } from "../../api/types"
import { MODES } from "../../format/runMode"

export type GoalModes = readonly [RunModeDto, ...RunModeDto[]]

/** What the drawer opens on: the two that give up some gates, as the design round chose. */
export const OPENING_MODES: GoalModes = ["smart", "auto"]

/** `chosen` with `mode` turned on or off — the same set where that would leave none. */
export const toggleMode = (chosen: GoalModes, mode: RunModeDto): GoalModes => {
  const on = chosen.includes(mode)
  const [first, ...rest] = MODES.filter((m) => (m === mode ? !on : chosen.includes(m)))
  return first === undefined ? chosen : [first, ...rest]
}
