/**
 * What a run of the composer proposed.
 *
 * **This was left to the Map at first, and that was wrong for a reason worth writing
 * down.** A proposal looks like a duplicate of the plan the Map already draws — and for a
 * trak composed once, it is. But `ComposerReturned.output.steps` is what *that run*
 * proposed, where the Map draws the plan as it stands now: a trak that was re-composed
 * has a spliced plan that matches neither proposal, so the first run's card is the only
 * place its proposal survives. The Map is the plan; this is the argument that produced it.
 *
 * Two of the three things here are rendered nowhere else in the app. `title` is the name
 * that run gave the work, and **`rationale` has never been drawn at all** — it is the
 * composer's own account of what shaped the sequence, absent on most plans because it is
 * news rather than justification, which is exactly what makes it worth reading when it is
 * there.
 *
 * **`continues` is a fourth, and the one with something riding on it.** It names the
 * conversation a step is put into, and nothing in the engine refuses a reviewer resumed
 * into the conversation that wrote what it is judging; the rule against it is prose to
 * the composer, so this gate is where it is caught — the running trak marks the fact
 * too (`ContinuesNotice` and the corner mark off `MapRow.continues`), but by then the
 * turn is spent.
 *
 * **Every entry is an outlined tile and nothing in one is cut.** This is the only place a
 * proposed step's instruction is drawn in full — the Map's caption wraps to five lines and
 * stops, which cuts a piece's paragraph in a fifth-width column, and a piece has no
 * proposal card of its own because it has no composer —
 * and it is the place a person decides whether to spend on it, so a step that reads as a
 * clipped phrase here cannot be reviewed anywhere. A spawn's tile carries its own
 * instruction and then, below a rule, the plan of every child it will create: approving a
 * spawn of five buys five traks and at least five more gates, which a row saying
 * `5 pieces` would not say.
 *
 * **A step that waits on a condition is marked by a rule across the list, not on its
 * tile.** Approving a plan with one buys some work now and some work later — after the
 * pull request merges, after the deploy lands, after whatever a project script asks
 * about — and the rule shows where that split falls: every tile under it runs later.
 * `waits.ts` says where a rule goes and `WaitRule` draws it; the header counts the
 * waiting steps beside the press that spends.
 *
 * **A step with a clock of its own draws a second rule of the same shape**, `ClockRule`,
 * carrying the instant where the names go — and where a step waits on both, the clock's
 * rule sits above the condition's, because the instant is the outer floor. It is read off
 * the entry rather than placed by `waits.ts`: `waitUntil` is the step's own, so it never
 * repeats.
 *
 * **A hand-off sits after the list, under its own label, and never inside it.** The plan
 * may name work that belongs on another base — traks of its own, cut from the default
 * branch, which never come back — and the one thing that keeps that from reading as a
 * spawn is that it is not an entry: `HandOffs` draws it as a region below the last tile,
 * with the branch on its label, and the head counts the new traks last of all.
 *
 * **At the gate the plan is editable in place, and the card holds the edits.** A person
 * can reword a top-level step, remove one, choose which conversation an agent step
 * continues, take off a clock the composer set, and swap an agent step's agent or its
 * model — `EditableTile` and `RunsOnControl` draw each, and
 * `planEdits.ts` is what they amount to. They live here, in the card's own state, because
 * the card is the only thing that draws them and Approve is the only thing that reads
 * them: the press is `PlanPresses`, built here from the approval the page hands down as
 * `planning`. Whether there is a press at all is still the page's answer, from
 * `TrakStateDto`, because a card that chose its own buttons would offer presses the gate
 * refuses.
 *
 * **The edits last exactly as long as this proposal is at the gate.** The caller keys the
 * card by the proposal's place in the log, so a chat that brings a new proposal starts
 * from nothing, and a card drawn anywhere else — the history, after approval — is given no
 * `planning` and draws what the composer proposed. The Map is where the plan as approved
 * is drawn.
 */

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Fragment, useState } from "react"
import { GitBranch, ListRestart, Split } from "lucide-react"
import type { AgentDto, ComposerOutputDto, EntryDto, MarkDto } from "../../../../api/types"
import { agentGlyph } from "../../../../format/glyph"
import CardShell from "../CardShell"
import ClockRule from "../../waits/ClockRule"
import EditablePieces from "./EditablePieces"
import EditableTile from "./EditableTile"
import HandOffs from "./HandOffs"
import { handOffCount, type HandOffBase } from "./handOff"
import {
  continuable,
  editCount,
  editsDto,
  modelOn,
  NO_EDITS,
  type PlanEdits,
  type Tile,
  tilesOf,
  withAgent,
  withCellAgent,
  withCellEdit,
  withCellModel,
  withEdit,
  withModel,
  withoutCellEdit,
  withoutEdit,
} from "./planEdits"
import PlanPresses from "./PlanPresses"
import PlanStep from "./PlanStep"
import RunsOnControl from "./RunsOnControl"
import SpawnGrid from "./SpawnGrid"
import HeldBand from "../gate/HeldBand"
import UnattendedBand from "../gate/UnattendedBand"
import WaitRule from "../../waits/WaitRule"
import { conditionsOf, planWaits, waitingCount } from "../../waits/waits"
import type { Approval } from "../../useApprove"

