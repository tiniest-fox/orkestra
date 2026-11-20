/**
 * The break-out presses beside the chat bar's box, on the bar's own ground — the ones that
 * leave the step without waiting for it to finish, and, where a document gate's presses no
 * longer fit on a card, the gate's Approve travelling with them.
 *
 * **Outside the box, because none reads a character of it.** The send acts on the text;
 * *File it* fires a bodiless POST, *Recompose* opens a sheet with a field of its own, and
 * *Approve* takes what is filed. The field pays for it, about 88px at a desk and about
 * 120px of text area at a phone's 358, and that bill is taken knowingly.
 *
 * **Two clusters, and which one is drawn is the page's answer.** Where nothing is filed — a
 * conversation, a question, a stuck account, or a turn still running — the pair is *File
 * it* and *Recompose*, each in a `Reveal` so the field takes the space back when a press
 * leaves. Where a document gate's Approve can no longer sit on its card, because a prose
 * reply is the newest thing at the position, *Approve* takes *File it*'s slot and welds to
 * *Recompose*. The weld is the card's own carried over — recomposing at a document gate
 * commits this step's work first, so pressing it is approving and then some. Never both
 * clusters: the two are `File it`'s gates and Approve's, and they do not overlap.
 *
 * **On a phone the filing pair is one `⋯` at the bar's edge** — `BreakOutMenu`. The welded
 * Approve and Recompose stay as they are at both measures: Approve is the press the gate
 * is asking for, and putting it behind a menu would hide the answer.
 *
 * **A glyph alone on every press drawn here, and `aria-label` is the whole of the name** —
 * the phone's menu items carry words, because a row in a panel has the width. A parcel
 * checked for the filing, a road sign for the recompose, a check mark for the approval.
 * No labels, because with words on, the box at 358 collapses to about 108px — and the
 * marks are not guessable; taken knowingly, for a tool with one user, and nothing
 * on screen resolves them yet. `quiet` and `lg`, because what they line up against is the
 * send — Approve `quiet` too, a plate like its neighbours, rather than carrying its card's
 * accent onto a row the send already lights.
 *
 * **The welded pair is drawn directly rather than through `Reveal`**, because the weld's
 * `:first-child` selector has to reach the buttons and a wrapper between them would break
 * it — the same reason `GatePresses` welds by hand. It is a state change rather than an
 * arrival, so it forgoes the fade the filing pair keeps; the two never share a screen.
 */

import type { ReactNode } from "react"
import { Check, PackageCheck, Route } from "lucide-react"
import Button from "../../../components/Button"
import BreakOutMenu from "./BreakOutMenu"
import Reveal from "./Reveal"
import type { Approval } from "../useApprove"
import type { Filing } from "../useFile"
import type { Recomposing } from "./useRecompose"

const BreakOut = ({
  approving,
  filing,
  recomposing,
  phone,
}: {
  /**
   * The gate's approval, where a prose reply has taken it off its card and it welds to the
   * recompose here instead. `undefined` draws the filing cluster below.
   */
  readonly approving: Approval | undefined
  /** The filing press, where the state offers it. `undefined` collapses it. */
  readonly filing: Filing | undefined
  /** The recompose press, where the state offers it here. `undefined` collapses it. */
  readonly recomposing: Recomposing | undefined
  /** `usePhone`'s answer: the filing pair is one menu below the breakpoint. */
  readonly phone: boolean
}): ReactNode =>
  approving !== undefined ? (
    // Approve nearest the box, Recompose at the edge — the card's order carried over, and
    // the weld its plate. `[&>*:last-child]:border-l-0` drops the seam's doubled border,
    // as `GatePresses` does.
    <span className="flex shrink-0 [&>*:first-child]:rounded-r-none [&>*:last-child]:rounded-l-none [&>*:last-child]:border-l-0">
      <Button
        variant="quiet"
        size="lg"
        icon={Check}
        aria-label="Approve"
        busy={approving.isPending}
        disabled={approving.disabled}
        onClick={approving.approve}
      />
      <Button
        variant="quiet"
        size="lg"
        icon={Route}
        aria-label="Recompose"
        disabled={recomposing === undefined || recomposing.asking}
        onClick={recomposing?.open}
      />
    </span>
  ) : phone ? (
    <BreakOutMenu filing={filing} recomposing={recomposing} />
  ) : (
    <>
      <Reveal shown={filing !== undefined}>
        <Button
          variant="quiet"
          size="lg"
          icon={PackageCheck}
          aria-label="File it"
          busy={filing?.isPending}
          disabled={filing === undefined || filing.disabled}
          onClick={filing?.file}
        />
      </Reveal>
      <Reveal shown={recomposing !== undefined}>
        <Button
          variant="quiet"
          size="lg"
          icon={Route}
          aria-label="Recompose"
          // The sheet is the press that spends, so this one is live while something else
          // drives: it opens a field, and the send inside it is what the custody guard is on.
          disabled={recomposing === undefined || recomposing.asking}
          onClick={recomposing?.open}
        />
      </Reveal>
    </>
  )

export default BreakOut
