/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network —
 * `useSetMode.test.ts`'s shape, for the press that shares its contract.
 */

import { describe, expect, it, vi } from "vitest"
import { setHoldMutationOptions } from "./useSetHold"

const ID = "trak-1"

const spyCache = () => {
  const keys: unknown[][] = []
  return {
    keys,
    invalidateQueries: ({ queryKey }: { readonly queryKey: readonly unknown[] }) => {
      keys.push([...queryKey])
      return Promise.resolve()
    },
  }
}

describe("setHoldMutationOptions", () => {
  it("sends the direction it was given rather than toggling", async () => {
    // The row is a switch and the picker knows which way it is: `false` takes a pending
    // hold back, and a hook that toggled would need a second opinion about `holding`.
    const sent = vi.fn<(holding: boolean) => Promise<void>>(() => Promise.resolve())
    await setHoldMutationOptions(ID, spyCache(), sent).mutationFn(false)

    expect(sent).toHaveBeenCalledWith(false)
  })

  it("invalidates the detail and the list", async () => {
    const cache = spyCache()
    await setHoldMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()

    expect(cache.keys).toEqual([["trak", ID], ["traks"]])
  })
})
