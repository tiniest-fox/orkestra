/**
 * The diff a step's own documents describe, for the change maps drawn in them.
 *
 * **The Changes tab's query, under the Changes tab's key**, so a slice read here is the
 * slice the tab opens on and neither asks git twice. Only `enabled` differs: the tab asks
 * while it is showing, and this asks while the step is showing a document that draws a
 * change map — nothing else on the step has a use for a diff.
 *
 * `onStep` is whether the drawer is at the step altitude; the hook asks the log whether the
 * position filed a change map, so the page hands over the log rather than the answer.
 *
 * `undefined` until the answer is in, and wherever no slice can say — which draws every
 * change map standalone rather than flagging files against a diff that is not there.
 */

import { useQuery } from "@tanstack/react-query"
import type { ChangesDto, EventDto } from "../../../api/types"
import type { MapRow } from "../family/rows"
import { filedAt } from "../filed"
import { drawsChangeMap, documentSlice, UNCOMMITTED } from "./slices"
import { changesQueryOptions } from "./useChanges"

export interface StepSlice {
  /** The `at=` the slice was asked under, which is what the Changes tab is landed on. */
  readonly at: string
  readonly name: string
  readonly data: ChangesDto
}

export const useStepDiff = (
  id: string,
  row: MapRow | undefined,
  log: readonly EventDto[],
  onStep: boolean,
): StepSlice | undefined => {
  const slice = documentSlice(row)
  const enabled = onStep && row !== undefined && drawsChangeMap(filedAt(log, row.at))
  const { data } = useQuery(
    changesQueryOptions(id, slice?.at ?? UNCOMMITTED, enabled && slice !== undefined),
  )
  // An answer for another slice is a cache entry the position has since moved off.
  return slice === undefined || data === undefined || data.at !== slice.at
    ? undefined
    : { ...slice, data }
}
