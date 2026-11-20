/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * `useResume.test.ts`'s reasoning, on the press that commits somebody else's checkout: the
 * decisions that fail silently are which keys an ending sweeps and whether the press stays
 * down across the refetch. The guards live in the hook and are asserted where the press is
 * drawn: `FinishedView.test.tsx`.
 */

import { describe, expect, it, vi } from "vitest"
import { commitAndMergeMutationOptions } from "./useCommitAndMerge"

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

describe("commitAndMergeMutationOptions", () => {
  it("invalidates the detail and the list, because a merged child moves both", async () => {
    const cache = spyCache()
    await commitAndMergeMutationOptions(
      ID,
      cache,
      () => {},
      () => Promise.resolve(),
    ).onSuccess()

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

    const pending = commitAndMergeMutationOptions(
      ID,
      cache,
      () => {},
      () => Promise.resolve(),
    )
      .onSuccess()
      .then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    release()
    await pending
    expect(settled).toHaveBeenCalled()
  })

  /**
   * The press re-issues the merge, so what the Merge press's pre-check remembered is stale
   * on both exits — and only the declined one is visible, because the state gate hides
   * the other. Forgotten as the route accepts the press, before the refetch draws.
   */
  it("makes the Merge press forget its refusal as it lands, before the refetch", async () => {
    const order: string[] = []
    const cache = {
      invalidateQueries: ({ queryKey }: { readonly queryKey: readonly unknown[] }) => {
        order.push(String(queryKey[0]))
        return Promise.resolve()
      },
    }
    const forget = vi.fn<() => void>(() => {
      order.push("forget")
    })

    await commitAndMergeMutationOptions(ID, cache, forget, () => Promise.resolve()).onSuccess()

    expect(forget).toHaveBeenCalledOnce()
    expect(order).toEqual(["forget", "trak", "traks"])
  })

  it("sends nothing until the mutation runs — nothing commits on construction", () => {
    const send = vi.fn<() => Promise<void>>(() => Promise.resolve())
    commitAndMergeMutationOptions(ID, spyCache(), () => {}, send)
    expect(send).not.toHaveBeenCalled()
  })
})
