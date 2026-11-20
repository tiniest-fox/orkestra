/**
 * A spawn's children, one request each, through the route an ordinary trak is read by.
 *
 * **Not a field on `TrakDetailDto`, and that is the decision.** Clicking a piece's step has
 * to show that step's *turns*, which needs the child's whole transcript and log — and the
 * parent's payload is polled, so embedding N of those multiplies it by the width of the
 * spawn. Nine children of a long-running trak is the case that breaks it. Read separately
 * they cost nothing on the wire, and `["trak", id]` is already the detail key, so the family
 * map and `useParent`'s read from the other side share one cache entry.
 *
 * The options are `trakDetailQueryOptions`, unchanged: a child polls on the same interval
 * and for the same reason its parent does, and there is no second opinion about the key.
 *
 * **There is no error state here, and that is now load-bearing rather than merely tidy.** A
 * piece is read and acted on inside this drawer and nowhere else, so a child that has not
 * answered — not yet, or at all — is a position that is simply absent, and `familyBands`
 * falls back to the parent's own spawn row for it. What that costs is worth stating: a piece
 * whose fetch fails outright is unreachable until it succeeds, where it used to have a page
 * of its own that would have reported the failure. The fallback row is what keeps the parent
 * legible meanwhile.
 */

import { useQueries } from "@tanstack/react-query"
import type { EventDto, TrakDetailDto } from "../../../api/types"
import { childIds } from "./family"
import { trakDetailQueryOptions } from "../useTrakDetail"

export const useFamily = (
  log: readonly EventDto[] | undefined,
): ReadonlyMap<string, TrakDetailDto> => {
  const results = useQueries({
    queries: childIds(log ?? []).map((id) => trakDetailQueryOptions(id)),
  })
  const children = new Map<string, TrakDetailDto>()
  for (const result of results)
    if (result.data !== undefined) children.set(result.data.id, result.data)
  return children
}
