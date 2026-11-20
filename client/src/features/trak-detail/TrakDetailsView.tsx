/**
 * Everything about the trak rather than about one entry: the request, the amendments to
 * it, why the plan is shaped the way it is, where the work lives, and what it has spent.
 *
 * **Five sections, and none of them is a log.** What happened is the map's job, turn by
 * turn under each entry; this is what the trak *is*. Two of the five render facts the
 * wire already carries and the app has never shown — `PlanDto.rationale`, and
 * `custody.holder.pid`. The fifth is the one place a parent's spend is set against its
 * pieces' — a spawn entry runs no turn of its own, so there is no position to ask it at.
 *
 * **`assumed` takes no tone.** A tone says how something is *going*: `waiting` means a
 * human owes an action and `bad` means something failed, and an inference is neither.
 * The epic's test is only *could you point at the sentence a human wrote?* — so
 * provenance is a plate, and both sides carry one, because one coloured plate among
 * neutrals reads as an alarm where two read as two sources.
 */

import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { MessageSquare, Sparkles } from "lucide-react"
import type { PlanDto, RecordedDto, TrakDetailDto } from "../../api/types"
import EmptySection from "../../components/EmptySection"
import Section from "../../components/Section"
import RequestView from "./RequestView"
import { autoMergeLine } from "./autoMerge"
import TrakSpend from "./tokens/TrakSpend"
import { total, type TrakUsage } from "./tokens/usage"

/**
 * Who decided, as a badge.
 *
 * **Both sides are a `source`, and neither is the accent.** The accent is the app's one
 * non-status colour and it means *act on this*; a decision already recorded is not
 * something to act on, so an inference wearing it was the accent saying one thing in four
 * places and something else here. The two sources are the two voices in a trak — a person
 * stated it, or the machine worked it out — and they were drawn against each other before
 * this pairing was adopted, because this pane is the one place they sit side by side.
 *
 * The fill is an **alpha**, not an opaque mix, so it composites over whatever ground
 * the pane ends up on — the same reason `--color-hover-*` are alphas.
 */
const Provenance = ({ source }: { readonly source: RecordedDto["source"] }): ReactNode => {
  const inferred = source === "assumed"
  const hue = inferred ? "var(--color-source-machine)" : "var(--color-source-human)"
  const Glyph = inferred ? Sparkles : MessageSquare
  return (
    <span
      className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-control"
      style={{ background: `color-mix(in oklab, ${hue} 15%, transparent)`, color: hue }}
    >
      <Glyph size={10} fill="currentColor" strokeWidth={1} aria-hidden />
      <span className="sr-only">{inferred ? "inferred by the agent" : "from you"}</span>
    </span>
  )
}

/**
 * The entries that still stand, which is what every list the engine renders shows:
 * one a later entry names in its `supersedes` is left out, and the later one restates
 * whatever of it still held. The ids are the engine's, so nothing moves when one folds.
 */
const standing = (decisions: readonly RecordedDto[]): readonly RecordedDto[] => {
  const folded = new Set(decisions.flatMap((d) => d.supersedes ?? []))
  return decisions.filter((d) => !folded.has(d.id))
}

