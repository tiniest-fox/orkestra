/**
 * Exchange the passphrase for a session. Spends nothing; the cookie is the whole result.
 *
 * The acting-hook contract still applies, for a different reason than money: the guard
 * answers a wrong passphrase slowly and one at a time, so a second press while the first
 * is out queues behind it. Disabled while pending, and the callback refuses when disabled.
 *
 * On success the session is written as known-good and **everything else is swept**: the
 * queries a refused tab held are refusals, and the screen that mounts next must not draw
 * them for a frame before re-asking.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { ApiError, login } from "../../api/http"
import { queryKeys } from "../../queryCache"

/**
 * What went wrong, as the two things a login can meet. `refused` is the guard saying no
 * to the passphrase, and is drawn on the field; `unreachable` is everything else — the
 * engine down, a tunnel gone — and is drawn on the band, because it is not about what was
 * typed.
 */
export type LoginProblem =
  | { readonly kind: "refused" }
  | { readonly kind: "unreachable"; readonly message: string }

export interface Login {
  /** Try the passphrase. Silently does nothing while one is already out. */
  readonly submit: (passphrase: string) => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** `undefined`, never `null` — one representation of absence. */
  readonly problem: LoginProblem | undefined
}

/** A 401 is the only refusal a login has; anything else is the engine being unreachable. */
export const loginProblem = (error: Error): LoginProblem =>
  error instanceof ApiError && error.status === 401
    ? { kind: "refused" }
    : { kind: "unreachable", message: error.message }

/** Injectable so the cache decisions are reachable without React or a network. */
export const loginMutationOptions = (
  cache: Pick<QueryClient, "setQueryData" | "invalidateQueries">,
  mutationFn: (passphrase: string) => Promise<void> = login,
) => ({
  mutationFn,
  onSuccess: async (): Promise<void> => {
    cache.setQueryData(queryKeys.session, true)
    // Everything but the session, which was just set: a sweep that took it too would
    // draw the login again for the frame it took to re-ask.
    await cache.invalidateQueries({
      predicate: (query) => query.queryKey[0] !== queryKeys.session[0],
    })
  },
})

export const useLogin = (): Login => {
  const cache = useQueryClient()
  const mutation = useMutation(loginMutationOptions(cache))
  const disabled = mutation.isPending
  return {
    submit: (passphrase) => {
      if (disabled) return
      mutation.mutate(passphrase)
    },
    isPending: mutation.isPending,
    disabled,
    problem: mutation.error === null ? undefined : loginProblem(mutation.error),
  }
}
