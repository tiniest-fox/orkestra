/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * `useResume.test.ts`'s reasoning: the decisions that fail *silently* are the ones worth
 * asserting. A wait is a standing condition, so a skip that fired on construction would
 * be a `claude` per render; and a mutation that invalidated one key would leave the list
 * behind the drawer saying the trak still rests.
 *
 * The press guards live in the hook rather than the factory, so they are asserted where
 * they are drawn: `FinishedView.test.tsx`.
 */

import { describe, expect, it, vi } from "vitest"
import { skipWaitMutationOptions } from "./useSkipWait"

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

describe("skipWaitMutationOptions", () => {
  it("invalidates the detail and the list, because a started step is a running trak", async () => {
    const cache = spyCache()
    await skipWaitMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()

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

    const pending = skipWaitMutationOptions(ID, cache, () => Promise.resolve())
      .onSuccess()
      .then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    release()
    await pending
    expect(settled).toHaveBeenCalled()
  })

  it("sends nothing until the mutation runs — no skip fires on construction", () => {
    const send = vi.fn<() => Promise<void>>(() => Promise.resolve())
    skipWaitMutationOptions(ID, spyCache(), send)
    expect(send).not.toHaveBeenCalled()
  })
})
