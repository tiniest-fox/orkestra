/**
 * The trak this one is a piece of, where it is one — what turns `/traks/<childId>` into its
 * parent's drawer standing at that piece.
 *
 * **A subtrak has one canonical view and it is inside its parent.** Every link in the app
 * points there now, and this is what catches the ones that do not: a bookmark, a link
 * somebody was sent, the URL a piece's own drawer used to live at.
 *
 * **It redirects only once the parent has loaded, and that is the whole of the fallback.** A
 * child whose parent has been wiped is a root row on the list (`tree.ts`) and keeps its own
 * drawer — so a parent that 404s leaves this `undefined` and the child draws itself, which
 * is the one case a trak would otherwise be reachable from nowhere.
 *
 * `useQueries` over nought-or-one rather than `useTrakDetail` with an `enabled`: there is no
 * id to fetch on a trak that is nobody's piece, and a query switched off is a different thing
 * from a query that was never asked for. The options are `trakDetailQueryOptions` unchanged,
 * so the parent lands under `["trak", id]` — the key its own drawer is about to read it from,
 * one frame later.
 */

import { useQueries } from "@tanstack/react-query"
import type { EventDto, TrakDetailDto } from "../../../api/types"
import { parentId } from "./family"
import { trakDetailQueryOptions } from "../useTrakDetail"

export const useParent = (log: readonly EventDto[] | undefined): TrakDetailDto | undefined => {
  const id = parentId(log ?? [])
  // Mapped rather than spelled as a literal, for `useQueries`' sake: a tuple of one and a
  // tuple of none are two types, and the empty branch would fix the result to `[]`.
  const results = useQueries({
    queries: (id === undefined ? [] : [id]).map((each) => trakDetailQueryOptions(each)),
  })
  return results[0]?.data
}
