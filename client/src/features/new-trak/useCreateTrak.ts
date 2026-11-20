/**
 * Start a trak. **The first thing in this client that spends money**, and the only one
 * that spends it on a trak that does not exist yet.
 *
 * `client-style`'s contract for a hook that acts, in full:
 *
 *   · **disabled while in flight, and non-submittable rather than merely spinning** —
 *     the server cannot tell a deliberate click from a double one, and two would be two
 *     composers;
 *   · **the callback refuses when disabled as well as the button**, so a control that
 *     forgets to read `disabled` still cannot start a second;
 *   · **`onSuccess` returns the invalidation promise**, so `isPending` covers the
 *     refetch and the button stays disabled across the gap instead of flickering
 *     enabled with stale data behind it;
 *   · **nothing auto-fires** — no submit in an effect, no retry on mount. A trak starts
 *     because a person asked, once.
 *
 * There is no `running` to read here, unlike every other acting hook: the trak does not
 * exist until this succeeds, so `isPending` is the whole guard. The second one is
 * structural — a 202 navigates away from this screen.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createTrak } from "../../api/actions"
import type { CreatedDto, RunModeDto } from "../../api/types"
import { queryKeys } from "../../queryCache"

/**
 * What starting one takes. `agent` absent is the ordinary case — the composer plans it;
 * naming one starts a conversation with that agent instead and no composer runs.
 *
 * An object rather than two arguments because a caller passing `undefined` positionally
 * for the common case reads as a hole where something was forgotten.
 *
 * `mode` has no absent case: the screen always holds one, because the choice is
 * remembered from the last trak rather than made afresh each time.
 *
 * `model` is New Chat's, and absent everywhere else: the agent file's own. Required and
 * `undefined` rather than optional, so a door that forgets to say sends nothing by
 * decision rather than by omission.
 */
export interface Start {
  readonly description: string
  readonly agent: string | undefined
  readonly mode: RunModeDto
  readonly model: string | undefined
  /** Whether the engine merges the pull request on its own. New Chat never asks. */
  readonly autoMerge: boolean
  /** Upload ids for the files the description arrived with — none from New Chat. */
  readonly attachments: readonly string[]
}

export interface Started {
  /** Ask for a trak. Silently does nothing while one is already being started. */
  readonly start: (start: Start) => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** `undefined`, never `null` — one representation of absence. */
  readonly error: Error | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const createTrakMutationOptions = (
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (start: Start) => Promise<CreatedDto> = ({
    description,
    agent,
    mode,
    model,
    autoMerge,
    attachments,
  }) => createTrak(description, agent, mode, model, autoMerge, attachments),
) => ({
  mutationFn,
  // The list only — there is no detail to invalidate for a trak that did not exist a
  // moment ago, and the one the caller navigates to is fetched fresh on arrival.
  onSuccess: () => cache.invalidateQueries({ queryKey: queryKeys.traks }),
})

export const useCreateTrak = (onStarted: (id: string) => void): Started => {
  const cache = useQueryClient()
  const mutation = useMutation({
    ...createTrakMutationOptions(cache),
    onSuccess: async (created: CreatedDto) => {
      await cache.invalidateQueries({ queryKey: queryKeys.traks })
      onStarted(created.id)
    },
  })
  const disabled = mutation.isPending
  return {
    start: (asked) => {
      if (disabled) return
      mutation.mutate(asked)
    },
    isPending: mutation.isPending,
    disabled,
    error: mutation.error ?? undefined,
  }
}
