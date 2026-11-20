/**
 * The document a step filed: its sections, and what it raised beside them.
 *
 * **Every section opens, and each one can still be folded.** Folding all but the first
 * would make a long document fit the pane, and it would do it by hiding what the person at
 * the gate is there to read: a cost named in a folded section gets approved unseen. A card
 * that scrolls is cheaper than a gate that
 * cannot see. The lever that would have made it fit is the section count, which is the
 * briefs' job (`.orkestra/ORKESTRA.md`), not this file's.
 *
 * **The rhythm is the figures' rhythm**: a title at 13px semibold, its body
 * in full ink with no indent under it, and 32px between sections — so a section reads as a
 * heading over prose and figures rather than as a fold with a note tucked inside it.
 *
 * No box and no gate: this is the body alone, so a card can hold it and so can a tab.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { CorrectionDto, DecidedDto, DocumentDto } from "../../../../api/types"
import EmptySection from "../../../../components/EmptySection"
import Markdown from "../../../../components/Markdown"
import { plainText } from "../../../../format/markdown"

const Section = ({ title, body }: { readonly title: string; readonly body: string }): ReactNode => {
  const [open, setOpen] = useState(true)

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
        }}
        className="flex min-w-0 items-baseline gap-1.5 rounded-control text-left hover:bg-hover-row"
      >
        {open ? (
          <ChevronDown size={12} className="shrink-0 self-center text-fg-subtle" />
        ) : (
          <ChevronRight size={12} className="shrink-0 self-center text-fg-subtle" />
        )}
        <span className="shrink-0 text-base font-semibold text-fg">{title}</span>
        {/* The markers stripped rather than the string as written: this line has one
            line's room, so `**What exists**` spends four of its characters showing the
            reader punctuation. `plainText` says why it is allowed to be approximate. */}
        {open ? undefined : (
          <span className="min-w-0 truncate text-sm text-fg-subtle">{plainText(body)}</span>
        )}
      </button>
      {open ? (
        <div className="text-fg">
          <Markdown>{body}</Markdown>
        </div>
      ) : undefined}
    </div>
  )
}

const ArtifactBody = ({
  document,
  requirements,
  corrections,
  uncovered,
}: {
  readonly document: DocumentDto
  /**
   * What this step settled — the list off its own envelope, not the trak's.
   *
   * `RecordedDto` would type-check too, and taking it is what put the accumulated
   * channel under every card. `DecidedDto` is the narrower of the two and is all this
   * draws, so the wrong list no longer fits through here.
   */
  readonly requirements: readonly DecidedDto[]
  /** Documents this step says are not good enough to work from. Absent on almost every one. */
  readonly corrections?: readonly CorrectionDto[]
  /**
   * The half of what `requirements` absorbed that carried work the plan did not have —
   * on envelopes filed before the merge, and what `kind: "unplanned_work"` says on one
   * filed since. Drawn under its own heading rather than folded in because it is prose
   * and not an entry: it has no `source`, so a dot beside it would be invented.
   */
  readonly uncovered?: readonly string[]
}): ReactNode => {
  const sections = Object.entries(document.sections)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {sections.length === 0 ? (
        <EmptySection shape="decisions">This step filed a document with no sections.</EmptySection>
      ) : (
        <div className="flex min-w-0 flex-col gap-8">
          {sections.map(([title, body]) => (
            <Section key={title} title={title} body={body} />
          ))}
        </div>
      )}

      {corrections === undefined || corrections.length === 0 ? undefined : (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          {/* Its own section rather than a section of the document, for the reason it is
              its own field on the wire: nothing else has one, and approving an artifact
              that carries these is not simply *run the next step*. */}
          <span className="text-sm font-medium text-tone-waiting">
            Not good enough to work from
          </span>
          <ul className="flex list-disc flex-col gap-0.5 pl-4">
            {corrections.map((c) => (
              <li key={`${c.at}:${c.text}`} className="text-base leading-5 text-fg-muted">
                <span className="font-medium text-fg-subtle">{c.at}</span> — {c.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {uncovered === undefined || uncovered.length === 0 ? undefined : (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <span className="text-sm font-medium text-tone-waiting">Work the plan does not have</span>
          <ul className="flex list-disc flex-col gap-0.5 pl-4">
            {uncovered.map((u) => (
              <li key={u} className="text-base leading-5 text-fg-muted">
                {u}
              </li>
            ))}
          </ul>
        </div>
      )}

      {requirements.length === 0 ? undefined : (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <span className="text-sm font-medium text-fg-subtle">Requirements</span>
          {requirements.map((d) => (
            <span key={d.text} className="flex items-baseline gap-2">
              {/* Who decided, not how it is going — `styles.css` argues at length that
                  this is a different axis from `tone` and must not become a sixth one.
                  Both sides are a source: the accent means *act on this*, which a
                  decision already recorded is not. */}
              <span
                className={`mt-1.5 size-1.5 shrink-0 rounded-pill ${
                  d.source === "assumed" ? "bg-source-machine" : "bg-source-human"
                }`}
              />
              <span className="min-w-0 text-base leading-5 text-fg-muted">
                {/* Inside the text and not beside it, so it wraps with the sentence it
                    qualifies rather than holding a column open on every other row. The
                    four kinds that route nowhere are unmarked: a label on all five
                    would be a taxonomy again, and what a person at this gate is being
                    asked about is which of these is about to redraw the plan. */}
                {d.kind === "unplanned_work" ? (
                  <span className="mr-1.5 font-mono text-2xs uppercase tracking-wider text-tone-waiting">
                    redraws the plan
                  </span>
                ) : undefined}
                {d.text}
                {/* What it replaces, after the text for the reason the marker is
                    before it: a person at this gate reads the claim that is true now
                    and then which document or requirement it is written over. */}
                {d.supersedes === undefined ? undefined : (
                  <span className="ml-1.5 font-mono text-2xs text-fg-subtle">
                    supersedes {d.supersedes.join(", ")}
                  </span>
                )}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default ArtifactBody