type Proposal = Extract<ComposerOutputDto, { type: "proposal" }>

/**
 * What the page hands the card where this proposal is the one at the gate: the approval,
 * the proposal's place in the log — what the press names, so edits never land on a newer
 * one — the plan's entries before it, which ran and which a step may still continue, and
 * `models.yaml`'s list, which a step's model is picked from.
 */
export interface PlanGate {
  readonly approval: Approval
  readonly proposal: number
  readonly head: readonly EntryDto[]
  readonly models: readonly string[]
}

/** Hoisted so the default is one reference rather than a new array each render. */
const NO_AGENTS: readonly AgentDto[] = []
const NO_HEAD: readonly EntryDto[] = []

/** How many child traks a count of them is, in words. */
const pieces = (n: number): string => `${String(n)} piece${n === 1 ? "" : "s"}`

/** What an entry is called in one word. Exhaustive: a fourth kind is a compile error. */
const nameOf = (entry: Proposal["steps"][number]): string => {
  switch (entry.type) {
    case "agent":
      return entry.agent
    case "spawn":
      return pieces(entry.children.length)
    case "compose":
      return "re-compose"
  }
}

/**
 * The mark that entry wears, under the same rule the plan itself draws by — the agent's
 * own, `Split` for N traks, `ListRestart` for the composer asked again.
 *
 * The rule is `rows.ts`'s and this is the second place it is written, because a proposal
 * is not a plan: nothing here has run, the entries are `StepDto` rather than `EntryDto`,
 * and the one thing the two agree about is which glyph belongs to which kind. Exhaustive,
 * so a fourth kind is a compile error here as it is above.
 */
const glyphOf = (entry: Proposal["steps"][number], agents: readonly AgentDto[]): LucideIcon => {
  switch (entry.type) {
    case "agent":
      return agentGlyph(agents, entry.agent)
    case "spawn":
      return Split
    case "compose":
      return ListRestart
  }
}

/** How many agent turns a count of them is, in words. */
const runs = (n: number): string => `${String(n)} run${n === 1 ? "" : "s"}`

/**
 * What the header counts, beside the press that spends the money.
 *
 * The step count alone undercounts what approving buys: a plan of six whose middle is a
 * spawn of five is eleven agent runs and five more gates. The pieces are what the count was
 * missing, and they are named only where there are some — a plan with no spawn has nothing
 * to add and `· 0 pieces` reads as a thing that failed to fill in.
 *
 * **A piece can hold a plan of its own**, so the pieces undercount in turn: five pieces that
 * each build and then review themselves are ten runs and ten gates. The runs are said only
 * where they differ from the pieces, for the same reason — on a spawn of one-step pieces the
 * two numbers are the same fact twice.
 */
const head = (
  steps: Proposal["steps"],
  waiting: number,
  handOffs: number,
  base: HandOffBase,
): string => {
  const spawned = steps.reduce((n, e) => (e.type === "spawn" ? n + e.children.length : n), 0)
  const turns = steps.reduce((n, e) => (e.type === "spawn" ? n + e.children.flat().length : n), 0)
  const plan = steps.length === 1 ? "Proposed 1 step" : `Proposed ${String(steps.length)} steps`
  const bought =
    spawned === 0
      ? plan
      : turns === spawned
        ? `${plan} · ${pieces(spawned)}`
        : `${plan} · ${pieces(spawned)} · ${runs(turns)}`
  // The waits next, and only where there are some: the count says how much of what
  // approving buys runs later, and `· 0 wait` on an ordinary plan reads as a blank.
  const later = waiting === 0 ? bought : `${bought} · ${String(waiting)} wait`
  // And the new traks last of all, on the same terms: approving opens them — or, on a
  // goal's trak, sends them to the goal — and they never come back to be counted again.
  return handOffs === 0 ? later : `${later} · ${handOffCount(handOffs, base)}`
}

