/**
 * What a composer handed off to traks of its own — drawn on the card that offers the
 * plan gate, and again once the gate has gone past and the traks exist.
 *
 * **It sits outside the numbered list, under its own label, with the base branch on that
 * label.** Nothing else distinguishes a hand-off from a spawn: both are traks this plan
 * creates, and only one of them comes back. Geometry carries the difference — a spawn is
 * a tile inside the order, this is a region after it — and the branch name says where the
 * work goes. No words say *does not come back*: every phrasing of it reads as clutter.
 *
 * **One label over the set, never one per member.** The label is what says *these are
 * not steps*; repeated three times it is three chances to be read as three of whatever the
 * reader first took the block for. Several stack as separate boxes under it.
 *
 * `HandedUp`'s treatment throughout — the machine tint at 10%, the mono label in the
 * machine ink, the glyph at 11px — because a composer wrote both and they are the two
 * blocks on this surface addressed to somebody other than the reader.
 *
 * **Afterwards the block stops arguing and starts pointing.** Once `opened` names the
 * traks, the label goes past tense, each trak is a link, the descriptions are dropped and
 * so is the branch: all of it is now true of something the reader can go and read.
 *
 * **On a goal's trak nothing opens**: the hand-off goes to the goal's composer. The label
 * says so and carries no branch, and afterwards the block keeps the descriptions — there
 * is no trak to point at — under a label that links to the goal.
 */

import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { GitBranchPlus, SquareArrowOutUpRight, Target } from "lucide-react"
import { type HandOffBase, newTraks } from "./handOff"

const LABEL =
  "flex min-w-0 items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-source-machine"
const BOX = "rounded-surface bg-source-machine/10 px-3 py-2.5"

/**
 * The base, at the far end of the label line. A chip where the repository names one;
 * where it does not, the same chip says so, because approving would then fail on exactly
 * that and the card is where a person can still not press.
 */
const Base = ({ base }: { readonly base: string | undefined }): ReactNode => (
  <span className="ml-auto flex shrink-0 items-center gap-1.5">
    <span className="font-mono text-2xs normal-case tracking-normal text-fg-subtle">from</span>
    <span className="shrink-0 rounded-control bg-fg/5 px-1.5 py-px font-mono text-2xs normal-case tracking-normal text-fg-subtle">
      {base ?? "no default branch"}
    </span>
  </span>
)

/** The descriptions, one box each, in the composer's words. */
const Texts = ({ texts }: { readonly texts: readonly string[] }): ReactNode =>
  texts.map((text) => (
    <div key={text} className={`min-w-0 ${BOX}`}>
      <p className="min-w-0 whitespace-pre-wrap text-base leading-5 text-fg-muted">{text}</p>
    </div>
  ))

/**
 * The block once the gate went past on a goal's trak: what went to the goal, and a way there.
 * The label line is the link, so it grows to the touch floor below the breakpoint.
 */
const SentToGoal = ({
  texts,
  goal,
}: {
  readonly texts: readonly string[]
  readonly goal: string
}): ReactNode => (
  <section aria-label="Sent to the goal" className="flex min-w-0 flex-col gap-2">
    <Link
      to="/goals/$id"
      params={{ id: goal }}
      className={`${LABEL} hover:underline max-sm:min-h-11`}
    >
      <Target size={11} strokeWidth={2.5} aria-hidden className="shrink-0 translate-y-px" />
      <span className="min-w-0 truncate">
        {texts.length === 1 ? "Sent to the goal" : `Sent to the goal · ${String(texts.length)}`}
      </span>
    </Link>
    <Texts texts={texts} />
  </section>
)

const HandOffs = ({
  texts,
  base,
  opened,
}: {
  /**
   * The descriptions, in the composer's own words, one per trak. Once `opened` names
   * the traks only the length is read, so a caller holding the ids and not the
   * descriptions passes those — `FinishedView`, which has the log and not the answer.
   */
  readonly texts: readonly string[]
  /**
   * The branch each is cut from, while the plan is on the table — `TrakDetailDto.handOffBase`,
   * absent where the repository has no default branch to name — or the goal they go to.
   */
  readonly base: HandOffBase
  /**
   * The trak ids, once the gate went past and named them — `openedAt`. `undefined` is the
   * gate still open, and the block argues; a list is the traks existing, and it points.
   */
  readonly opened: readonly string[] | undefined
}): ReactNode => {
  if (texts.length === 0) return undefined
  const n = texts.length
  // No ids is the gate gone past on a going goal's trak; a trak whose goal was at rest by
  // then opened traks, and is pointed at as any other.
  if (opened?.length === 0 && typeof base === "object") {
    return <SentToGoal texts={texts} goal={base.goal} />
  }
  if (opened !== undefined) {
    return (
      <section aria-label="Opened as new traks" className={`flex min-w-0 flex-col gap-2 ${BOX}`}>
        <span className={LABEL}>
          <GitBranchPlus
            size={11}
            strokeWidth={2.5}
            aria-hidden
            className="shrink-0 translate-y-px"
          />
          <span className="min-w-0 truncate">
            {n === 1 ? "Opened as a new trak" : `Opened as ${newTraks(n)}`}
          </span>
        </span>
        {opened.map((id) => (
          // A link rather than a name in prose: the whole value of the record is that the
          // other trak is one press away.
          <Link
            key={id}
            to="/traks/$id"
            params={{ id }}
            className="flex min-w-0 items-center gap-1.5 text-base leading-5 text-fg underline decoration-border underline-offset-2 hover:decoration-fg-subtle"
          >
            <span className="min-w-0 truncate">{id}</span>
            <SquareArrowOutUpRight size={11} aria-hidden className="shrink-0 text-fg-subtle" />
          </Link>
        ))}
      </section>
    )
  }
  return (
    <section
      aria-label={typeof base === "object" ? "Work for the goal" : "Work for a new trak"}
      className="flex min-w-0 flex-col gap-2"
    >
      <span className={LABEL}>
        <GitBranchPlus
          size={11}
          strokeWidth={2.5}
          aria-hidden
          className="shrink-0 translate-y-px"
        />
        {typeof base === "object" ? (
          <span className="min-w-0 truncate">
            {n === 1 ? "For the goal" : `For the goal · ${String(n)}`}
          </span>
        ) : (
          <>
            <span className="min-w-0 truncate">
              {n === 1 ? "New trak" : `New trak · ${newTraks(n)}`}
            </span>
            <Base base={base} />
          </>
        )}
      </span>
      <Texts texts={texts} />
    </section>
  )
}

export default HandOffs
