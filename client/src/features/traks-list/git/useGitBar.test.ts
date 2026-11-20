/**
 * Tier 1: the git bar's poll and its press, without React — that the status polls at the
 * shared interval and stops with its last watcher (the poll is what fetches, so one that
 * outlived its screen would fetch with nobody looking), and that a press writes its answer
 * into the cache rather than re-asking.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryObserver } from "@tanstack/react-query"
import { RefusedError } from "../../../api/http"
import type { HostGitDto } from "../../../api/types"
import { makeHostGit } from "../../../fixtures"
import { POLL_MS, queryKeys } from "../../../queryCache"
import { earnedFailure, gitPressMutationOptions, hostGitQueryOptions, pressedOf } from "./useGitBar"

const failed = (at: number): HostGitDto =>
  makeHostGit({ failure: { action: "fetch", message: "no route", at } })

describe("useGitBar", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("polls the status, and stops when the last watcher leaves", async () => {
    vi.useFakeTimers()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let calls = 0
    const options = hostGitQueryOptions(async (): Promise<HostGitDto> => {
      calls += 1
      await Promise.resolve()
      return makeHostGit()
    })
    expect(options.queryKey).toEqual(queryKeys.git)

    const unsubscribe = new QueryObserver(client, options).subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(calls).toBe(3)

    unsubscribe()
    await vi.advanceTimersByTimeAsync(POLL_MS * 4)
    expect(calls).toBe(3)
  })

  it("writes a press's answer into the status, without what only the press said", () => {
    const written: unknown[] = []
    const options = gitPressMutationOptions({
      setQueryData: (key, data) => written.push([key, data]),
    })
    const answer = makeHostGit({ fetchedAt: 5 })
    options.onSuccess({ ...answer, stashed: { files: ["README.md"] } })
    expect(written).toEqual([[queryKeys.git, answer]])
  })

  it("tells a refusal, a press that got no answer and a kept stash apart", () => {
    const refusal = { _tag: "Behind", behind: 2 } as const
    expect(
      pressedOf("push", 7, new RefusedError(409, refusal, "/api/git/push"), undefined),
    ).toEqual({ action: "push", at: 7, refusal })
    expect(pressedOf("fetch", 7, new TypeError("Failed to fetch"), undefined)).toEqual({
      action: "fetch",
      at: 7,
      unreachable: true,
    })
    expect(
      pressedOf("pull", 7, null, { ...makeHostGit(), stashed: { files: ["README.md"] } }),
    ).toEqual({ action: "pull", at: 7, stashed: ["README.md"] })
    expect(pressedOf("pull", 7, null, makeHostGit())).toBeUndefined()
    expect(pressedOf("pull", 7, null, undefined)).toBeUndefined()
  })

  it("counts a failure as a press's own only where its answer brought a new one", () => {
    // The press failed, or the fetch a pull begins with did.
    expect(earnedFailure(undefined, failed(40))).toBe(40)
    expect(earnedFailure(12, failed(40))).toBe(40)
    // The press landed, and the engine's older failure rode along on its answer.
    expect(earnedFailure(40, failed(40))).toBeUndefined()
    expect(earnedFailure(40, makeHostGit())).toBeUndefined()
    // Nothing has been pressed in this session at all.
    expect(earnedFailure(undefined, undefined)).toBeUndefined()
  })
})
