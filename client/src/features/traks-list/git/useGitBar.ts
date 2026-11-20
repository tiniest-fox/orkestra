/**
 * The git bar's data: the project checkout's status, polled, and the four presses.
 *
 * **The poll is what fetches.** `GET /api/git` starts a fetch on the engine when the last
 * one began five or more minutes ago, so this query — unconditional at `POLL_MS`, and
 * stopped by TanStack when nothing is mounted or the tab is hidden — is the whole of the
 * automatic fetch. Nothing here keeps a timer of its own.
 *
 * **One mutation for every press, and it spends nothing.** Each is `git` against the
 * project checkout and claims no custody, so no trak's drive refuses it and `running`
 * is not an argument. The rest of an acting hook's contract still holds: nothing on the
 * bar is pressable while any press is in flight, `press` refuses when the control would
 * be disabled, and nothing fires on its own. A press answers with the status itself,
 * which is written straight into the cache rather than re-asked.
 *
 * **What a press earned is read off the mutation, never the cache**: a refusal is its
 * error, and changes a stash kept are on its answer alone — the engine keeps no memory of
 * them, so the next poll would not say so again. A failure git gave the press is on its
 * answer too, and that is the only failure whose notice rises: the same field on a poll
 * is the engine's memory, of a fetch it started itself or a press made in another tab.
 */

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hostGit, pressGit } from "../../../api/git"
import { RefusedError } from "../../../api/http"
import type { GitActionDto, GitPressedDto, HostGitDto } from "../../../api/types"
import { POLL_MS, queryKeys } from "../../../queryCache"
import { gitView, pressable } from "./gitView"
import type { GitFix, GitView, Pressed } from "./gitView"

/** One press: the action, and whether it runs around a stash. */
export interface GitPress {
  readonly action: GitActionDto
  readonly stash: boolean
}

export interface GitBar {
  /** `undefined` until the first answer, and while none has ever come. */
  readonly view: GitView | undefined
  /** The status could not be read, and nothing earlier is on screen. */
  readonly unread: boolean
  /** Press one. Does nothing while that control is disabled. */
  readonly press: (press: GitPress) => void
  /**
   * Take a problem's way through. The stash press is the action again, around a stash.
   * *Resolve in a Trak* hands the engine's request to the caller and starts nothing —
   * and puts the notice away, which on a desk stands over the page that opens.
   */
  readonly fix: (fix: GitFix) => void
  /** Put the risen notice away. Its title stays on the bar until another press. */
  readonly dismiss: () => void
}

/** `queryFn` injectable, so the key and the interval are reachable without React. */
export const hostGitQueryOptions = (queryFn: () => Promise<HostGitDto> = hostGit) => ({
  queryKey: queryKeys.git,
  queryFn,
  refetchInterval: POLL_MS,
})

export const gitPressMutationOptions = (
  cache: { readonly setQueryData: (key: typeof queryKeys.git, data: HostGitDto) => unknown },
  mutationFn: (press: GitPress) => Promise<GitPressedDto> = pressGit,
) => ({
  mutationFn,
  // `stashed` is the press's own and stays off the polled read's entry.
  onSuccess: ({ stashed: _, ...status }: GitPressedDto) => {
    cache.setQueryData(queryKeys.git, status)
  },
})

/** What a press has to say for itself — a refusal, no answer at all, or a kept stash. */
export const pressedOf = (
  action: GitActionDto,
  at: number,
  error: Error | null,
  answer: GitPressedDto | undefined,
): Pressed | undefined => {
  if (error instanceof RefusedError) return { action, at, refusal: error.refusal }
  if (error !== null) return { action, at, unreachable: true }
  if (answer?.stashed !== undefined) return { action, at, stashed: answer.stashed.files }
  return undefined
}

/**
 * The `at` of the failure a press earned: the one on its answer, where it is not the one
 * the bar already held when the press was made. A press that lands answers with the
 * whole status, so an older failure of another action rides along on it unearned — and
 * a pull whose fetch failed is answered with the fetch's, which that press did earn.
 */
export const earnedFailure = (
  before: number | undefined,
  answer: GitPressedDto | undefined,
): number | undefined => {
  const at = answer?.failure?.at
  return at === before ? undefined : at
}

export const useGitBar = (
  /** Open the New Trak page on this description. */
  resolve: (description: string) => void,
): GitBar => {
  const cache = useQueryClient()
  const status = useQuery(hostGitQueryOptions())
  const mutation = useMutation(gitPressMutationOptions(cache))
  const [dismissed, setDismissed] = useState<string | undefined>(undefined)
  // The failure on the bar as the last press was made, which is what its answer's is
  // compared with. State rather than a ref, because the view is derived from it.
  const [before, setBefore] = useState<number | undefined>(undefined)
  const action = mutation.variables?.action
  const pending = mutation.isPending ? action : undefined
  const pressed =
    action === undefined
      ? undefined
      : pressedOf(action, mutation.submittedAt, mutation.error, mutation.data)
  const view =
    status.data === undefined
      ? undefined
      : gitView(status.data, pressed, pending, dismissed, earnedFailure(before, mutation.data))

  const press = (asked: GitPress): void => {
    if (view === undefined || !pressable(view, asked.action)) return
    setBefore(status.data?.failure?.at)
    mutation.mutate(asked)
  }
  const dismiss = (): void => {
    setDismissed(view?.problem?.key)
  }

  return {
    view,
    unread: status.data === undefined && status.isError,
    press,
    fix: (fix) => {
      if (fix._tag === "Stash") {
        press({ action: fix.action, stash: true })
        return
      }
      dismiss()
      resolve(fix.description)
    },
    dismiss,
  }
}
