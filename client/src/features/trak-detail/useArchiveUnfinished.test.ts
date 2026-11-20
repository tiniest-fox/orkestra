/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * `useResume.test.ts`'s reasoning: the decision worth asserting is the one that fails
 * *silently*. A mutation that invalidates one key refreshes half the screen and reports
 * nothing — and on this press that half matters especially, because a trak that has just
 * been ended is one somebody is about to go looking for in the list.
 *
 * The press guard lives in the hook rather than the factory, and it is the one that is
 * deliberately *not* `running` — asserted where it is: `TrakDetailPage.test.tsx`.
 */

import { describe, expect, it, vi } from "vitest"
import { archiveUnfinishedMutationOptions } from "./useArchiveUnfinished"

const ID = "trak-1"

/** A cache stub that records what it was asked to invalidate, and when it answered. */
const spyCache = (settle: Promise<void> = Promise.resolve()) => {
  const keys: unknown[][] = []
  return {
    keys,
    invalidateQueries: ({ queryKey }: { readonly queryKey: readonly unknown[] }) => {
      keys.push([...queryKey])
      return settle
    },
  }
}

describe("archiveUnfinishedMutationOptions", () => {
  it("invalidates the detail and the list, because an ending moves the row too", async () => {
    const cache = spyCache()
    await archiveUnfinishedMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()

    expect(cache.keys).toEqual([["trak", ID], ["traks"]])
  })

  /**
   * The merge preview is keyed separately on purpose — it describes the daemon's own
   * checkout rather than this trak — so an ending must not sweep it away mid-press.
   */
  it("leaves the merge preview alone, which is about somebody else's checkout", async () => {
    const cache = spyCache()
    await archiveUnfinishedMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()

    expect(cache.keys.flat()).not.toContain("merge-preview")
  })

  it("returns the invalidation, so the press stays disabled across the refetch", async () => {
    let release!: () => void
    const cache = spyCache(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const settled = vi.fn<() => void>()

    const pending = archiveUnfinishedMutationOptions(ID, cache, () => Promise.resolve())
      .onSuccess()
      .then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    release()
    await pending
    expect(settled).toHaveBeenCalled()
  })
})
