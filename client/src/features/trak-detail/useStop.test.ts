/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * `useArchiveUnfinished.test.ts`'s reasoning, and one thing sharper on this press: a stop moves a
 * trak from *running* to *waiting for you*, which is a move between two sections of the
 * list — so a mutation that invalidated the detail alone would leave the row this press
 * exists to change reading as busy.
 *
 * The press guard is in the hook rather than the factory, and it is the one deliberately
 * *not* `running` — asserted where it is, in `TrakDetailPage.test.tsx`.
 */

import { describe, expect, it, vi } from "vitest"
import { stopMutationOptions } from "./useStop"

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

describe("stopMutationOptions", () => {
  it("invalidates the detail and the list, because a stop moves the row too", async () => {
    const cache = spyCache()
    await stopMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()

    expect(cache.keys).toEqual([["trak", ID], ["traks"]])
  })

  it("returns the invalidation, so the press stays disabled across the refetch", async () => {
    // It matters more here than anywhere: the route waits for the kill before it answers,
    // so this press is already the slowest on the screen — a button that flickered
    // enabled at the end of it would be offering a second stop of a turn that is gone.
    let release!: () => void
    const cache = spyCache(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const settled = vi.fn<() => void>()

    const pending = stopMutationOptions(ID, cache, () => Promise.resolve())
      .onSuccess()
      .then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    release()
    await pending
    expect(settled).toHaveBeenCalled()
  })
})
