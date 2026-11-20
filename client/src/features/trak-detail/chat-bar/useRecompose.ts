/**
 * Send the composer your words from a step gate. **The fourteenth acting hook, and the
 * one whose press is two presses: the sheet, then the send.**
 *
 * `client-style`'s contract for a hook that acts holds here exactly as it does for
 * `useApprove` — non-submittable while in flight, the callback refusing when disabled,
 * `onSuccess` returning the invalidation, and nothing auto-firing. **It takes no `running`,
 * where it once did**, because custody now decides whether the press *exists*, in
 * `recomposeOffered`, and one way up at each of the two places it is offered: at a gate the
 * route is `/act` with `startDrive`, refused while anything drives, so the press is withheld
 * there; mid-turn the route takes the drive over, so the press exists *because* something is
 * running — the shape `useFile` and `useStop` take. A hook that also disabled on `running`
 * would draw a permanently dead send in exactly the mid-turn case the press exists for.
 * What is new here is the sheet.
 *
 * **The sheet's state lives in the hook, for the reason `useSendChat`'s draft does.** Open
 * and shut is local UI state until shutting becomes a decision: the sheet has to close when
 * the send lands and stay open, refusal and draft intact, when it does not — and only the
 * mutation knows which. So `asking` moves in beside the thing that decides, and so does
 * the draft, held per trak id for the reason the chat bar's is: the page keys this hook to
 * whichever trak owns the position on screen, and a reason typed at one piece's gate must
 * not be sent to the next one a reader stepped to, nor lost on the way back.
 *
 * **The chat bar is never armed for this.** The reason is typed in the sheet, at both the
 * bar and the card header, because Enter must not mean two things at once, and the header's
 * press is a document away from the bar.
 *
 * **What the press does first is the same at every gate, and the sheet's words say which
 * gate it is.** The engine commits this step's work before the composer runs whether or
 * not a document was filed — at a gate with one, pressing it is taking the work as well.
 * Nothing here reads a `_tag` — `workAwaitsApproval` answers that at the page and the
 * sheet is told.
 *
 * **Both keys, for `useApprove`'s reason** — a replan moves the trak into `Composing`,
 * which changes the detail on this screen and the row in the list behind it.
 */

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { replan } from "../../../api/actions"
import { RefusedError } from "../../../api/http"
import { refusalSaid } from "../../../format/refusal"
import { queryKeys } from "../../../queryCache"
import { useScopedTo } from "../../../hooks/useScopedTo"

export interface Recomposing {
  /** Whether the sheet is open — the press was taken and the reason is being typed. */
  readonly asking: boolean
  /** Open the sheet. */
  readonly open: () => void
  /** Shut the sheet without sending. The draft is kept. */
  readonly cancel: () => void
  /** What is in the sheet's field, for the trak this hook is keyed to. */
  readonly draft: string
  readonly write: (value: string) => void
  /** Send the draft. Silently does nothing while disabled or blank, whatever the sheet did. */
  readonly send: () => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last send did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Injectable so the decisions here are reachable without React or a network. */
export const recomposeMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (reason: string) => Promise<void> = (reason) => replan(id, reason),
) => ({
  mutationFn,
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

export const useRecompose = (id: string): Recomposing => {
  const cache = useQueryClient()
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({})
  const [asking, setAsking] = useState(false)
  const draft = drafts[id] ?? ""
  const options = recomposeMutationOptions(id, cache)
  const mutation = useMutation({
    ...options,
    // The factory's own invalidation, awaited rather than repeated; the sheet shut and its
    // field emptied only once it has answered. `id` is the trak the press was fired at,
    // for `useSendChat`'s reason.
    onSuccess: async () => {
      await options.onSuccess()
      setAsking(false)
      setDrafts((held) => ({ ...held, [id]: "" }))
    },
  })
  // The sheet shuts with the mutation's state: a sheet left open across a step to another
  // trak would be asking about a gate that is no longer on screen.
  useScopedTo(id, () => {
    mutation.reset()
    setAsking(false)
  })
  const disabled = mutation.isPending
  const error = mutation.error ?? undefined

  return {
    asking,
    open: () => {
      setAsking(true)
    },
    cancel: () => {
      setAsking(false)
    },
    draft,
    write: (value) => {
      setDrafts((held) => ({ ...held, [id]: value }))
    },
    send: () => {
      // Blank is refused here rather than by the engine: a composer run to read nothing
      // spends the same as one run to read a paragraph.
      if (disabled || draft.trim() === "") return
      mutation.mutate(draft.trim())
    },
    isPending: mutation.isPending,
    disabled,
    said:
      error === undefined
        ? undefined
        : error instanceof RefusedError
          ? refusalSaid(error.refusal)
          : "Could not send that.",
  }
}