const Decisions = ({ decisions }: { readonly decisions: readonly RecordedDto[] }): ReactNode =>
  decisions.length === 0 ? (
    <EmptySection shape="decisions">Nothing decided yet.</EmptySection>
  ) : (
    <ul className="flex flex-col gap-2">
      {standing(decisions).map((d) => (
        <li key={d.id} className="flex gap-2">
          <Provenance source={d.source} />
          {/* The text reads the same either way. Provenance is the plate's job, and a
              weight difference here would say one of them mattered more. The id is
              what a later entry names this one by, so it is the name shown. */}
          <span className="min-w-0 text-base leading-5 text-fg-muted">
            {d.text} <span className="font-mono text-2xs text-fg-subtle">{d.id}</span>
            {d.supersedes === undefined ? undefined : (
              <span className="ml-1.5 font-mono text-2xs text-fg-subtle">
                supersedes {d.supersedes.join(", ")}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )

/** The one row whose value wraps rather than truncating. */
const WRAPS = "auto-merge"

/** Mono both sides; the keys carry weight, because the left column is a vocabulary and
 *  the right is the value. Mono stops at 600 — `styles.css` loads no bold for it. */
const Where = ({ trak }: { readonly trak: TrakDetailDto }): ReactNode => (
  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
    {[
      // Which gates this trak stops at, fixed when it was created. It is here and
      // not in the header band because it does not change: a chip beside the state
      // would put a value that never moves next to the one thing that always does.
      // On `auto` it is also the only thing on screen that explains an approval
      // nobody was asked for.
      ["mode", trak.mode],
      // Beside the mode for the mode's reason: set when the trak was created. It is also
      // where the trak says why the engine stopped merging it on its own.
      [WRAPS, autoMergeLine(trak.autoMerge)],
      ["branch", trak.worktree?.branch],
      ["from", trak.worktree?.base],
      ["checkout", trak.worktree?.path],
      ["trak", trak.id],
      // Custody, not state: a crashed run stays `AgentWorking` with nobody driving it.
      //
      // The wire carries *since when* rather than which pid, because one process does
      // all the driving and a pid would be the same number on every held row. An
      // elapsed time belongs here eventually; a timestamp is what there is to say
      // until something in this package knows how to render one.
      [
        "driving since",
        trak.custody.holder === undefined
          ? "nothing"
          : new Date(trak.custody.holder.since).toISOString(),
      ],
    ].map(([k, value]) => (
      <div key={k} className="contents">
        <dt className="font-mono text-2xs font-medium text-fg-subtle">{k}</dt>
        {/* Every value is one line but auto-merge's: a stopped one is a sentence ending in
            what the person owes, and a cut there falls on exactly that. */}
        <dd
          className={`min-w-0 font-mono text-2xs text-fg-muted ${k === WRAPS ? "break-words" : "truncate"}`}
        >
          {value ?? <span className="text-fg-subtle">no worktree</span>}
        </dd>
      </div>
    ))}
  </dl>
)

const TrakDetailsView = ({
  trak,
  plan,
  usage,
}: {
  readonly trak: TrakDetailDto
  readonly plan: PlanDto | undefined
  /** What the trak and its pieces spent, folded by the page — `usage.ts`. */
  readonly usage: TrakUsage
}): ReactNode => (
  <div className="flex flex-col gap-6 px-4 py-4">
    <RequestView description={trak.description} />

    {/* The note describes how to read a list, so with no list it is a second grey
        sentence sitting above the one that answers. Dropped rather than reworded:
        there is nothing to say about the order of nothing. */}
    <Section
      label="And since then"
      note={
        trak.decisions.length === 0
          ? undefined
          : "Amendments to the request, in order. The latest wins."
      }
    >
      <Decisions decisions={trak.decisions} />
    </Section>

    {/* Absent on most plans, and that is the point: it is news rather than a
        justification, written only when the composer found something that changed the
        shape. Nothing has ever rendered it. */}
    {plan?.rationale !== undefined && (
      <Section label="Why the plan looks like this" note={plan.title}>
        <p className="text-base leading-5 text-fg-muted">{plan.rationale}</p>
      </Section>
    )}

    <Section label="Where the work is">
      <Where trak={trak} />
      {/* The link's near end, on a trak another trak's composer opened: where the request
          came from, one press away. A child carries `parent` and is read inside it; this
          trak is nobody's piece, so the name is the whole of what says why it exists. */}
      {trak.handedOffFrom !== undefined && (
        <p className="font-mono text-2xs text-fg-subtle">
          handed off by{" "}
          <Link
            to="/traks/$id"
            params={{ id: trak.handedOffFrom }}
            className="text-fg-muted underline decoration-border underline-offset-2 hover:decoration-fg-subtle"
          >
            {trak.handedOffFrom}
          </Link>
        </p>
      )}
    </Section>

    {/* Last, because it is the one section that is a reading rather than a fact about
        what the trak is for. The note is dropped with the bar, as *And since then*'s is
        with its list. */}
    <Section
      label="What it costs"
      note={
        total(usage.own) === 0
          ? undefined
          : usage.pieces === undefined
            ? "Every turn added up."
            : "Every turn added up. Its pieces are named below rather than drawn in, because a piece's spend is never part of its parent's."
      }
    >
      <TrakSpend usage={usage} />
    </Section>
  </div>
)

export default TrakDetailsView
