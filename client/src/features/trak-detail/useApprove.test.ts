/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * The decisions worth asserting are the two that fail *silently*. A mutation that
 * invalidates one key succeeds, refreshes half the screen and reports nothing; one whose
 * `onSuccess` forgets to return its promise settles early, and the button flickers
 * enabled with stale data behind it. Neither shows up in a render test — both show up
 * here, which is why the hook is a factory plus a one-line wrapper.
 *
 * The press guards live in the hook rather than the factory, so they are asserted where
 * they are: `TrakDetailPage.test.tsx`.
 */

import { describe, expect, it, vi } from "vitest"
import { approveMutationOptions } from "./useApprove"

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

describe("approveMutationOptions", () => {
  it("invalidates the detail and the list, because approving changes the row behind it", async () => {
    const cache = spyCache()
    await approveMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()

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

    const pending = approveMutationOptions(ID, cache, () => Promise.resolve())
      .onSuccess()
      .then(settled)

    // The invalidation has not answered, so neither may the mutation: TanStack waits on
    // whatever `onSuccess` returns before clearing `isPending`.
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    release()
    await pending
    expect(settled).toHaveBeenCalled()
  })

  it("sends nothing until the mutation runs — no approve fires on construction", () => {
    const send = vi.fn<() => Promise<void>>(() => Promise.resolve())
    approveMutationOptions(ID, spyCache(), send)
    expect(send).not.toHaveBeenCalled()
  })
})
