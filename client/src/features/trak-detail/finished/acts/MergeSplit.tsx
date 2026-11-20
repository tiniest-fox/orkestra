/**
 * The finished band's merge of a pull request on the forge: GitHub's split button. The press
 * merges with the picked method, and a caret welded to it opens the methods the repository
 * allows, in GitHub's order with the picked one checked. **Picking a row merges nothing** —
 * it records the method on the trak, which the press and auto-merge both read. A repository
 * that allows one method draws the plain press, with no caret.
 *
 * **The press is live on GitHub's verdict alone.** Disabled while GitHub blocks the merge —
 * the band says why above the row — and the caret stays live then, because the method can be
 * changed before the merge is allowed. While the merge runs the press reads *Merging…* and
 * the caret is off.
 *
 * It confirms first, in a panel like Archive's that says what the method does to main, and
 * the trigger is `disabled` until GitHub allows the merge rather than live while its panel is
 * open like Archive's. While GitHub has not worked out whether it merges, the press is the
 * ghost *Checking GitHub…* with no caret.
 *
 * **`block` is the phone's own full-width line above the doors**, the full label and the
 * caret both, with the menu opening upward from that line. **`phone` asks in a
 * `ConfirmSheet`** rather than the panel floated above the press; it closes on confirm, as
 * the panel does, and the press shows busy and any refusal.
 */

import type { ComponentType, KeyboardEvent, ReactNode } from "react"
import { useState } from "react"
import { Check, ChevronDown, GitMerge } from "lucide-react"
import Button from "../../../../components/Button"
import ConfirmSheet from "../../../../components/ConfirmSheet"
import Confirmation from "../../../../components/Confirmation"
import MenuItem from "../../../../components/MenuItem"
import OverflowMenu, { type TriggerProps } from "../../../../components/OverflowMenu"
import { pullMergeWords } from "../finished"
import type { PullMerge } from "../../pull-request/pullRequest"
import type { MergeMethodPick } from "../merge/useSetMergeMethod"
import type { PullMerging } from "../merge/useMergePullRequest"

/**
 * The caret, drawn on the press's own fill with a rule between — one plate, two controls.
 * Module-level, one per state, so `OverflowMenu` keeps the trigger's identity across renders.
 */
const caret = (disabled: boolean): ComponentType<TriggerProps> => {
  const Caret = ({ open, toggle }: TriggerProps): ReactNode => (
    <button
      type="button"
      aria-label="Merge method"
      aria-expanded={open}
      aria-haspopup="menu"
      disabled={disabled}
      onClick={toggle}
      className={`inline-flex h-[30px] items-center justify-center rounded-r-control border-l border-accent-ink/30 bg-accent px-1.5 text-accent-ink transition-colors duration-100 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 max-sm:min-h-11 max-sm:px-3 ${open ? "bg-accent-hover" : ""}`}
    >
      <ChevronDown size={14} aria-hidden />
    </button>
  )
  return Caret
}

const CARET_LIVE = caret(false)
const CARET_OFF = caret(true)

/** The ghost that stands in the press's place while GitHub works out whether it merges. */
export const CheckingPress = ({ block }: { readonly block: boolean }): ReactNode => (
  <Button variant="ghost" busy disabled block={block}>
    Checking GitHub…
  </Button>
)

const MergeSplit = ({
  pull,
  merging,
  methodPick,
  block,
  phone,
}: {
  readonly pull: PullMerge
  readonly merging: PullMerging
  readonly methodPick: MergeMethodPick
  readonly block: boolean
  readonly phone: boolean
}): ReactNode => {
  const [confirming, setConfirming] = useState(false)
  if (pull.verdict === undefined || pull.verdict._tag === "Checking") {
    return <CheckingPress block={block} />
  }
  const words = pullMergeWords(pull.method)
  const heading = `${words.label} #${String(pull.number)}?`
  const choice = pull.methods.length > 1
  const ask = {
    heading,
    press: words.short,
    disabled: merging.disabled,
    onCancel: () => {
      setConfirming(false)
    },
    onConfirm: () => {
      setConfirming(false)
      merging.merge()
    },
  }
  const does = `${words.does} The branch stays on GitHub until you archive the trak.`
  return (
    <span className={`relative flex min-w-0 ${block ? "w-full" : ""}`}>
      {confirming && phone && <ConfirmSheet {...ask}>{does}</ConfirmSheet>}
      {confirming && !phone && (
        /* A dialog by role, and Escape on the container — `ArchiveActs` says why both. Its
           right edge is the press's. At desk it is as wide as `Confirmation`, which is wider
           than the press: capped at the press, its body and its own press spill out of it.
           A phone's press fills the line, so there the line is the cap. */
        <div
          role="dialog"
          aria-label={heading}
          className={`absolute bottom-full right-0 z-10 mb-1.5 rounded-surface border border-border bg-surface shadow-modal ${block ? "w-fit max-w-full" : "w-max max-w-[calc(100vw-2rem)]"}`}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Escape") setConfirming(false)
          }}
        >
          <Confirmation {...ask}>{does}</Confirmation>
        </div>
      )}
      {/* The caret's `OverflowMenu` is the second child, so the press is the first and loses
          its right-hand corners to the weld; a phone's press takes the line the caret leaves. */}
      <span
        className={`flex min-w-0 items-stretch ${choice ? "[&>button:first-child]:rounded-r-none" : ""} ${block ? "w-full [&>button:first-child]:min-w-0 [&>button:first-child]:flex-1" : ""}`}
      >
        <Button
          variant="primary"
          icon={GitMerge}
          busy={merging.isPending}
          // The hook refuses an unready press too; this is the drawn half of the same fact.
          disabled={merging.disabled || pull.verdict._tag !== "Mergeable"}
          onClick={() => {
            setConfirming(true)
          }}
        >
          {merging.isPending ? "Merging…" : words.label}
        </Button>
        {choice && (
          <OverflowMenu up trigger={merging.isPending ? CARET_OFF : CARET_LIVE}>
            {(shut) =>
              pull.methods.map((method) => {
                const row = pullMergeWords(method)
                return (
                  <MenuItem
                    key={method}
                    role="menuitemradio"
                    checked={method === pull.method}
                    onClick={() => {
                      if (method !== pull.method) methodPick.pick(method)
                      shut()
                    }}
                  >
                    <span className="flex items-start gap-2">
                      <span className="mt-0.5 w-4 shrink-0 text-accent">
                        {method === pull.method && <Check size={14} aria-hidden />}
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5 whitespace-normal">
                        <span className="font-medium">{row.menu}</span>
                        <span className="text-sm leading-snug text-fg-muted">{row.does}</span>
                      </span>
                    </span>
                  </MenuItem>
                )
              })
            }
          </OverflowMenu>
        )}
      </span>
    </span>
  )
}

export default MergeSplit
