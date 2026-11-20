/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * The same two silent failures `useApprove.test.ts` asserts, for the same reason: a
 * mutation that invalidates one key refreshes half the screen and reports nothing, and
 * one whose `onSuccess` forgets to return its promise settles early. Neither shows up in
 * a render test.
 *
 * The draft and the press guards live in the hook rather than the factory, so they are
 * asserted where they are: `TrakDetailPage.test.tsx`.
 */

import { describe, expect, it, vi } from "vitest"
import { sendChatMutationOptions, withReturned } from "./useSendChat"

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

describe("sendChatMutationOptions", () => {
  it("invalidates the detail and the list, because saying something starts a turn", async () => {
    const cache = spyCache()
    await sendChatMutationOptions(ID, cache, () => Promise.resolve()).onSuccess()

    expect(cache.keys).toEqual([["trak", ID], ["traks"]])
  })

  it("returns the invalidation, so the bar stays shut across the refetch", async () => {
    let release!: () => void
    const cache = spyCache(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const settled = vi.fn<() => void>()

    const pending = sendChatMutationOptions(ID, cache, () => Promise.resolve())
      .onSuccess()
      .then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    release()
    await pending
    expect(settled).toHaveBeenCalled()
  })

  it("sends nothing until the mutation runs — no turn fires on construction", () => {
    const send = vi.fn<
      (said: { readonly message: string; readonly attachments: readonly string[] }) => Promise<void>
    >(() => Promise.resolve())
    sendChatMutationOptions(ID, spyCache(), send)
    expect(send).not.toHaveBeenCalled()
  })
})

describe("withReturned", () => {
  it("lays what was handed back ahead of the draft, in the order it was typed", () => {
    expect(withReturned(["keep --json", "skip the changelog"], "one more thing")).toBe(
      "keep --json\n\nskip the changelog\n\none more thing",
    )
  })

  it("leaves a draft alone where nothing was handed back, and adds no blank lines to an empty one", () => {
    expect(withReturned([], "one more thing")).toBe("one more thing")
    expect(withReturned(["keep --json"], "  ")).toBe("keep --json")
  })
})
