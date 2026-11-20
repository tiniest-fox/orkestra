/**
 * One step of a proposed plan: what runs it, and what it is told to do.
 *
 * **The name sits above the instruction, never beside it.** That is what lets a top-level
 * step and a step inside a spawn's column be the same object at two widths — a name column
 * of its own needs a measure a 110px column does not have, and a card whose two levels read
 * differently says they are two kinds of thing when they are one.
 *
 * **The mark leads the name, and it is the same mark the plan wears everywhere else** — so
 * a person approving a plan learns the alphabet they will then read the trak by. It is
 * bare rather than on a plate: nothing here has run, so there is no tone to fill one with,
 * and a neutral plate on every step of a nine-piece spawn is nine grey boxes saying
 * nothing. In a column it is what stops the name being the only thing at 110px — the name
 * truncates and the mark does not.
 *
 * **The instruction is never cut.** The plan gate is where a person decides whether to
 * spend on it, and this is the only copy that is whole by contract: the Map's caption — the
 * one other place a step's instruction is drawn — wraps to five lines, which holds a plan
 * step and cuts a full-paragraph piece instruction in a fifth-width column. A `truncate`
 * here is what the trak that produced this file was opened about.
 *
 * **The conversation a step continues is drawn as the key and nothing else**, at the far
 * end of the name's line in the mark's own quiet type. It is a fact about where the turn
 * runs rather than a claim about the work, and the
 * key names no entry on plenty of plans — the turn simply starts fresh — so a rendering
 * that resolved it, counted it or coloured it would be asserting something nothing has
 * yet run to support. The running trak's own marker does resolve it, against the
 * transcript (`rows.ts`), which does not exist at this gate. What makes it worth the
 * room is that a person at the plan gate is the only place a step being put into the
 * conversation it is meant to be judging can be caught.
 *
 * **At the plan gate the same tile is edited in place**, so the four props past
 * `continues` exist for that one caller: `lead` stands where the mark and the name are —
 * an agent step's agent and model pickers — `end` takes the name line's far end for the
 * continues menu and the remove press, `edited` is the dot after the name, and `body`
 * stands where the instruction is — the text as a press that opens a field. The line is
 * centred there rather than set on a baseline, because a press has no baseline to share,
 * and it wraps: on a phone the pickers keep the first row and the end drops to a second.
 */

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

const PlanStep = ({
  mark,
  glyph: Glyph,
  agent,
  instruction,
  continues,
  lead,
  end,
  edited = false,
  body,
}: {
  /** Where this sits in the plan — `3`, or `3·1.2` for the second step of the first piece. */
  readonly mark: string
  /** The agent's own mark, or the kind's where the entry is not one agent's turn. Resolved
   *  by the caller, which is the only thing here holding the library. */
  readonly glyph: LucideIcon
  /** What runs it, or what a spawn is called: the agent, or `5 pieces`. */
  readonly agent: string
  readonly instruction: string
  /**
   * The document whose conversation this step picks up, absent on a fresh one. The key
   * as the composer wrote it — see the header for why nothing resolves it.
   */
  readonly continues?: string
  /** What stands for the glyph and the name at the plan gate. */
  readonly lead?: ReactNode
  /** What the name line ends in at the plan gate, drawn instead of `continues`. */
  readonly end?: ReactNode
  /** Something about the step differs from what the composer proposed. */
  readonly edited?: boolean
  /** What stands where the instruction is, when it is more than the text. */
  readonly body?: ReactNode
}): ReactNode => (
  <div className="flex min-w-0 flex-col gap-0.5">
    <span
      className={`flex min-w-0 gap-1.5 ${lead === undefined && end === undefined ? "items-baseline" : "flex-wrap items-center"}`}
    >
      <span className="shrink-0 font-mono text-2xs text-fg-subtle">{mark}</span>
      {lead ?? (
        <>
          {/* `self-center` rather than sitting on the baseline the two words share: a glyph
              has no baseline of its own, so aligning it to one hangs it low. */}
          <Glyph size={13} aria-hidden className="shrink-0 self-center text-fg-subtle" />
          {/* The one thing on the card that truncates, and only ever in a column: a name is
              a word with a mark beside it, and it is recoverable from the instruction under it. */}
          <span className="min-w-0 truncate font-mono text-2xs uppercase tracking-wider text-fg-subtle">
            {agent}
          </span>
        </>
      )}
      {edited ? (
        // The working ink, because it is the person's own change still in hand.
        <span
          role="img"
          aria-label="edited"
          className="size-1.5 shrink-0 self-center rounded-full bg-tone-working"
        />
      ) : undefined}
      {end !== undefined ? (
        <span className="ml-auto flex shrink-0 items-center gap-1">{end}</span>
      ) : continues === undefined ? undefined : (
        // Pushed to the far end rather than given a slot beside the name, so a step that
        // continues nothing leaves the whole measure to the name.
        <span className="ml-auto flex shrink-0 items-baseline gap-2 font-mono text-2xs text-fg-subtle">
          <span>continues {continues}</span>
        </span>
      )}
    </span>
    {body ?? (
      <p className="min-w-0 whitespace-pre-wrap break-words text-base leading-5 text-fg-muted">
        {instruction}
      </p>
    )}
  </div>
)

export default PlanStep
