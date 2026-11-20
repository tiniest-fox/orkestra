/**
 * One slice of a trak's work, as files and hunks — and which slice that is.
 *
 * **The picked row lives here rather than in the page**, which is the one thing about this
 * hook that is not the usual shape. Which slice is showing is nothing but an input to the
 * key this query is cached under: a page holding it would be holding a value whose only
 * consumer is the hook it hands it to, and the fallback when the third row disappears would
 * then be written on one side of that handover or the other.
 *
 * **Two refresh rules, and they pull in opposite directions on purpose.**
 *
 * `enabled` is whether the drawer is on Changes at all. It is not the poll predicate
 * `queryCache` bans — that ban is about a query gating itself on *is anything happening*,
 * which is a coarse copy of the engine's state only the suppressed fetch could correct.
 * This is `useMergePreview`'s shape instead: nothing on any other altitude of the drawer has
 * a use for a diff, so asking git for one would be a request nobody reads.
 *
 * `refetchInterval` is the second, and only one slice takes it. A step's slice is a range
 * between two shas and fixed outright, so it is fetched once and left alone. The whole
 * branch's is not: its tip moves with every commit, and only the engine's own commit at the
 * end of a step arrives as `WorkCommitted` on the stream to sweep every slice of that trak
 * (`useEngineStream`). An agent committing mid-turn, a person committing in the checkout, or
 * a resumed session moves it with no event, so All changes is stale at once and re-asked
 * each time the tab opens — but not polled, since the tab being shown is when it is read.
 * Uncommitted can change under an agent while it is on screen, so it is the only one that
 * polls, and only while it is the row showing.
 */

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { trakChangedFile, trakChanges } from "../../../api/changes"
import type { ChangesDto, FileChangeDto } from "../../../api/types"
import { POLL_MS, queryKeys } from "../../../queryCache"
import type { MapRow } from "../family/rows"
import { ALL, UNCOMMITTED, showing, slicesFor, type Slice } from "./slices"

/**
 * What TanStack reads as *never re-ask*. Annotated rather than asserted: inferred as
 * `boolean` it stops being assignable to `refetchInterval`, and `as const` is the assertion
 * style this repo bans outright.
 */
const NEVER: false = false

export const changesQueryOptions = (
  id: string,
  at: string,
  enabled: boolean,
  queryFn: () => Promise<ChangesDto> = () => trakChanges(id, at),
) => ({
  queryKey: queryKeys.changes(id, at),
  queryFn,
  // Only Uncommitted moves while it is on screen without a commit, so only it polls.
  refetchInterval: at === UNCOMMITTED ? POLL_MS : NEVER,
  // A step's slice is never *stale*, which is what makes "fetched once" true rather than
  // merely "never polled": the client's defaults re-read on a window refocus and on a
  // remount, so stepping away and back would ask git for a range that cannot have moved.
  // All changes ends at the branch's tip, which a commit the engine did not make moves with
  // no event, so it is stale at once and reopening the tab asks git again.
  staleTime: at === UNCOMMITTED || at === ALL ? 0 : Number.POSITIVE_INFINITY,
  enabled,
})

/**
 * One collapsed file's patch, asked for when the reader opens its card and not before.
 * Refreshed by the slice's own rules, since it is a piece of that answer.
 */
export const changedFileQueryOptions = (
  id: string,
  at: string,
  path: string,
  enabled: boolean,
  queryFn: () => Promise<ChangesDto> = () => trakChangedFile(id, at, path),
) => ({
  ...changesQueryOptions(id, at, enabled, queryFn),
  queryKey: queryKeys.changedFile(id, at, path),
})

/** The file with its hunks once they are in, and whether asking for them failed. */
export const useChangedFile = (
  id: string,
  at: string,
  path: string,
  enabled: boolean,
): { readonly file: FileChangeDto | undefined; readonly isError: boolean } => {
  const { data, isError } = useQuery(changedFileQueryOptions(id, at, path, enabled))
  return { file: data?.files.find((file) => file.path === path), isError }
}

/**
 * Everything the Changes surface draws from: the rows on offer, the one showing, the press
 * that moves between them, and the answer for it.
 *
 * Flat rather than holding the `UseQueryResult` whole, so a test builds six fields instead
 * of forty discriminated ones — which would be testing TanStack.
 */
export interface Changes {
  /** The trak, which a collapsed file's card needs to ask for its own patch. */
  readonly id: string
  readonly slices: readonly Slice[]
  readonly at: string
  readonly pick: (to: string) => void
  readonly data: ChangesDto | undefined
  readonly isError: boolean
  readonly error: Error | null
}

/**
 * `row` is the position the rail is standing on, which is what the third slice follows;
 * `enabled` is whether the drawer is showing Changes, asked by the caller off the altitude
 * it holds.
 */
export const useChanges = (id: string, row: MapRow | undefined, enabled: boolean): Changes => {
  const [picked, pick] = useState<string | undefined>(undefined)
  const slices = slicesFor(row)
  const at = showing(slices, picked)
  const { data, isError, error } = useQuery(changesQueryOptions(id, at, enabled))
  return { id, slices, at, pick, data, isError, error }
}
