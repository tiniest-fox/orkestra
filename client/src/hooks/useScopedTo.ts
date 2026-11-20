/**
 * Drop what an acting hook is holding when the trak it acts for changes.
 *
 * **A mutation's state belongs to the trak it was fired at, and this drawer moves that trak
 * out from under it.** The page acts for whichever trak owns the position on screen, so one
 * `useApprove` is keyed to the parent at one position and to a piece at the next — and
 * everything the mutation holds would otherwise survive the move: `isPending` draws a press
 * against one trak as busy on another's card, and `said` puts the refusal one trak earned
 * beside the next one's press. The route param moves the same way, for the same reason: a
 * link to a piece redirects into its parent without leaving this component.
 *
 * **It also unhooks a press still in flight from options that have moved on.**
 * `MutationObserver` re-points a *pending* mutation at the newest options each time they are
 * set, so a send at one piece that has not answered by the time the reader steps to another
 * would invalidate the one they stepped to. `reset` drops the observer's hold on it: the
 * request still lands and still invalidates the trak it was sent to, and nothing this hook
 * draws is about it any more.
 *
 * **Adjusted during the render rather than in an effect**, which is React's own answer to
 * *reset state when a prop changes*: an effect leaves one committed frame in which the
 * sentence on screen and the trak a press would act on disagree. `useMutation` reads its
 * result through `useSyncExternalStore`, so the re-render this schedules already sees the
 * reset state.
 *
 * **A draft is not this.** What somebody typed is not dropped when they step away — it is
 * held against the trak it was typed for, so that the words and the addressee cannot come
 * apart in either direction. `useSendChat` carries that half.
 */

import { useState } from "react"

/** `drop` is the mutation's own `reset` — nothing else in an acting hook has anything to drop. */
export const useScopedTo = (id: string | undefined, drop: () => void): void => {
  const [acting, setActing] = useState(id)
  if (acting !== id) {
    setActing(id)
    drop()
  }
}
