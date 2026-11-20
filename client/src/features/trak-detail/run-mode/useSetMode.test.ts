/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * `useStop.test.ts`'s reasoning: a mode change moves nothing now, but the next gate is
 * decided by it, so both the detail and the row in the list are what a press changes.
 * The guard this hook does *not* have — `running` — is asserted where it is drawn, in
 * `TrakDetailPage.test.tsx`.
 */

import { describe, expect, it, vi } from "vitest"
import { setModeMutationOptions } from "./useSetMode"

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

describe("setModeMutationOptions", () => {
  it("sends the mode it was given, to this trak", async () => {
    const sent = vi.fn<(mode: string) => Promise<void>>(() => Promise.resolve())
    await setModeMutationOptions(ID, spyCache(), sent).mutationFn("smart")

    expect(sent).toHaveBeenCalledWith("smart")
  })

  it("invalidates the detail and the list, because the next gate reads the mode", async () => {
    const cache = spyCache()
    await setModeMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()

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

    const pending = setModeMutationOptions(ID, cache, () => Promise.resolve())
      .onSuccess()
      .then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    release()
    await pending
    expect(settled).toHaveBeenCalled()
  })
})
