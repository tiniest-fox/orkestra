/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * `useApprove.test.ts`'s reasoning, on the other press that spends: the two decisions
 * worth asserting are the ones that fail *silently*. A mutation that invalidates one key
 * refreshes half the screen and reports nothing — and on this press that half matters
 * more than usual, because resuming is how a trak stops looking stopped, and the row in
 * the list behind the drawer is where somebody would next look for it.
 *
 * The press guards live in the hook rather than the factory, so they are asserted where
 * they are: `TrakDetailPage.test.tsx`.
 */

import { describe, expect, it, vi } from "vitest"
import { resumeMutationOptions } from "./useResume"

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

describe("resumeMutationOptions", () => {
  it("invalidates the detail and the list, because a trak picked back up is running", async () => {
    const cache = spyCache()
    await resumeMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()

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

    const pending = resumeMutationOptions(ID, cache, () => Promise.resolve())
      .onSuccess()
      .then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    release()
    await pending
    expect(settled).toHaveBeenCalled()
  })

  /**
   * The one that matters more here than on any other action hook. An interrupted trak is
   * a *standing* condition — still interrupted on the next poll, and the one after — so a
   * resume that fired on construction would not be a stray double press, it would be a
   * `claude` per render until a drive claimed custody.
   */
  it("sends nothing until the mutation runs — no resume fires on construction", () => {
    const send = vi.fn<() => Promise<void>>(() => Promise.resolve())
    resumeMutationOptions(ID, spyCache(), send)
    expect(send).not.toHaveBeenCalled()
  })
})
