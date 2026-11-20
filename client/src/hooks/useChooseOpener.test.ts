/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * `useSetMode.test.ts`'s reasoning, one key over: the pick is not on screen until the
 * listing re-answers with `chosen` moved, so the openers key is what a pick changes —
 * and nothing else, because no trak moved.
 */

import { describe, expect, it, vi } from "vitest"
import { chooseOpenerMutationOptions } from "./useChooseOpener"

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

describe("chooseOpenerMutationOptions", () => {
  it("sends the kind it was built for and the id it was given", async () => {
    const sent = vi.fn<(kind: "terminal" | "editor", id: string) => Promise<void>>(() =>
      Promise.resolve(),
    )
    await chooseOpenerMutationOptions(spyCache(), "editor", sent).mutationFn("dev.zed.Zed")

    expect(sent).toHaveBeenCalledWith("editor", "dev.zed.Zed")
  })

  it("invalidates the listing alone, because only `chosen` moved and no trak did", async () => {
    const cache = spyCache()
    await chooseOpenerMutationOptions(cache, "terminal", () => Promise.resolve()).onSuccess()

    expect(cache.keys).toEqual([["openers"]])
  })

  it("returns the invalidation, so the rows stay disabled across the refetch", async () => {
    let release!: () => void
    const cache = spyCache(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const settled = vi.fn<() => void>()

    const pending = chooseOpenerMutationOptions(cache, "terminal", () => Promise.resolve())
      .onSuccess()
      .then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    release()
    await pending
    expect(settled).toHaveBeenCalled()
  })
})
