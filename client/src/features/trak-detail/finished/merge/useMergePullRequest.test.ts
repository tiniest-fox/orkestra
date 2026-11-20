/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network. The guards
 * live in the hook and are asserted where the press is drawn: `FinishedActs.test.tsx`.
 */

import { describe, expect, it, vi } from "vitest"
import { mergePullRequestMutationOptions } from "./useMergePullRequest"

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

describe("mergePullRequestMutationOptions", () => {
  /** The pull request too: the forge's next answer is the only record of the merge. */
  it("invalidates the detail, the list and the trak's pull request", async () => {
    const cache = spyCache()
    await mergePullRequestMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()

    expect(cache.keys).toEqual([["trak", ID], ["traks"], ["pull-request", ID]])
  })

  it("returns the invalidation, so the press stays busy across the refetch", async () => {
    let release!: () => void
    const cache = spyCache(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const settled = vi.fn<() => void>()

    const pending = mergePullRequestMutationOptions(ID, cache, () => Promise.resolve())
      .onSuccess()
      .then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    release()
    await pending
    expect(settled).toHaveBeenCalled()
  })
})
