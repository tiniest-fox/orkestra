/**
 * What the browser remembers of the forge, as a map from branch to the last thing said
 * about it — the read side of `forgeMemory`, and the only place anything reaches into the
 * query cache by hand.
 *
 * **In `hooks/` because both features ask.** The traks list needs it for the rows nothing
 * has come back for, and the finished pane needs it to draw a card's head before its own
 * answer arrives. `client-style`'s rule is that a thing moves here on its *second* use, and
 * this arrived with two.
 *
 * **It reads the cache rather than asking the engine, and that is the point.** A hook that
 * asked for one branch would be a second `gh` process per open trak page, which is exactly
 * the fan-out `useForgeListing` exists to have got rid of. What it reads is what somebody
 * else already paid for: the list's live answer, every open trak page's own answer, and
 * whatever the persist plugin put back at boot. **Both forge roots, and newest wins per
 * branch** — which is how a card's fresh read reaches the row behind it without the list
 * waiting out its own poll.
 *
 * **It subscribes to the cache under those two roots**, so an answer landing under either
 * re-renders every reader — the row behind an open drawer redraws when the drawer's own
 * answer arrives, rather than when something else happens to re-render the list. A fold
 * that only ran when the component rendered for its own reasons is the drawer and the list
 * disagreeing about a pull request until the list's next poll. The subscription is to the
 * cache, not to a query: no key names *every* answer under a root, and an observer would be
 * a fetch.
 *
 * **`useIsRestoring` is subscribed to rather than merely read.** It is what re-renders a
 * page when the stored writing has finished being read back — without it a screen mounted
 * before the restore finished would hold an empty map for as long as nothing else moved.
 * While it is true there is genuinely nothing remembered to report, so the map is empty and
 * both surfaces say they are still asking, which is true of them.
 *
 * **No memo.** The map is rebuilt on every render, which is a walk over at most a hundred
 * entries and is what keeps it honest: the alternative is a memo whose dependencies cannot
 * name the thing that changed, so a card would go on drawing an answer the poll had already
 * replaced — and `now` is one of its inputs, so a map held past a render is one that never
 * ages an answer out.
 */

import {
  useIsRestoring,
  useQueryClient,
  type Query,
  type QueryCacheNotifyEvent,
} from "@tanstack/react-query"
import { useCallback, useRef, useSyncExternalStore } from "react"
import type { ForgeListingDto, PullRequestDto } from "../api/types"
import { FORGE_ROOTS, forgeAnswerKey, rememberedByBranch, type ForgeMemory } from "../forgeMemory"

/** One object rather than a fresh empty map per render, so nothing downstream sees a
 *  new identity for a state that has not changed. */
const NOTHING: ForgeMemory = new Map()

/** Typed at `Query`'s defaults, so the key beneath reads as `QueryKey` rather than as the
 *  `any` the cache event carries it at — the one site that has to be told so. */
const aboutTheForge = (query: Query): boolean => forgeAnswerKey(query.queryKey)

/**
 * Whether this cache event can change what the fold reads: a forge answer arriving,
 * changing or being collected. The observer events are a pane mounting or leaving, which
 * moves no body and no stamp.
 */
const movesForgeMemory = (event: QueryCacheNotifyEvent): boolean =>
  (event.type === "added" || event.type === "updated" || event.type === "removed") &&
  // oxlint-disable-next-line typescript/no-unsafe-argument -- the event types its query at `any`; see above
  aboutTheForge(event.query)

export const useForgeMemory = (): ForgeMemory => {
  const client = useQueryClient()
  const restoring = useIsRestoring()
  // The snapshot is a count of forge events rather than the map, because
  // `useSyncExternalStore` compares snapshots by identity and the map is rebuilt per render.
  const moved = useRef(0)
  const subscribe = useCallback(
    (onChange: () => void) =>
      client.getQueryCache().subscribe((event) => {
        if (!movesForgeMemory(event)) return
        moved.current += 1
        onChange()
      }),
    [client],
  )
  useSyncExternalStore(subscribe, () => moved.current)
  if (restoring) return NOTHING
  return rememberedByBranch(
    // The two roots are `forgeMemory`'s own allow-list: what is remembered is exactly
    // what may be written down, and a third forge key would join the fold by joining it.
    FORGE_ROOTS.flatMap((root) =>
      client
        .getQueriesData<ForgeListingDto | PullRequestDto>({ queryKey: [root] })
        .map(([key, answer]) => ({
          answer,
          // Read separately because `getQueriesData` hands back bodies alone, and *when* is
          // half of what a remembered answer is: it decides the hour and it is what the
          // card's synced line says.
          at: client.getQueryState(key)?.dataUpdatedAt ?? 0,
        })),
    ),
    Date.now(),
  )
}
