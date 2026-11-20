/**
 * One subscription to the engine's stream, applied to the query cache.
 *
 * **Mounted once for the whole app, not once per screen.** Every frame names its trak,
 * so one connection serves the list and whatever drawer is open — and a second
 * subscriber would be a second copy of the rules below, with its own idea of which
 * frames had already been applied. That is why `EventSource` is banned outside the
 * seam and this hook is the only caller.
 *
 * **A frame patches, or it invalidates. It never guesses.** `applyFrame` answers with
 * the new detail only when the frame is the next line of that trak's file; anything
 * else — a gap, a duplicate, a `Resync` — falls through to asking the server, which is
 * always correct and merely costs a request. Patching is what makes a running turn draw
 * without a poll behind it; the fallback is what stops that turning into a log with a
 * hole in it. `Drive` is the one frame that does both, and only while a read of the
 * trak is in flight — the reason is at the site.
 *
 * **The list is re-read on every frame, `Drive` included.** A row's *running* is fiber
 * presence rather than custody, and the fiber leaves the map a moment after the release
 * frame goes out — the trailing settle below is what lands the re-read after it. **The
 * process family is the exception**: a hosted process never moves a trak, so nothing on a
 * row can change with one, and a dev server prints a chunk every 200ms.
 *
 * Kind `hook` in `client-style`'s admission table: it takes `subscribe` as a parameter
 * rather than reaching for the seam, so a test drives it by handing frames in — an
 * `EventSource` is invisible to MSW and a test that mocked one would be testing the
 * mock.
 */

import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { openEngineStream } from "../api/stream"
import type { CliUsagesDto, EngineFrameDto, HostedProcessDto, TrakDetailDto } from "../api/types"
import { applyFrame, applyProcessFrame, applyUsageFrame } from "../applyFrame"
import { queryKeys } from "../queryCache"

/** What the hook needs of a stream: hand me frames, say when you connect, and let me stop. */
export type Subscribe = (
  onFrame: (frame: EngineFrameDto) => void,
  onError: (error: Error) => void,
  onOpen: () => void,
) => () => void

/**
 * How long a burst of frames is allowed to collect before the list is re-read.
 *
 * The list is not patched, and that is deliberate: `instruction` and `activity` on a
 * summary are projections the server computes, so a client that rebuilt them here would
 * be keeping a second copy of rules it does not own. It re-reads instead — and a busy
 * turn writes a frame per tool call, so re-reading on each one would be a request per
 * call. Trailing, so the last frame of a burst is always followed by one.
 */
const LIST_SETTLE_MS = 250

/**
 * Apply one frame, and say whether the list should be re-read.
 *
 * Exported for the test, which is the honest reason: everything here is a decision
 * about the cache and none of it is reachable from a value.
 */
