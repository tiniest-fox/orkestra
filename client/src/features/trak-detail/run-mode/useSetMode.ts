/**
 * Change a running trak's run mode. **Spends nothing and starts no drive**, and it is the
 * first acting hook here whose press is meant to land while an agent is working.
 *
 * **No `running` argument, and the reason is not the one `useStop` has.** The contract's
 * *disabled while `running`* exists to stop a second drive racing the first; `POST /mode`
 * takes no drive at all — it appends one event and the next gate reads it — so there is no
 * race for the guard to prevent, and a control greyed out while a turn runs would be dead
 * in the case the whole feature exists for: swapping to `manual` because the step now
 * running is the one you want to read. `api/actions.ts` says the same from the wire's side.
 *
 * The two halves that do hold: **disabled while its own mutation is pending**, and **the
 * callback refuses when disabled**. A double press is one event either way — the second
 * would append the same mode again — but the rule is about the shape of an acting hook
 * rather than about what this one's second press would cost.
 *
 * **Both keys, for `useApprove`'s reason**: the detail carries `mode`, and the list's row
 * says what the trak is waiting on. The stream patches `mode` off the next frame too, so
 * the invalidation is the backstop rather than the transport.
 *
 * **Dropped when `id` changes**, `useScopedTo`, because the page keys this to whichever
 * trak owns the position on screen — the header's picker at the trak's own steps, the
 * band's at a piece — and a refusal sentence must not follow a reader to another trak.
 *
 * One refusal, `409 AtRest`, which a stale screen can earn: the trak ended between the
 * poll and the press. The sentence is what that is for.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { setMode } from "../../../api/actions"
import { RefusedError } from "../../../api/http"
import type { RunModeDto } from "../../../api/types"
import { refusalSaid } from "../../../format/refusal"
import { queryKeys } from "../../../queryCache"
import { useScopedTo } from "../../../hooks/useScopedTo"

export interface ModeSetting {
  /** Set it. Silently does nothing while disabled, whatever the control did. */
  readonly set: (mode: RunModeDto) => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const setModeMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (mode: RunModeDto) => Promise<void> = (mode) => setMode(id, mode),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/** Takes no `running`, deliberately — see above. */
export const useSetMode = (id: string): ModeSetting => {
  const cache = useQueryClient()
  const mutation = useMutation(setModeMutationOptions(id, cache))
  useScopedTo(id, mutation.reset)
  const error = mutation.error ?? undefined

  return {
    set: (mode) => {
      if (mutation.isPending) return
      mutation.mutate(mode)
    },
    isPending: mutation.isPending,
    disabled: mutation.isPending,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : "Could not change the mode.",
  }
}
