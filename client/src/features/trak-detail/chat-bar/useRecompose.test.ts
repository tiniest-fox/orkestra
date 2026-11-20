/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * `useApprove.test.ts`'s reasoning: a replan moves the trak into `Composing`, which
 * changes the detail on this screen and the row in the list behind it, so both keys are
 * swept and the sweep is what the mutation waits on. What the sheet does with the answer
 * — shutting, or staying open with the refusal — is asserted in `TrakDetailPage.test.tsx`,
 * because it needs the hook's own state.
 */

import { describe, expect, it, vi } from "vitest"
import { recomposeMutationOptions } from "./useRecompose"

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

describe("recomposeMutationOptions", () => {
  it("hands the reason to the route as typed", async () => {
    const sent: string[] = []
    const options = recomposeMutationOptions(ID, spyCache(), (reason) => {
      sent.push(reason)
      return Promise.resolve()
    })
    await options.mutationFn("do it the other way")
    expect(sent).toEqual(["do it the other way"])
  })

  it("invalidates the detail and the list, because a replan moves the row too", async () => {
    const cache = spyCache()
    await recomposeMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()

    expect(cache.keys).toEqual([["trak", ID], ["traks"]])
  })

  it("returns the invalidation, so the send stays disabled across the refetch", async () => {
    let release!: () => void
    const cache = spyCache(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const settled = vi.fn<() => void>()

    const pending = recomposeMutationOptions(ID, cache, () => Promise.resolve())
      .onSuccess()
      .then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    release()
    await pending
    expect(settled).toHaveBeenCalled()
  })
})
