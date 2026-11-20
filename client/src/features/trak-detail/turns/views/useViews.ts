/**
 * Every view on one trak's transcript, for the page: which are open, what the engine
 * kept for each open one, and the press a view's frame sends.
 *
 * **Held by the page and handed down through `TrakViews`**, the way a markdown image's
 * address is: a view's card sits six components under the page, none of which knows
 * which trak it is drawing, and a component may not fetch.
 *
 * **Only an open view is fetched.** A view's HTML is the size of a document, and a
 * transcript can hold a view per turn — so a folded card costs nothing until its header
 * is pressed.
 *
 * **The query does not poll and nothing invalidates it.** What it reads was written
 * once, when the call completed, and no later event changes it. The one field that can
 * move is `answers`, when the trak's checkout is taken away, and a press then says so
 * in the engine's own refusal.
 *
 * **`press` is not an acting hook's mutation, and takes no `running`.** It starts no
 * drive and claims no custody — one tool call through a CLI, with no model turn — so
 * a turn under way refuses nothing and there is no second drive for a guard to prevent.
 * The frame's own host holds what a press is waiting on.
 */

import { useQueries } from "@tanstack/react-query"
import { useCallback, useState } from "react"
import { callViewTool, fetchView } from "../../../../api/trak"
import type { TranscriptEntryDto, ViewDto, ViewResultDto } from "../../../../api/types"
import { queryKeys } from "../../../../queryCache"
import { newestViews } from "./viewHost"

export interface TrakViewsValue {
  readonly isOpen: (call: string) => boolean
  readonly toggle: (call: string) => void
  /** The kept view, once read. `undefined` while it loads and where it could not be read. */
  readonly view: (call: string) => ViewDto | undefined
  /** Whether reading the view failed — the one case `view` cannot tell from loading. */
  readonly unread: (call: string) => boolean
  readonly press: (call: string, tool: string, args: unknown) => Promise<ViewResultDto>
  /** Whether something is driving the trak, which is whether a press needs a CLI started. */
  readonly running: boolean
  readonly phone: boolean
}

/** Injectable so the key and the no-poll decision are reachable without React or a network. */
export const viewQueryOptions = (
  id: string,
  call: string,
  queryFn: () => Promise<ViewDto> = () => fetchView(id, call),
) => ({
  queryKey: queryKeys.view(id, call),
  queryFn,
  staleTime: Number.POSITIVE_INFINITY,
})

/** One stable empty transcript, for the render before a trak has loaded. */
const NOTHING: readonly TranscriptEntryDto[] = []

export const useViews = (
  id: string,
  /** The transcript the views are on; `undefined` while its trak is still loading. */
  transcript: readonly TranscriptEntryDto[] = NOTHING,
  running: boolean,
  phone: boolean,
): TrakViewsValue => {
  // Scoped to the trak it was pressed on: the route's id changes without this
  // unmounting, and a header opened on one trak says nothing about the next.
  const [pressed, setPressed] = useState<{
    readonly id: string
    readonly open: ReadonlyMap<string, boolean>
  }>({ id, open: new Map() })
  const chosen = pressed.id === id ? pressed.open : new Map<string, boolean>()
  const newest = newestViews(transcript)
  const isOpen = (call: string): boolean => chosen.get(call) ?? newest.has(call)
  const open = transcript.flatMap((e) => (e._tag === "View" && isOpen(e.call) ? [e.call] : []))
  const read = useQueries({ queries: open.map((call) => viewQueryOptions(id, call)) })
  const press = useCallback(
    (call: string, tool: string, args: unknown) => callViewTool(id, call, tool, args),
    [id],
  )
  return {
    isOpen,
    toggle: (call) => {
      setPressed({ id, open: new Map(chosen).set(call, !isOpen(call)) })
    },
    view: (call) => read[open.indexOf(call)]?.data,
    unread: (call) => read[open.indexOf(call)]?.isError === true,
    press,
    running,
    phone,
  }
}
