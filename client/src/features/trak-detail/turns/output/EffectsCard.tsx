/**
 * What a step's effects did once its work was on the branch, and what they printed.
 *
 * **It draws a success, which is what separates it from every other plate in the
 * pane.** `CheckFailure` and `FailedNotice` are there because something went wrong;
 * this is there because something *left the checkout*, and nothing else on the
 * surface can say so. A pull request's URL is a line a script printed and is on
 * screen nowhere else.
 *
 * **The time is part of the claim, not a caption.** Nothing here polls the world the
 * script acted on, so what is drawn is what it saw when it ran — and the header says
 * when that was, so a reader is never invited to read it as a fact about now. An ISO
 * stamp because nothing in this package renders a time any better yet;
 * `TrakDetailsView` carries the same gap and the same note.
 *
 * `AnsiText` for the output, on `CheckFailure`'s reasoning: these are bytes a spawned
 * process wrote, `gh` colours through a pipe, and the component is a no-op on plain
 * text.
 *
 * **A skip draws here too**, as the note on the step: one line per effect a person's skip
 * kept from running, and a header that says it was skipped rather than that it acted.
 */

import type { ReactNode } from "react"
import { Send, SkipForward, TriangleAlert } from "lucide-react"
import AnsiText from "../../../../components/AnsiText"
import type { RanEffect } from "../../filed"

/** The header line for one effect: what ran, and — for the one that stopped it — that it did not. */
const heading = (effect: RanEffect): string =>
  effect.failed ? `${effect.name} could not do it` : effect.name

/** The header: when the run acted, or when a person skipped it. */
const stamp = (skipped: boolean, at: number | undefined): string => {
  const verb = skipped ? "skipped" : "acted"
  return at === undefined
    ? `${verb} outside this checkout`
    : `${verb} at ${new Date(at).toISOString()}`
}

const EffectsCard = ({
  effects,
  skipped,
  at,
}: {
  readonly effects: readonly RanEffect[]
  /** The effects a person's skip kept from running. Absent where nobody skipped. */
  readonly skipped?: readonly string[]
  /** When the engine wrote the run down. Absent on a log written before it stamped one. */
  readonly at: number | undefined
}): ReactNode => (
  <div className="min-w-0 rounded-surface border border-border bg-surface px-3 py-2.5">
    <div className="flex min-w-0 flex-col gap-2">
      <span className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-fg-subtle">
        {skipped === undefined ? <Send size={11} /> : <SkipForward size={11} />}
        {stamp(skipped !== undefined, at)}
      </span>
      {skipped?.map((name) => (
        <span
          key={name}
          className="flex min-w-0 items-center gap-1.5 break-all font-mono text-2xs text-fg-muted"
        >
          {name} did not run — skipped
        </span>
      ))}
      {effects.map((effect) => (
        <div key={effect.name} className="flex min-w-0 flex-col gap-1.5">
          <span
            className={`flex items-center gap-1.5 font-mono text-2xs ${
              effect.failed ? "text-tone-bad" : "text-fg-muted"
            }`}
          >
            {effect.failed ? <TriangleAlert size={11} /> : undefined}
            {heading(effect)}
          </span>
          {/* Empty output is ordinary — a script that did its job quietly — and a plate
              with nothing in it reads as a failure to load. */}
          {effect.output === "" ? undefined : (
            <div
              className={`min-w-0 overflow-hidden rounded-control border p-2 ${
                effect.failed ? "border-tone-bad/40" : "border-border"
              }`}
            >
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs text-fg-muted">
                <AnsiText text={effect.output} />
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
)

export default EffectsCard
