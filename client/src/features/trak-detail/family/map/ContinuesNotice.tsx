/**
 * The sentence at the head of a position that was put into an earlier position's
 * conversation — drawn while the step runs and after it, not only on the proposal card
 * at the plan gate.
 *
 * **The words never claim more than the transcript shows.** Joined: the sentence names
 * the key and the whole notice is the press to the position holding the conversation —
 * and it says nothing about turns being drawn there, because a joined conversation can
 * sit under a position that has filed nothing yet. Fresh: the key named nothing that had
 * run, the turn started under a session of its own, and the sentence says so with no
 * press because there is nowhere to go. Neither yet: the turn has no session to compare,
 * and nothing is drawn rather than either claim.
 *
 * **A joined notice says what the conversation had already spent**, because that figure
 * means something only where this sentence is drawn — it is the spend this position's
 * window started with, and no other surface shows it. Absent where nothing was measured
 * there, rather than *0 tokens*.
 *
 * **The whole notice is the press, never the key inside it.** The key is inline 2xs text
 * in a wrapping sentence, which cannot clear the 44px touch floor on its own — so the
 * notice is the button and `max-sm:min-h-11` is what pays the floor, while the accent
 * and the underline stay on the key, where the destination is named.
 */

import type { ReactNode } from "react"
import { ContinuesGlyph } from "./ContinuesMark"
import { tokens } from "../../tokens/usage"
import type { Continues } from "../rows"

const ContinuesNotice = ({
  continues,
  carried,
  onGo,
}: {
  readonly continues: Continues
  /** What the joined conversation spent before this position, in tokens. */
  readonly carried: number | undefined
  /** Moves the drawer to the position holding the conversation. */
  readonly onGo: (key: string) => void
}): ReactNode => {
  const { key, to, fresh } = continues
  if (to !== undefined)
    return (
      <button
        type="button"
        onClick={() => onGo(to)}
        className="flex min-w-0 items-center gap-2 rounded-surface border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-hover-row max-sm:min-h-11"
      >
        <ContinuesGlyph size={14} className="shrink-0 text-fg-subtle" aria-hidden />
        <span className="min-w-0 text-sm text-fg-muted">
          This turn continues the conversation at{" "}
          <span className="font-mono text-accent underline decoration-dotted underline-offset-2">
            {key}
          </span>
          {carried === undefined ? "." : `, carrying in ${tokens(carried)} tokens.`}
        </span>
      </button>
    )
  if (!fresh) return undefined
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-surface border border-border bg-surface px-3 py-2">
      <ContinuesGlyph size={14} className="shrink-0 text-fg-subtle" aria-hidden />
      <span className="min-w-0 text-sm text-fg-muted">
        This turn was put into the conversation at <span className="font-mono text-fg">{key}</span>,
        which no position on this plan filed. It started fresh.
      </span>
    </div>
  )
}

export default ContinuesNotice
