/**
 * Take what is on the table. **The second thing in this client that spends money**, and
 * the first that spends it on a trak that already exists.
 *
 * **One hook for two gates, because `Approve` is one action.** The composer's plan and a
 * step's filed work are the same press on the same route — `/act` reads which gate it
 * lands at off the log, and this file must not hold a second opinion about that. Which
 * gates *offer* the press is `controls.ts`, and it is two exhaustive switches rather than
 * one because the two gates are two states.
 *
 * `client-style`'s contract for a hook that acts, in full:
 *
 *   · **disabled while in flight, and non-submittable rather than merely spinning** —
 *     the server cannot tell a deliberate click from a double one;
 *   · **disabled while `custody.holder` is set**, which `useCreateTrak` had no version of:
 *     a trak that does not exist yet cannot be held, and one at a gate can be — by another
 *     tab, or by a `pnpm ork` in a terminal. The server refuses that with `409 Driving`,
 *     and a 409 the user provoked is a UI bug caught downstream rather than a design;
 *   · **the callback refuses when disabled as well as the button**, so a control that
 *     forgets to read `disabled` still cannot start a second drive;
 *   · **`onSuccess` returns the invalidation promise**, so `isPending` covers the refetch
 *     and the button stays disabled across the gap instead of flickering enabled with
 *     stale data behind it;
 *   · **nothing auto-fires** — no approve in an effect, no retry on mount. Work is
 *     approved because a person read it and said so, once;
 *   · **what it holds is dropped when `id` changes**, which is the rule this drawer added:
 *     the page keys this to whichever trak owns the position on screen, so a pending press
 *     and a refusal sentence must not outlive the trak they are about. `useScopedTo` is
 *     that line, and every acting hook here calls it.
 *
 * **Both keys, and that is not belt-and-braces.** Approving moves the trak out of its
 * gate, which changes the detail behind this screen *and* the row in the list behind that
 * — `TrakSummaryDto` carries `state`, `running` and a projected `activity`, all three of
 * which this press invalidates.
 *
 * **`said` rather than an `error`, because a refusal is the interesting failure.** The
 * two the server can answer with are both `409` told apart by their body, so the caller
 * gets the sentence and never the `RefusedError` — the exhaustive mapping lives in
 * `format/refusal.ts` and a surface switching on a reason phrase is what
 * `api/http.ts` records as the thing not to build.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { approve } from "../../api/actions"
import { RefusedError } from "../../api/http"
import type { PlanEditsDto } from "../../api/types"
import { refusalSaid } from "../../format/refusal"
import { queryKeys } from "../../queryCache"
import { useScopedTo } from "../../hooks/useScopedTo"

export interface Approval {
  /** Approve it. Silently does nothing while disabled, whatever the control did. */
  readonly approve: () => void
  /**
   * Approve a proposed plan with a person's edits laid over it — the plan gate's press
   * once something on the card differs from the proposal. A second callback rather than
   * an argument to `approve`, which is handed to `onClick` as it stands and would send the
   * click as the edits.
   */
  readonly approveWith: (edits: PlanEditsDto) => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const approveMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (edits?: PlanEditsDto) => Promise<void> = (edits) => approve(id, edits),
) => ({
  mutationFn,
  // Both, in one promise the mutation waits on. The detail is this screen; the list is
  // the row behind it, whose state, `running` and activity all just changed.
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/**
 * `running` is the detail's `custody.holder !== undefined` — read by the caller rather
 * than fetched here, because this hook must not hold a second opinion about a trak the
 * page already has in hand.
 */
export const useApprove = (id: string, running: boolean): Approval => {
  const cache = useQueryClient()
  const mutation = useMutation(approveMutationOptions(id, cache))
  useScopedTo(id, mutation.reset)
  const disabled = mutation.isPending || running
  const error = mutation.error ?? undefined

  return {
    approve: () => {
      if (disabled) return
      mutation.mutate(undefined)
    },
    approveWith: (edits) => {
      if (disabled) return
      mutation.mutate(edits)
    },
    isPending: mutation.isPending,
    disabled,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : // A status with no explanation, or no answer at all. Deliberately not dressed
            // up as a refusal: the engine did not say this, so the sentence does not
            // pretend it did.
            "Could not send that.",
  }
}
