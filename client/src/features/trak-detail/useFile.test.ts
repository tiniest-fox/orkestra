/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * `useStop.test.ts`'s reasoning, for its twin: a filing moves a trak from *waiting for
 * you* or *running* to *running*, which is a move between two sections of the list — so
 * a mutation that invalidated the detail alone would leave the row this press exists to
 * change reading as parked.
 *
 * The press guard is in the hook rather than the factory, and it is the one deliberately
 * *not* `running` — asserted where it is, in `TrakDetailPage.test.tsx`.
 */

import { describe, expect, it, vi } from "vitest"
import { fileMutationOptions } from "./useFile"

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

describe("fileMutationOptions", () => {
  it("invalidates the detail and the list, because a filing moves the row too", async () => {
    const cache = spyCache()
    await fileMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()

    expect(cache.keys).toEqual([["trak", ID], ["traks"]])
  })

  it("returns the invalidation, so the press stays disabled across the refetch", async () => {
    let release!: () => void
    const cache = spyCache(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const settled = vi.fn<() => void>()

    const pending = fileMutationOptions(ID, cache, () => Promise.resolve())
      .onSuccess()
      .then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    release()
    await pending
    expect(settled).toHaveBeenCalled()
  })
})
