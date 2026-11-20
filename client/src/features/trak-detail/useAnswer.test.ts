/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * The same two silent failures `useApprove.test.ts` exists for — one key invalidated, or
 * an `onSuccess` that forgets to return its promise — and one more that is this action's
 * own: the answers reach `mutationFn` in the order they were given. They are positional
 * and nothing on the wire joins one to its question, so a reordering here is not an error
 * anywhere; it is the agent answering the wrong question and carrying on.
 *
 * The press guards live in the hook rather than the factory, so they are asserted where
 * they are: `TrakDetailPage.test.tsx`.
 */

import { describe, expect, it, vi } from "vitest"
import { answerMutationOptions, type Sent } from "./useAnswer"

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

describe("answerMutationOptions", () => {
  it("invalidates the detail and the list, because answering starts a turn", async () => {
    const cache = spyCache()
    await answerMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()

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

    const pending = answerMutationOptions(ID, cache, () => Promise.resolve())
      .onSuccess()
      .then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    release()
    await pending
    expect(settled).toHaveBeenCalled()
  })

  it("sends nothing until the mutation runs — no answer fires on construction", () => {
    const send = vi.fn<(sent: Sent) => Promise<void>>(() => Promise.resolve())
    answerMutationOptions(ID, spyCache(), send)
    expect(send).not.toHaveBeenCalled()
  })

  /**
   * The one assertion here that is not `useApprove`'s. `composer-answers.md` numbers the
   * list against the questions the agent still holds, so the order *is* the mapping — and
   * a factory that gathered or sorted them would be a wrong answer to every question after
   * the first, reported by nothing.
   */
  it("hands the answers on in the order they were given, which is the whole mapping", () => {
    const send = vi.fn<(sent: Sent) => Promise<void>>(() => Promise.resolve())
    const { mutationFn } = answerMutationOptions(ID, spyCache(), send)

    void mutationFn({ answers: ["list only", "yes, behind the flag"], note: "we ship Friday" })

    // The note rides in the same payload and stays out of the list — it answers no
    // question, and a mutation that folded it in would number it against one.
    expect(send).toHaveBeenCalledWith({
      answers: ["list only", "yes, behind the flag"],
      note: "we ship Friday",
    })
  })
})
