/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * `useStop.test.ts`'s reasoning, minus the list: a job stopping moves no row between
 * sections — custody is untouched — so the detail is the one thing to refetch.
 */

import { describe, expect, it } from "vitest"
import { stopJobMutationOptions } from "./useStopJob"

const ID = "trak-1"

describe("stopJobMutationOptions", () => {
  it("invalidates the detail alone — no turn was killed, so the list's row is unmoved", async () => {
    const keys: unknown[][] = []
    const cache = {
      invalidateQueries: ({ queryKey }: { readonly queryKey: readonly unknown[] }) => {
        keys.push([...queryKey])
        return Promise.resolve()
      },
    }
    await stopJobMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()
    expect(keys).toEqual([["trak", ID]])
  })

  it("hands the task id through as the mutation's variable", async () => {
    const asked: string[] = []
    const options = stopJobMutationOptions(
      ID,
      { invalidateQueries: () => Promise.resolve() },
      (taskId) => {
        asked.push(taskId)
        return Promise.resolve()
      },
    )
    await options.mutationFn("b1")
    expect(asked).toEqual(["b1"])
  })
})
