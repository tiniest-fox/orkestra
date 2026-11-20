/**
 * Say something to the trak. **The third thing in this client that spends money**, and
 * the first that spends it on words somebody typed.
 *
 * `client-style`'s contract for a hook that acts holds here as it does for `useApprove`
 * — non-submittable while in flight, the callback refusing when disabled, `onSuccess`
 * returning the invalidation, and nothing auto-firing — with one difference: **custody
 * alone does not disable it.** A send while a turn or a check runs is kept by the engine
 * and read by the agent, so the page hands in `blocked`, which is custody *and* a state
 * that keeps nothing (`messageKept`). That file carries the argument for each; what is
 * new here is the draft.
 *
 * **What the engine hands back goes into the draft, once.** A stop takes every message
 * still waiting, and so does the trak coming to rest; `returned` is that text on the
 * wire, and it is laid into this trak's field ahead of whatever is being typed there.
 * Applied during render and remembered by its text, so the same hand-back is not laid in
 * twice and an effect is not what does it.
 *
 * **The draft lives in the hook, and that is not where the New Trak drawer keeps its
 * one.** A field is local UI state and belongs in the component — until clearing it
 * becomes a decision. Clearing on send loses a paragraph the engine refused; clearing on
 * success means the only thing that knows when to clear is the mutation, and a component
 * cannot be told by one it does not hold. So it moves in beside the thing that decides.
 * The factory below stays free of it, so the two invalidations are still tier-1.
 *
 * **And it is held per trak, because the addressee moves under the bar.** The page keys this
 * hook to whichever trak owns the position on screen and the bar itself never unmounts, so a
 * single field would carry a sentence typed at one piece's gate to the next piece a reader
 * stepped to — and nothing on screen names the addressee. A map keyed by trak id answers
 * both directions at once: what was typed is still there on the way back, and a send that
 * lands clears the trak *it* was sent to rather than whatever is on screen when it answers.
 *
 * **Which position it reaches is not asked here.** The server reads the gate off `state`
 * and takes the step from it, so the message lands where the trak is being asked — never
 * at the row the drawer happens to be showing. What the bar does about that is
 * `chatClosed`, which shuts it rather than sending somewhere else.
 */

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { sendChat } from "../../../api/actions"
import { RefusedError } from "../../../api/http"
import { refusalSaid } from "../../../format/refusal"
import { queryKeys } from "../../../queryCache"
import { useScopedTo } from "../../../hooks/useScopedTo"
import { type Attachments, useAttachments } from "../../../hooks/useAttachments"

export interface Chat {
  /**
   * What is in the field, for the trak this hook is keyed to. Survives a refusal — that is
   * the whole reason it is here — and survives a step onto another trak's position, where
   * it waits rather than following the reader.
   */
  readonly draft: string
  readonly write: (value: string) => void
  /** Send the draft. Silently does nothing while disabled or blank, whatever the bar did. */
  readonly send: () => void
  readonly isPending: boolean
  readonly disabled: boolean
  /** Why the last send did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
  /**
   * The files attached to the draft, held per trak as the draft is and emptied with it
   * once the engine has taken the message.
   */
  readonly attached: Attachments
}

/** What one send carries: the words, and the upload ids of the files attached to them. */
interface Saying {
  readonly message: string
  readonly attachments: readonly string[]
}

/** Injectable so the decisions here are reachable without React or a network. */
export const sendChatMutationOptions = (
  id: string,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (said: Saying) => Promise<void> = ({ message, attachments }) =>
    sendChat(id, message, attachments),
) => ({
  mutationFn,
  // Both, in one promise the mutation waits on — saying something starts a turn, so the
  // detail on this screen and the row behind it both change.
  onSuccess: () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.trak(id) }),
      cache.invalidateQueries({ queryKey: queryKeys.traks }),
    ]),
})

/**
 * A draft with what the engine handed back laid in ahead of it, a blank line between
 * each — the order they were typed in, and then whatever is being typed now.
 */
export const withReturned = (returned: readonly string[], draft: string): string =>
  [...returned, draft].filter((text) => text.trim() !== "").join("\n\n")

/**
 * `blocked` is whether a send now would be refused as a second drive — custody held at a
 * state that keeps no message — and `returned` is `TrakDetailDto.returned`. Both are
 * read by the caller rather than fetched here, because this hook must not hold a second
 * opinion about a trak the page already has in hand.
 */
export const useSendChat = (id: string, blocked: boolean, returned: readonly string[]): Chat => {
  const cache = useQueryClient()
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({})
  // The hand-back last laid into each trak's field, by its text. Cleared when the engine
  // withdraws it, so the same words handed back a second time are laid in again.
  const [taken, setTaken] = useState<Readonly<Record<string, string>>>({})
  const offered = returned.join("\n\n")
  if ((taken[id] ?? "") !== offered) {
    setTaken((held) => ({ ...held, [id]: offered }))
    setDrafts((held) => ({ ...held, [id]: withReturned(returned, held[id] ?? "") }))
  }
  const draft = drafts[id] ?? ""
  const attached = useAttachments(id)
  const options = sendChatMutationOptions(id, cache)
  const mutation = useMutation({
    ...options,
    // The factory's own invalidation, awaited rather than repeated, and the field emptied
    // only once it has answered. `isPending` covers the gap either way.
    //
    // **`id` here is the trak the press was fired at**, not the one on screen when it
    // answers: react-query builds the mutation from the options of the render the press
    // happened in, and `useScopedTo` unhooks it from later ones. So a slow send at a piece
    // a reader has stepped away from empties its own field and never theirs.
    onSuccess: async () => {
      await options.onSuccess()
      setDrafts((held) => ({ ...held, [id]: "" }))
      // This render's `clear`, so it empties the box of the trak the press was sent to.
      attached.clear()
    },
  })
  useScopedTo(id, mutation.reset)
  const disabled = mutation.isPending || blocked
  const error = mutation.error ?? undefined

  return {
    draft,
    write: (value) => {
      setDrafts((held) => ({ ...held, [id]: value }))
    },
    send: () => {
      // Blank is refused here rather than by the engine: a turn spawned to read nothing
      // spends the same as one spawned to read a sentence.
      // A file still uploading has no id yet, so a send now would leave it behind.
      if (disabled || draft.trim() === "" || attached.uploading) return
      mutation.mutate({ message: draft.trim(), attachments: attached.ids })
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
    attached,
  }
}
