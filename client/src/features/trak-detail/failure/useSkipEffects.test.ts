/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network — the two
 * decisions that fail silently, on `useResume.test.ts`'s terms.
 */

import { describe, expect, it, vi } from "vitest"
import { skipEffectsMutationOptions } from "./useSkipEffects"

const ID = "trak-1"

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

describe("skipEffectsMutationOptions", () => {
  it("invalidates the detail and the list, because a skipped trak is running again", async () => {
    const cache = spyCache()
    await skipEffectsMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()

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

    const pending = skipEffectsMutationOptions(ID, cache, () => Promise.resolve())
      .onSuccess()
      .then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    release()
    await pending
    expect(settled).toHaveBeenCalled()
  })
})