/** The composer's own tiles, as proposed — every card but the one at the gate. */
const proposedTiles = (steps: Proposal["steps"], agents: readonly AgentDto[]): ReactNode => {
  const waits = planWaits(agents, steps)
  return steps.map((entry, i) => {
    const fresh = waits[i] ?? []
    const until = entry.type === "agent" ? entry.waitUntil : undefined
    return (
      // The proposal is append-only once returned, so an index is a real identity —
      // and two entries can name the same agent, so the agent is not one.
      // oxlint-disable-next-line react/no-array-index-key -- a returned proposal never reorders
      <Fragment key={i}>
        {until !== undefined ? (
          // Above the condition's rule where there is one: the two are separate
          // facts about the order, and the clock is the outer of the two floors.
          <li className="flex min-w-0 flex-col py-0.5">
            <ClockRule until={until} />
          </li>
        ) : undefined}
        {fresh.length > 0 ? (
          // A row of the list rather than part of the tile below, so that tile stays
          // the same object as every other — the split is in the order, not the step.
          <li className="flex min-w-0 flex-col py-0.5">
            <WaitRule names={fresh} />
          </li>
        ) : undefined}
        <li className="flex min-w-0 flex-col rounded-surface border border-border p-2.5">
          <PlanStep
            mark={String(i + 1)}
            glyph={glyphOf(entry, agents)}
            agent={nameOf(entry)}
            instruction={entry.instruction}
            // Only a turn can carry a conversation to pick up: a session belongs to one,
            // where a spawn is N traks and a re-compose is the composer's own run.
            continues={entry.type === "agent" ? entry.continues : undefined}
          />
          {entry.type === "spawn" ? (
            // A piece arrives as its own plan, which is what a column is. Nothing to adapt.
            <SpawnGrid at={String(i + 1)} columns={entry.children} agents={agents} />
          ) : undefined}
        </li>
      </Fragment>
    )
  })
}

/**
 * An agent tile's agent and model pickers, writing their picks into the card's edits — or
 * nothing for a spawn or a re-compose, which keep their plain name.
 */
const pickersAt = (
  planning: PlanGate,
  tiles: readonly Tile[],
  i: number,
  agents: readonly AgentDto[],
  setEdits: (change: (all: PlanEdits) => PlanEdits) => void,
): ReactNode => {
  const tile = tiles[i]
  if (tile?.now.type !== "agent" || tile.proposed.type !== "agent") return undefined
  const proposed = tile.proposed.agent
  return (
    <RunsOnControl
      mark={String(i + 1)}
      agent={tile.now.agent}
      model={modelOn(planning.head, tiles, agents, i)}
      locked={tile.locked}
      agents={agents}
      models={planning.models}
      onAgent={(agent) => {
        setEdits((all) => withAgent(all, i, agent, proposed))
      }}
      onModel={(model, own) => {
        setEdits((all) => withModel(all, i, model, own))
      }}
    />
  )
}

/** A spawn tile's pieces, editable, writing into the card's edits — nothing on any other entry. */
const piecesAt = (
  planning: PlanGate,
  tiles: readonly Tile[],
  i: number,
  agents: readonly AgentDto[],
  setEdits: (change: (all: PlanEdits) => PlanEdits) => void,
): ReactNode => {
  const tile = tiles[i]
  if (tile?.proposed.type !== "spawn") return undefined
  return (
    <EditablePieces
      at={String(i + 1)}
      pieces={tile.pieces}
      agents={agents}
      models={planning.models}
      on={{
        edit: (j, k, change) => {
          setEdits((all) => withCellEdit(all, i, j, k, change))
        },
        undo: (j, k, field) => {
          setEdits((all) => withoutCellEdit(all, i, j, k, field))
        },
        agent: (j, k, agent) => {
          const proposed = tile.pieces[j]?.[k]?.proposed.agent ?? agent
          setEdits((all) => withCellAgent(all, i, j, k, agent, proposed))
        },
        model: (j, k, model, own) => {
          setEdits((all) => withCellModel(all, i, j, k, model, own))
        },
      }}
    />
  )
}

