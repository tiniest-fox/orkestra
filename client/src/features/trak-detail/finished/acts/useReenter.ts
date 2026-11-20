/**
 * Send a trak that had stopped back for more work, or ask it something. **The seventh
 * acting hook, and the fifth that spends money** — what is sent goes to the composer, which
 * runs and adds steps to the plan, unless the press that sent it named an agent, in which
 * case one turn of that agent runs on it and no plan is written.
 *
 * **The hook does not know which door it is**, and takes the agent from the press rather
 * than holding a mode: the box switches three strings and this field, both decided by
 * `doorWords` at the one place the two presses are drawn. Everything else here — the draft,
 * the refusal, the invalidations — is the same on both paths, because a re-entry is a
 * re-entry whoever reads it.
 *
 * **Never a bare press.** `POST /reenter` requires `what`, so the control that sends this
 * has to have something to say first — which is also why the button that opens the box and
 * the button that submits it are two different presses with two different words.
 *
 * **`send` takes the body rather than reading it back off the draft.** On the finished
 * pane's pull-request half a person ticks failing checks, review conversations and the
 * forge's refusal, and `reentryBody` composes those and the sentence into one string — so
 * the draft here is the sentence alone and the caller owns what is actually sent.
 *
 * **The draft lives here, for `useSendChat`'s reason.** A field is local UI state and
 * belongs in the component until *clearing it* becomes a decision: clearing on send loses a
 * paragraph the engine refused, and clearing on success means the only thing that knows
 * when to clear is the mutation. So it moves in beside the thing that decides. The factory
 * below stays free of it, so the two invalidations are still tier-1.
 *
 * **And it is held per trak, for `useSendChat`'s other reason** — the page keys this to
 * whichever trak owns the position, and a piece's ending row is one step from another
 * piece's. What that costs if it is got wrong is worse here than at the bar: sending back a
 * *finished* trak re-opens it, with somebody else's instructions.
 *
 * **Which states offer this is still narrower than what the route accepts**: every at-rest
 * state re-enters and this surface offers the three that have an ending pane, which leaves
 * `Abandoned`, where there is nowhere to draw a press. `controls.ts`'s `changesOffered`
 * carries why, and why `Merged` stopped being the other one.
 */

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { reenterTrak } from "../../../../api/actions"
import { RefusedError } from "../../../../api/http"
import { refusalSaid } from "../../../../format/refusal"
import { queryKeys } from "../../../../queryCache"
import { useScopedTo } from "../../../../hooks/useScopedTo"

/** One press, whole: the body it composed and the door it went through. */
export interface Reentry {
  readonly what: string
  /** The agent to run on it, or absent for the composer — `reenterTrak` says which names. */
  readonly agent: string | undefined
  /** The pull request's base branch where its refusal to merge was ticked — `pickedBase`. */
  readonly base: string | undefined
}

export interface Changes {
  /**
   * The sentence in the field, for the trak this hook is keyed to. Survives a refusal — that
   * is the whole reason it is here — and stays with that trak when a reader steps to another.
   *
   * **The sentence, not the body that is sent.** A finished pane with a pull request on it
   * composes several ticked things around this one, which is why `send` takes what to send
   * rather than reading it back off here.
   */
  readonly what: string
  readonly write: (value: string) => void
  /**
   * Send it back, with the body the caller composed — `reentryBody`, which is the sentence
   * above plus whatever was ticked — and the agent the press that fired names, if it names
   * one. Silently does nothing while disabled or where the body is blank, whatever the
   * control did.
   */
  readonly send: (body: string, agent?: string, base?: string) => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const reenterMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (sent: Reentry) => Promise<void> = (sent) =>
    reenterTrak(id, sent.what, sent.agent, sent.base),
) => ({
  mutationFn,
  // Both: re-entering takes the trak out of rest and starts a turn — the composer's or the
  // named agent's — which moves the detail on this screen and the row in the list behind it.
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/** `running` is the detail's `custody.holder !== undefined`, for `useApprove`'s reason. */
export const useReenter = (id: string, running: boolean): Changes => {
  const cache = useQueryClient()
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({})
  const what = drafts[id] ?? ""
  const options = reenterMutationOptions(id, cache)
  const mutation = useMutation({
    ...options,
    // The factory's own invalidation, awaited rather than repeated, and the field emptied
    // only once it has answered. `isPending` covers the gap either way — and `id` is the
    // trak the press was fired at, for the reason `useSendChat` records.
    onSuccess: async () => {
      await options.onSuccess()
      setDrafts((held) => ({ ...held, [id]: "" }))
    },
  })
  useScopedTo(id, mutation.reset)
  const disabled = mutation.isPending || running
  const error = mutation.error ?? undefined

  return {
    what,
    write: (value) => {
      setDrafts((held) => ({ ...held, [id]: value }))
    },
    send: (body, agent, base) => {
      // Blank is refused here rather than by the engine: an agent spawned to read nothing
      // spends the same as one spawned to read a paragraph, and the body is the whole of
      // what it is being told — the more so through the ask door, where the sentence is
      // not a brief for a plan but the entire question.
      if (disabled || body.trim() === "") return
      mutation.mutate({ what: body.trim(), agent, base })
    },
    isPending: mutation.isPending,
    disabled,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : "Could not send that back.",
  }
}
