/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network. What the
 * pick changes on screen is asserted where the menu is drawn: `FinishedActs.test.tsx`.
 */

import { describe, expect, it } from "vitest"
import { setMergeMethodMutationOptions } from "./useSetMergeMethod"

describe("setMergeMethodMutationOptions", () => {
  it("invalidates the trak, which carries the pick", async () => {
    const keys: unknown[][] = []
    const cache = {
      invalidateQueries: ({ queryKey }: { readonly queryKey: readonly unknown[] }) => {
        keys.push([...queryKey])
        return Promise.resolve()
      },
    }
    await setMergeMethodMutationOptions("trak-1", cache, () => Promise.resolve()).onSuccess()
    expect(keys).toEqual([["trak", "trak-1"]])
  })
})