export const receiveFrame = (cache: QueryClient, frame: EngineFrameDto): boolean => {
  if (frame._tag === "Resync") {
    // Nothing held is known to be contiguous any more, so nothing held is worth
    // patching onto.
    void cache.invalidateQueries()
    return true
  }
  // A goal moved: its screen and the list's banner re-read it whole, since the frame
  // carries nothing to patch with. No trak's row moved, so the list is left alone.
  if (frame._tag === "Goal") {
    void cache.invalidateQueries({ queryKey: queryKeys.goal(frame.goal) })
    void cache.invalidateQueries({ queryKey: queryKeys.goals })
    return false
  }
  // A CLI's plan usage: replaced whole, and asked for where nothing is held yet.
  if (frame._tag === "Usage") {
    const held: CliUsagesDto | undefined = cache.getQueryData(queryKeys.usage)
    if (held === undefined) void cache.invalidateQueries({ queryKey: queryKeys.usage })
    else cache.setQueryData(queryKeys.usage, applyUsageFrame(held, frame))
    return false
  }
  // The trak's processes, not its detail — or the project checkout's, where no trak is
  // named: patched when the frame is the next thing that list can take, and re-read
  // otherwise — `applyProcessFrame`.
  if (frame._tag === "Process" || frame._tag === "ProcessOutput") {
    const key =
      frame.trak === undefined ? queryKeys.projectProcesses : queryKeys.processes(frame.trak)
    const held: readonly HostedProcessDto[] | undefined = cache.getQueryData(key)
    const next = held === undefined ? undefined : applyProcessFrame(held, frame)
    if (next === undefined) void cache.invalidateQueries({ queryKey: key })
    else cache.setQueryData(key, next)
    return false
  }
  // A commit is the one append that changes something outside the trak's own files: every
  // slice of its diff moves at once, so all three are swept by the prefix they share. It is
  // deliberately not patched — what a commit did to the working tree is git's answer, and
  // the client has no way to compute it.
  if (frame._tag === "Appended" && frame.event._tag === "WorkCommitted")
    void cache.invalidateQueries({ queryKey: queryKeys.changesOf(frame.trak) })
  // A merge that landed moved a checkout outside the trak — the project's, for a top-level
  // trak — so the git bar's counts are stale until it asks again. Re-read rather than
  // wait out the poll, for the same reason as above: only git can say what moved.
  if (frame._tag === "Appended" && frame.event._tag === "WorkMerged")
    void cache.invalidateQueries({ queryKey: queryKeys.git })

  const key = queryKeys.trak(frame.trak)
  const held: TrakDetailDto | undefined = cache.getQueryData(key)
  const next = held === undefined ? undefined : applyFrame(held, frame)
  if (next === undefined) {
    // Includes the ordinary case of a trak nobody has open: there is nothing to patch,
    // and invalidating a query with no observer costs nothing and refetches nothing.
    void cache.invalidateQueries({ queryKey: key })
    return true
  }
  cache.setQueryData(key, next)
  // A `Drive` frame carries no `seq`, so a read that was in flight when it arrived can
  // land after it and put back the custody it was built without — the press that
  // approved a plan re-reads at the moment the drive is taking custody, and `detailFor`
  // can answer before `adopt` has written the holder. Nothing on `custody` says which
  // is newer, and the next append is contiguous with that answer, so the loss would go
  // unnoticed until the drawer was reopened. Invalidating cancels that read and starts
  // one made after custody was taken. Only while one is in flight: a drawer following
  // a turn on frames alone must not pay a re-read for every drive.
  if (frame._tag === "Drive" && cache.getQueryState(key)?.fetchStatus === "fetching")
    void cache.invalidateQueries({ queryKey: key })
  return true
}

export const useEngineStream = (subscribe: Subscribe = openEngineStream): void => {
  const cache = useQueryClient()
  useEffect(() => {
    let settling: ReturnType<typeof setTimeout> | undefined
    const refreshList = (): void => {
      if (settling !== undefined) clearTimeout(settling)
      settling = setTimeout(() => {
        void cache.invalidateQueries({ queryKey: queryKeys.traks })
      }, LIST_SETTLE_MS)
    }

    const stop = subscribe(
      (frame) => {
        if (receiveFrame(cache, frame)) refreshList()
      },
      () => {
        // A dropped connection is news, not an ending: `EventSource` reconnects and
        // quotes `Last-Event-ID`, and whatever it missed arrives as a replay or a
        // `Resync`. What must not happen is the screen going stale in the meantime,
        // which is what the poll left behind is for.
        refreshList()
      },
      () => {
        // A connection made again may be to an engine that was rebuilt or restarted
        // while it was down, so the page asks which client it serves now. A query with
        // no observer — the dev page never checks — fetches nothing for this.
        void cache.invalidateQueries({ queryKey: queryKeys.build })
      },
    )

    return () => {
      if (settling !== undefined) clearTimeout(settling)
      stop()
    }
  }, [cache, subscribe])
}