const ProposalCard = ({
  proposal,
  planning,
  atGate,
  agents = NO_AGENTS,
  handOffBase,
  opened,
}: {
  readonly proposal: Proposal
  /** The gate, where this proposal is the one standing at it — and the edits with it. */
  readonly planning?: PlanGate
  /**
   * The branch a hand-off on this plan would be cut from, while the gate is open —
   * `TrakDetailDto.handOffBase` — or the goal it goes to. Read by nothing where the plan
   * hands nothing off.
   */
  readonly handOffBase: HandOffBase
  /** The traks a hand-off here was opened as, once the gate went past — `openedAt`. */
  readonly opened: readonly string[] | undefined
  /**
   * The library, for each step's mark. Defaulted because this card is rendered by tests
   * and by the atelier against a proposal alone, where the fallback mark is the honest
   * answer — see `agentGlyph`.
   */
  readonly agents?: readonly AgentDto[]
  /**
   * What happened at this plan's gate: entered with nobody reading it, or held by a
   * pressed Hold until it was approved. `HeldBand` and `UnattendedBand` draw the two.
   *
   * **The warrant is the one the entry approving would have entered**, not one about the
   * composer's own turn — the plan gate is asked about the work, so a re-cut that plans a
   * fix is let through with it and a round costs one stop instead of two.
   */
  readonly atGate: MarkDto | undefined
}): ReactNode => {
  const [edits, setEdits] = useState<PlanEdits>(NO_EDITS)
  const ran = planning?.head ?? NO_HEAD
  const from = ran.length
  const tiles = tilesOf(proposal.steps, ran, planning === undefined ? NO_EDITS : edits)
  // What approving would run, which is what the head counts and what the rules fall over.
  const kept = tiles.filter((t) => !t.removed).map((t) => t.now)
  const waits = planWaits(agents, kept)
  const handOffs = proposal.handOff ?? []
  /** The conditions first waited on at tile `i` — none on a removed one, which runs nothing. */
  const rulesAt = (i: number): readonly string[] =>
    tiles[i]?.removed === true
      ? []
      : (waits[tiles.slice(0, i).filter((t) => !t.removed).length] ?? [])
  return (
    <CardShell
      icon={GitBranch}
      head={head(kept, waitingCount(agents, kept), handOffs.length, handOffBase)}
      actions={
        planning === undefined ? undefined : (
          <PlanPresses
            approval={planning.approval}
            count={editCount(tiles)}
            onReset={() => {
              setEdits(NO_EDITS)
            }}
            onApprove={() => {
              const sent = editsDto(planning.proposal, tiles, from, edits)
              if (sent === undefined) planning.approval.approve()
              else planning.approval.approveWith(sent)
            }}
          />
        )
      }
      band={
        atGate === undefined ? undefined : atGate._tag === "Held" ? (
          <HeldBand />
        ) : (
          <UnattendedBand why={atGate} />
        )
      }
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium text-fg">{proposal.title}</span>
        {proposal.rationale === undefined ? undefined : (
          <p className="whitespace-pre-wrap text-base leading-5 text-fg-muted">
            {proposal.rationale}
          </p>
        )}
      </div>

      {planning?.approval.said === undefined ? undefined : (
        // Whole and wrapped, above the list the sentence is about: a refused edit names the
        // step and the rule it broke, and that is the only way a person learns what to fix.
        <p role="alert" className="min-w-0 whitespace-pre-wrap break-words text-sm text-tone-bad">
          {planning.approval.said}
        </p>
      )}

      <ol className="flex min-w-0 flex-col gap-2">
        {planning === undefined
          ? proposedTiles(proposal.steps, agents)
          : tiles.map((tile, i) => (
              <EditableTile
                key={tile.key}
                tile={tile}
                mark={String(i + 1)}
                glyph={glyphOf(tile.now, agents)}
                name={nameOf(tile.now)}
                lead={pickersAt(planning, tiles, i, agents, setEdits)}
                // The rules fall over what stays, so a removed tile hands the first sight
                // of its condition to the next one that runs.
                conditions={rulesAt(i)}
                declared={tile.now.type === "agent" ? conditionsOf(agents, tile.now.agent) : []}
                options={continuable(planning.head, tiles, i)}
                pieces={piecesAt(planning, tiles, i, agents, setEdits)}
                onEdit={(change) => {
                  setEdits((all) => withEdit(all, i, change))
                }}
                onUndo={(field) => {
                  setEdits((all) => withoutEdit(all, i, field))
                }}
              />
            ))}
      </ol>

      {/* After the list and outside it, with no rule between: the position is what says
          these are not steps, and a rule would draw the list as ending where the card's
          own padding already says so. */}
      <HandOffs texts={handOffs} base={handOffBase} opened={opened} />
    </CardShell>
  )
}

export default ProposalCard
