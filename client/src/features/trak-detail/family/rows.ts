/**
 * The plan, as rows.
 *
 * **It is already the sequence.** `PlanDto.steps` holds what happened and what is still
 * to come in one list — the composer's own runs among them — so this reads it rather
 * than reconstructing anything. An earlier version derived the composer's rows from the
 * log and the transcript, which meant working out which entry had been at a position
 * when a turn ran; that is a copy of the engine's splice arithmetic, and a label that
 * can be wrong. The engine writes the entry down now, so it cannot be.
 *
 * **A row carries its own turns.** Every composer turn stamps its transcript lines
 * `"composer"`, so anything asking for *the composer's* turns gets all of them at once;
 * handing each row its run when the row is built is what makes that unrepresentable.
 *
 * **One row is not a plan entry at all.** Once the plan has run out the list gains a final
 * position with nothing behind it — the trak's own ending, as a row — so a person can
 * finish the trak from the surface they were reading it on. It is a `MapRow` and not a
 * shape of its own because `focus`, `StepBar`, `StepMark` and `TrakMap` all take one, and
 * a union there would touch every one of them so that a single row could be different.
 * **On a trak parked at a wait it is not the last row**: the plan ran out of what could
 * run, not of entries, so the ending stands before the entry the wait holds and the
 * unrun tail hangs under it — see `withEnding`.
 */

import type { LucideIcon } from "lucide-react"
import { Flag, Hand, ListRestart, ListTree, Split } from "lucide-react"
import type {
  AgentDto,
  EntryDto,
  EventDto,
  PlanDto,
  ReconsultWhyDto,
  TrakStateDto,
  MarkDto,
  WaitingDto,
} from "../../../api/types"
import { agentGlyph } from "../../../format/glyph"
import type { Tone } from "../../../format/tone"
import { trakLabel } from "../../../format/trakLabel"
import { sentBackText } from "../autoMerge"
import { finishedPosition } from "../controls"
import { branchMoved, endingTitle, handedUp } from "../finished/finished"
import {
  composerCaption,
  composerStatus,
  keptAt,
  landedEntry,
  opensGate,
  planning,
  stepAt,
  type StepStatus,
  stepStatuses,
  stepTone,
  statusText,
} from "./planView"
import { outstandingJobs } from "../turns/jobs/outstanding"
import { type ComposerRun, composerRuns, stepTurns, type Turn } from "../turns/turns"
import { waitGlyph, waitPhrase, waitSlot, waitTone } from "../waits/waiting"

/**
 * The conversation a step was told to pick up, resolved against what actually ran.
 *
 * `key` is the composer's own — `3-experiment` — and is drawn wherever the fact is. The
 * other two are read off the transcript rather than off the plan, because the engine
 * resolves the key at spawn and the transcript is the record of what it did: `to` is the
 * position whose session this one's turn is in — the splice `turns.ts` cuts — as a key
 * `onPick` takes; `fresh` says the turn ran under a session of its own, so there was
 * nothing to continue. Neither is set while the position has no session to compare — the
 * mark draws, the sentence waits.
 */
export interface Continues {
  readonly key: string
  readonly to: string | undefined
  readonly fresh: boolean
}

/**
 * A fact at the plate's corner that is neither *who ran this* nor *how it went*, with the
 * words for a reader who cannot see it — the family `TrakMap`'s unread bolt and hand-up
 * arrow belong to, at the same disc and the same corner. A tone rather than a fixed colour,
 * because a wait has a tone of its own and an ask borrows the hand-up's.
 */
export interface Badge {
  readonly glyph: LucideIcon
  readonly tone: Tone
  readonly says: string
}

/**
 * The wait a trak is parked at, with the instant a clock's words are read against —
 * `waitSlot` says *06:00 tomorrow* relative to it. One value because the instant matters
 * only where there is a wait, and passed in rather than read here so the rows stay a
 * function of what they were given.
 */
export interface Parked {
  readonly at: WaitingDto
  readonly now: number
}

/** One row of the map: a plan entry — a compose, an agent turn or a spawn — or the ending. */
export interface MapRow {
  /** Stable across polls: the entry's index, which never changes once it has run. */
  readonly key: string
  /**
   * The plan entry this row draws, as an index.
   *
   * Carried rather than parsed back out of `key`: the pane asks the log what this
   * position filed and why it ran again, and a surface recovering a number from a string
   * it built is one rename away from asking about the wrong step.
   *
   * **`-1` on the `end` row, which has no entry behind it.** A number rather than
   * `undefined` so that every surface taking a `MapRow` keeps the type it already had —
   * which makes **`kind` the thing that says whether `at` is a position at all**, and
   * anything turning a row into an index has to ask that first. `slices.ts` is where it
   * bites: a picker gated on the row's sha alone offers a merged trak a diff of step `-1`,
   * because the ending carries the merge commit in a step's slot.
   */
  readonly at: number
  /**
   * `recompose` is the composer asked again, which is worth telling apart at a glance.
   * `end` is the trak's own ending, and is the one kind with no plan entry behind it.
   */
  readonly kind: "step" | "compose" | "recompose" | "end"
  /**
   * How the plan entry went — `undefined` exactly on the `end` row, because a `StepStatus`
   * says how an *entry* went and the ending is not one. Nothing may substitute a value
   * there: `todo` would draw it as unrun and `done` would offer it the gate's press.
   */
  readonly status: StepStatus | undefined
  /**
   * How the row is going, as the one vocabulary the whole app shares.
   *
   * Carried on the row rather than derived at the mark, because the two rows answer from
   * two places: a plan entry's comes from `stepTone`, and the ending's comes from
   * `trakLabel`, which already returns `working` while an ending runs, `good` at `Merged`,
   * `neutral` at `Closed` and either `waiting` or `good` at `Finished` depending on whether
   * there is anything to merge — already written and already exhaustive over the
   * twenty-three states. **A parked ending is the one exception** and takes `waitTone`'s
   * instead, for the reason `endRow` gives.
   */
  readonly tone: Tone
  /**
   * What a square draws for this row, at either size: the agent's own mark on a step, and
   * the kind's on every row that is not one agent's turn.
   *
   * **Carried rather than derived at the mark, and decided here rather than anywhere
   * else.** Two surfaces draw the same position at full size — the map's rows and the
   * strip's squares — and a glyph each of them worked out would be two alphabets waiting
   * to disagree, which is the drift `format/tone` exists to stop one level down. Deciding
   * it where the plan entry is in hand is also what keeps a spawn from being *inferred*:
   * its mark comes from `entry.type`, never from `title` happening to read `5 pieces`.
   *
   * The 14px tile inside a spawn draws this too, at 10px — so nothing at any size decides
   * a glyph of its own, and a piece's ending is the flag there without the tile coercing
   * its absent status.
   */
  readonly mark: LucideIcon
  readonly title: string
  readonly caption: string
  /**
   * How many pieces ran at this position — `undefined` on every row that is not a spawn,
   * which makes this **the fact that says a position is a spawn at all**.
   *
   * Carried for the same reason `mark` is: it comes from `entry.type`, and a surface that
   * wanted it otherwise would be reading `title` for whether it happens to say `5 pieces`.
   * `slices.ts` is what needs it — a spawn's slice is every piece's work joined rather than
   * one agent's turn, and the empty state has different news for the two.
   */
  readonly pieces: number | undefined
  readonly sha: string | undefined
  /** The turns that ran for this row, and no other row's. Empty is ordinary. */
  readonly turns: readonly Turn[]
  /**
   * What happened at this row's gate: it went past with nobody reading it and why, or a
   * pressed Hold held this step until a person accepted it. Absent on every row a person
   * was asked about, which on `manual` is all of them. `UnattendedBand` and `HeldBand`
   * draw the two.
   *
   * **Three facts, and it takes all three.** The wire says which gates the engine
   * stamped; the row's own status says the gate is reached; and the log says whether a
   * person took it anyway. A row still running is one the rule will take and has not yet,
   * and drawing the mark there would say a person was skipped before anything was filed
   * for them to skip. A row a person *did* stand at is the worse half — an unattended trak
   * still parks at four gates, and the mark there claims nobody read a document somebody
   * approved. See `stoodAt`. A `Held` mark is a person's own press and needs no third
   * fact: a held step and one the mode took look alike from the log, and only
   * `applyEvent` sees which it was, so it is read straight off the wire.
   */
  readonly atGate: MarkDto | undefined
  /**
   * What this trak's composer handed up to its parent, on the ending row of a piece that
   * did — `undefined` on every other row, and on the ending of a trak that handed up
   * nothing. `TrakMap` marks the plate with it and `FinishedView` prints it; the caption
   * says so in words, because the phone's directive block draws the caption and no badge.
   */
  readonly handUp: string | undefined
  /**
   * How many background jobs this position's newest turn still has outstanding — that
   * turn's last `Background` level, 0 where it never wrote one.
   *
   * A fact about the transcript, carried on the row so the three position surfaces —
   * the rails' badge, the map's line, the directive block's sentence — cannot count
   * differently.
   * Each gates its drawing on `status === "running"`, the same fact the plate's chase
   * reads: a crashed turn's last level survives on disk, and a count on a dead position
   * would say a stop is waiting where there is nothing left to press.
   */
  readonly outstanding: number
  /**
   * The conversation this step was told to pick up — `undefined` on every row whose
   * entry names none, which is every row that is not an agent step's and most that are.
   *
   * Carried on the row for the reason `atGate` is: three surfaces mark the position
   * (`TrakMap`, and both rails through `RailMark`) and the step's own pane says it in a
   * sentence (`ContinuesNotice`), and a fact each of them resolved for itself would be
   * four answers waiting to disagree. The proposal card is the one surface that does not
   * read this — nothing has run at the plan gate, so it draws the entry's bare key.
   */
  readonly continues: Continues | undefined
  /**
   * The model this position's turn runs on — `undefined` on every row that is not an
   * agent step's, and on one whose agent the engine could not name. Off the wire as the
   * engine resolved it (`AgentStepDto.model`), never worked out here: the fallback from
   * the entry's pick to the agent file's is the spawn site's rule, and a second copy of it
   * in the client would drift. Carried on the row for `continues`'s reason — the header
   * reads it for the trak's own steps, and a piece band that draws it one day reads the
   * same fact.
   */
  readonly model: string | undefined
  /**
   * How many tokens that model's context window holds — `AgentStepDto.contextWindow`,
   * straight across, and `undefined` wherever `model` is or the engine gave no figure for
   * it. The chat bar's context line is a percentage of this; without it the line draws no fill.
   */
  readonly window: number | undefined
  /**
   * The effort that turn runs at — `undefined` wherever `model` is undefined, and wherever
   * nothing declared one, which is the CLI's own default. Off the wire for `model`'s reason,
   * and carried whole: the client holds no list of levels to shorten or order it by.
   */
  readonly effort: string | undefined
  /**
   * The corner mark this row wears — `undefined` on most. Two rows carry one: the entry
   * a wait holds wears the wait's own glyph in the wait's tone, and a compose entry
   * something asked for wears a hand, which is what tells it from a re-cut the composer
   * scheduled — same plate, same word, and the caption is the only other difference.
   *
   * Decided here for `mark`'s reason: the map and the rail both draw it, and a glyph each
   * of them picked would be two answers waiting to disagree. It is a fact about the entry
   * rather than about the moment, so a settled ask keeps it — beside the unread bolt on an
   * unattended trak, which is why which corner each takes is `corners.ts`'s and not a
   * surface's.
   */
  readonly badge: Badge | undefined
  /**
   * The wait the trak is parked at, on its ending row alone — `undefined` on every plan
   * entry, and on the ending of a trak that waits on nothing.
   *
   * It is what moves the ending. A trak with a wait is at rest with a step still to run,
   * so its ending stands before the entry the wait holds rather than after the last one,
   * and reads *Held* over the condition. The entries under it are still the plan, which is
   * what `TrakMap` reads this for: no rule above such a row, and the guide runs through it.
   */
  readonly waiting: WaitingDto | undefined
}

/** The ending's row, which is the only one whose key is not an index. */
export const END_KEY = "end"

/** Everything up to the first newline, for a caption that is one line by construction. */
const firstLine = (text: string): string => text.split("\n")[0] ?? text

/**
 * Why the composer was asked again, in the words the engine recorded.
 *
 * Exhaustive: a new reason is a compile error here rather than a row with an empty
 * caption. Nothing is inferred — each of these was written onto the entry at the moment
 * the run landed.
 */
const whyText = (why: ReconsultWhyDto): string => {
  switch (why._tag) {
    case "Raised":
      return [...why.requirements, ...why.corrections.map((c) => `${c.at}: ${c.text}`)].join(" · ")
    case "Replanned":
      // The ask a raced recompose displaced rides inside the person's reason, and the
      // row is the one place the trak says both were asked — so both are in the caption.
      return why.displaced === undefined
        ? why.reason
        : [why.reason, whyText(why.displaced)].join(" · ")
    case "Reentered":
      // The engine's own re-entry says why the forge would not merge it; `what` is then
      // only the pull request's address.
      if (why.cause !== undefined) return sentBackText(why.cause)
      // **The first line only, which is the sentence a person wrote.** A re-entry from the
      // finished pane's pull-request half is composed — the sentence, then a block per
      // ticked thing with the text quoted verbatim — so drawing it whole put a `>` quoted
      // review comment and a check's link into a one-line caption. The rest is on the row's
      // own turns; this is the caption.
      return firstLine(why.what)
    case "Refused":
      return why.reason
    case "Conflicted":
      // The files, not a count: the row is the only place this trak says which ones
      // disagreed, and the merge that reported them is over.
      return why.paths.join(" · ")
  }
}

/**
 * What a plan entry is called in one word: the agent, `5 pieces` for a spawn that names
 * several, and `re-compose` for the composer asked again. Exported for the deploy block,
 * which draws the entries a deploy holds in the proposal card's own tiles — so the two
 * cannot name a spawn differently.
 */
/** A row with no entry to read a model off: the ending, the empty plan's composer. */
const NO_MODEL: Pick<MapRow, "model" | "window" | "effort"> = {
  model: undefined,
  window: undefined,
  effort: undefined,
}

export const entryName = (entry: PlanDto["steps"][number]): string => {
  switch (entry.type) {
    case "agent":
      return entry.agent
    case "spawn":
      return `${String(entry.children.length)} pieces`
    case "compose":
      return "re-compose"
  }
}

/** How many pieces the entry runs, and nothing at all where it is one turn. See `MapRow.pieces`. */
const piecesOf = (
  entry: Exclude<PlanDto["steps"][number], { type: "compose" }>,
): number | undefined => (entry.type === "spawn" ? entry.children.length : undefined)

/**
 * What a plan entry's square wears: the agent's own mark, or `Split` where the entry is
 * N traks rather than one turn.
 *
 * A spawn takes a mark of its own rather than the agent's, and cannot take one: it names
 * as many agents as it has pieces, and picking the first would be a claim about the other
 * four. The pieces wear theirs on their own columns.
 */
export const entryMark = (
  entry: PlanDto["steps"][number],
  agents: readonly AgentDto[],
): LucideIcon => {
  switch (entry.type) {
    case "agent":
      return agentGlyph(agents, entry.agent)
    case "spawn":
      return Split
    // Only ever the composer asked *again* where this is read for a compose entry: the
    // map draws its first row on its own, with `ListTree`, and never through here.
    case "compose":
      return ListRestart
  }
}

/**
 * The key the engine files entry `i`'s document under — `artifactKey`'s shape,
 * `3-experiment` — rebuilt here because `continues` is written in that vocabulary and
 * the wire carries the plan, not the keys.
 */
const keyFor = (entry: EntryDto, i: number): string =>
  `${String(i)}-${entry.type === "agent" ? entry.agent : entry.type}`

/**
 * What ran at the entry `continues` names — empty for the three keys `sessionOf` in the
 * engine resolves to nothing: no entry has the key, the entry has it but never ran, and
 * a spawn, whose position holds no conversation at all.
 */
const heldAt = (
  at: number,
  entries: readonly EntryDto[],
  turns: readonly Turn[],
  runs: readonly ComposerRun[],
): readonly Turn[] => {
  const target = entries[at]
  if (target === undefined || target.type === "spawn") return []
  if (target.type === "agent") return stepTurns(turns, at)
  const ordinal = entries.slice(0, at + 1).filter((e) => e.type === "compose").length - 1
  return runs[ordinal]?.turns ?? []
}

/**
 * Whether the step actually joined the conversation its entry names, off the transcript.
 *
 * The claim needs the evidence and not just the entry, because the entry records what
 * the composer *asked*: a key naming nothing that had run is legal at both ends and the
 * turn simply starts fresh — so a marker resolved from the plan alone would assert a
 * resume that never happened, which is the misreading it exists to prevent. Joining is
 * one session at two positions — the splice `turns.ts` cuts — so the step's own session
 * appearing in the target's turns is the whole test.
 */
const continuesOf = (
  key: string | undefined,
  /** The turns of the step carrying `continues` — its session is the one compared. */
  own: readonly Turn[],
  entries: readonly EntryDto[],
  turns: readonly Turn[],
  runs: readonly ComposerRun[],
): Continues | undefined => {
  if (key === undefined) return undefined
  const session = own[0]?.session
  if (session === undefined) return { key, to: undefined, fresh: false }
  const at = entries.findIndex((e, i) => keyFor(e, i) === key)
  const joined = heldAt(at, entries, turns, runs).some((t) => t.session === session)
  const target = entries[at]
  return {
    key,
    to: joined ? `${target?.type === "compose" ? "compose" : "step"}:${String(at)}` : undefined,
    fresh: !joined,
  }
}

/**
 * The map, as rows.
 *
 * **There is always a composer row**, which is what lets the map do without an empty
 * state: a trak whose composer has not landed a plan has no entries at all, and a child
 * was born holding one it never composed. Both get a row without an entry behind it — it
 * still carries whatever the composer has run, which for the first of the two is often a
 * whole turn.
 */
const mapRow = (
  row: Omit<MapRow, "tone" | "atGate" | "handUp" | "outstanding" | "waiting">,
  marks: Marks,
): MapRow => ({
  ...row,
  tone: stepTone(row.status ?? "todo"),
  atGate: markOn(row.status, marks.get(row.at)),
  // A hand-up is the composer's finished answer, which is the ending's and no entry's.
  handUp: undefined,
  // And a wait is what the ending is parked at; the entry it holds carries the badge.
  waiting: undefined,
  // The newest turn alone, never every turn folded together: a level is a fact about the
  // turn that wrote it, and a turn stopped or failed with work outstanding leaves a set
  // nothing later on the wire replaces — see `outstandingJobs`.
  outstanding: outstandingJobs(row.turns.at(-1)).length,
})

/**
 * The mark a row draws, given its status.
 *
 * A `Held` mark on `gate` as well as `done`: it is stamped as the entry is accepted, so
 * it is ordinarily behind — but a held entry re-run by a later plan is back at a gate,
 * and the gate a reader is standing at is the one the band is most worth reading on. The
 * engine's own on `done` and nothing else: every other status is a gate that is still
 * ahead of this row, whatever the rule says it will do when it gets there. The third fact
 * — that nobody stood at it — is already subtracted from `marks`. See `MapRow.atGate`.
 */
const markOn = (status: MapRow["status"], mark: MarkDto | undefined): MarkDto | undefined => {
  if (mark === undefined) return undefined
  const reached = status === "done" || (mark._tag === "Held" && status === "gate")
  return reached ? mark : undefined
}

/** What is known about each gate, by entry, with the ones a person took subtracted. */
type Marks = ReadonlyMap<number, MarkDto>

/**
 * Which entries a **person** took the gate of, whatever the mode.
 *
 * The fact the wire cannot give, and the one that keeps the record honest: an unattended
 * trak is not one nobody is ever asked about. `auto` takes the plan gate and a filed
 * artifact's approval gate and no others, so a failing check, a step that gave up, a
 * step's questions past the answering limit and the composer's own questions all still
 * park — and a document a person read and approved at one of those was drawn here as one
 * nobody read.
 *
 * **Written once over every gate rather than a case per gate**, because a rule that
 * enumerates gates is one the next mode widens out from under. What it asks is the same
 * question at all of them: did a person's press *move the plan past this position*.
 * `Approve` and `Skip` are the two that do — `decide`'s `onHumanAction` routes both to
 * `keepStep` and nothing else there — so:
 *
 * - **A `Chat` is not a press through the gate.** A prose reply hands back the same gate
 *   with the same press still on offer, so a person who argued and then let the step
 *   re-file has approved nothing and the mark stands.
 * - **`AnswerQuestions` is not one either.** At an answers gate a person settles a
 *   *question*, and the approval gate that follows really was taken by the engine — which
 *   is the case that makes *a person touched this position* the wrong fact to ask for.
 * - **`Replan` is not one.** It sends the work back to the composer rather than taking it.
 *
 * **A composer gate records a nominal `step: 0`** (`filed.ts` says why), so `e.step` is
 * read only where the gate that is open belongs to a step. Which gate that is comes from
 * `opensGate`, shared with `failedAt` in `planView.ts` so the two cannot answer
 * differently — a stop opens a gate at either end, and a walk that missed it read a
 * stopped re-compose's plan gate as a step's. Which compose entry a plan gate belongs to
 * comes from the run that opened it: the engine writes one entry the first time a session
 * lands one, so the k-th session to do so is the k-th compose entry — the same fact
 * `mapRows` zips its runs on, asked of the log because this needs no transcript.
 * `landedEntry` is which returns count. Without that, a person answering the composer
 * would blank the mark on plan entry zero, and on a child trak — born holding a plan, so
 * its entry zero is a real step — it would blank a step's.
 */
const stoodAt = (log: readonly EventDto[], entries: readonly EntryDto[]): ReadonlySet<number> => {
  const composeAt = entries.flatMap((e, i) => (e.type === "compose" ? [i] : []))
  const took = new Set<number>()
  /** Sessions that have landed a compose entry, in order. */
  const landed: string[] = []
  /** The entry whose gate is open, and whether it is the composer's. */
  let open: { readonly at: number | undefined; readonly compose: boolean } | undefined

  for (const e of log) {
    const opened = opensGate(e)
    if (opened?._tag === "Composer") {
      const seen = opened.session === undefined ? -1 : landed.indexOf(opened.session)
      open = { at: composeAt[seen >= 0 ? seen : landed.length], compose: true }
      // Which runs have landed is the composer's own bookkeeping rather than the gate's,
      // so it stays here: only a return carries an output to read `landedEntry` off.
      if (e._tag === "ComposerReturned" && seen < 0 && landedEntry(e.output))
        landed.push(e.sessionId)
    } else if (opened !== undefined) {
      open = { at: opened.at, compose: false }
    } else if (e._tag === "HumanActed") {
      if (e.action._tag !== "Approve" && e.action._tag !== "Skip") continue
      // `e.step` wherever it means something, and the open run's entry where it does not.
      const at = open?.compose === true ? open.at : e.step
      if (at !== undefined) took.add(at)
      open = undefined
    }
  }

  return took
}

/**
 * The sessions that have landed a compose entry, in the order they did — which is the
 * order of the compose entries themselves: the engine writes one entry the first time a
 * session lands one, so the k-th session here is the k-th compose entry's. `stoodAt`
 * walks the same fact incrementally, because it needs the list as it stood at each gate.
 *
 * **Asked of the log rather than the transcript**, and that is the point of it. A run's
 * session is on both, but only the log says whether the entry has *landed*: an entry
 * something asked for stands in the plan before its turn has started, and a settled
 * entry whose transcript is not on the wire has no run to be found by either — and the
 * two have to read differently, *not started* and *done*. Zipping the transcript's runs
 * against the entries could not tell them apart.
 */
const landedSessions = (log: readonly EventDto[]): readonly string[] => {
  const landed: string[] = []
  for (const e of log)
    if (e._tag === "ComposerReturned" && landedEntry(e.output) && !landed.includes(e.sessionId))
      landed.push(e.sessionId)
  return landed
}

/**
 * The marks by entry, less the engine's own on a gate a person took instead. A `Held`
 * mark is the person's press and is never subtracted.
 */
const marksBy = (marks: readonly MarkDto[], byHand: ReadonlySet<number>): Marks =>
  new Map(marks.flatMap((m) => (m._tag !== "Held" && byHand.has(m.at) ? [] : [[m.at, m] as const])))

/**
 * The ending, as a row — or nothing, at a trak whose plan has not run out.
 *
 * **Its caption is the state's own words**, straight off `trakLabel`, which is what keeps
 * one place deciding what a finished trak is called: a `StepStatus` says how a plan entry
 * went, and this row is not one. The label is `undefined` at a single state
 * (`AwaitingChildren`) and none of the five here is it.
 *
 * **`trakLabel`'s second fact comes from the log rather than from the state**, which is
 * why this takes one. It is the same answer the list row is sent on its summary, so the
 * caption under the step bar and the pile the trak sits in say one thing — and this row's
 * caption is drawn a hand's width under the pane that says it in a sentence.
 *
 * **A wait rewords the row and gives it the wait's tone.** Parked, it reads *Held* over
 * `held on` and the wait's own slot — `waitSlot`'s words, never a second set — with the
 * ending's own phrase dropped: a person met *Held* mid-plan and *Finished · Ready to merge*
 * at the foot and read two claims about where the trak had got to. The flag stays; the tone
 * is `waitTone`'s and not `trakLabel`'s, because `trakLabel` answers `good` for a
 * `Finished` trak with nothing to merge, and a trak parked before its first commit drew a
 * green *Held* row over entries nothing had reached — the green this work set out to
 * remove. `waitTone` is also what the held entry's badge under it wears, so the two agree.
 * Where the row stands is `withEnding`.
 */
const endRow = (
  state: TrakStateDto,
  moved: boolean,
  /** `handedUp`, off the same log — what the ending row carries for `TrakMap`'s badge. */
  handUp: string | undefined,
  parked: Parked | undefined,
): MapRow | undefined => {
  const ending = finishedPosition(state)
  if (ending === undefined) return undefined
  const own = trakLabel(ending, moved)
  const said: { readonly title: string; readonly label: string; readonly tone: Tone } =
    parked === undefined
      ? { title: endingTitle(ending), label: own.label ?? "", tone: own.tone }
      : {
          title: "Held",
          label: `held on ${waitSlot(parked.at, parked.now)}`,
          tone: waitTone(parked.at),
        }
  return {
    key: END_KEY,
    at: -1,
    kind: "end",
    status: undefined,
    tone: said.tone,
    // One glyph rather than one per ending: the tone already says which — `waiting` while
    // work is held for a merge, `good` where there is none to make or one has been made,
    // `working` while a merge or a close runs, `neutral` closed, and `waitTone`'s answer
    // wherever the row is parked instead — and a second signal saying the same thing is a
    // second thing that can disagree with it.
    mark: Flag,
    title: said.title,
    // The clause is the phone's whole channel: the directive block draws the caption and
    // the strip draws no hand-up, so a piece that asked for work has to say so in the words.
    caption: handUp === undefined ? said.label : `${said.label} · handed work up`,
    pieces: undefined,
    // The merge commit on the host branch, in the slot a step's own commit takes — the
    // row's right-hand side answers *what did this leave behind* everywhere on the map,
    // and for the ending that is where the work landed.
    sha: ending._tag === "Merged" ? ending.sha : undefined,
    turns: [],
    // Never marked: it has no plan entry behind it and therefore no gate anybody could
    // have been asked at. The presses it does offer are a person's alone.
    atGate: undefined,
    handUp,
    // No turns of its own, so nothing here can be outstanding.
    outstanding: 0,
    continues: undefined,
    ...NO_MODEL,
    // The wait is said in the words and carried as the fact; the badge is the held entry's.
    badge: undefined,
    waiting: parked?.at,
  }
}

/**
 * The ending among the entries: after the last one — or, on a trak parked at a wait,
 * immediately before the entry the wait holds, so the plan reads *this ran, here it
 * stopped, this is still owed*. `waiting.step` is an index into the same list the rows
 * were built from, one row per entry, so the slice lands the ending on it; a wait naming
 * an entry the plan no longer has falls back to the foot rather than dropping the row.
 */
const withEnding = (drawn: readonly MapRow[], end: MapRow | undefined): readonly MapRow[] => {
  if (end === undefined) return drawn
  const at = end.waiting?.step
  return at !== undefined && at < drawn.length
    ? [...drawn.slice(0, at), end, ...drawn.slice(at)]
    : [...drawn, end]
}

/** The mark on a compose entry something asked for — a step, a person, or git. */
const ASKED: Badge = {
  glyph: Hand,
  // `waiting` rather than a colour of its own: the hand-up arrow already spends amber on
  // *this piece asked for work*, and an ask is that same fact one level in.
  tone: "waiting",
  says: "something asked for this",
}

/**
 * The corner mark entry `i` wears: the wait holding it, else — on a compose entry that
 * carries a `why` — that something asked for it rather than the composer scheduling it.
 * The wait first, because it is the more immediate fact about the row.
 */
const badgeOn = (entry: EntryDto, i: number, parked: Parked | undefined): Badge | undefined => {
  if (parked !== undefined && parked.at.step === i)
    return {
      glyph: waitGlyph(parked.at),
      tone: waitTone(parked.at),
      says: `held — ${waitSlot(parked.at, parked.now)} ${waitPhrase(parked.at)}`,
    }
  return entry.type === "compose" && entry.why !== undefined ? ASKED : undefined
}

/**
 * The three facts a row carries about the model its turn runs on, off the entry the
 * engine resolved them onto — all three absent together on an entry that is not an
 * agent's, since a compose and a spawn have no `AgentStepDto` to read them from.
 */
const modelOf = (entry: PlanDto["steps"][number]): Pick<MapRow, "model" | "window" | "effort"> =>
  entry.type === "agent"
    ? { model: entry.model, window: entry.contextWindow, effort: entry.effort }
    : NO_MODEL

export const mapRows = (
  state: TrakStateDto,
  log: readonly EventDto[],
  plan: PlanDto | undefined,
  turns: readonly Turn[],
  /** What happened at each gate — `TrakDetailDto.marks`, straight across. */
  marks: readonly MarkDto[],
  /**
   * The library, for the mark each step's agent wears. Empty while the query is out,
   * which draws the fallback rather than nothing — see `agentGlyph`.
   */
  agents: readonly AgentDto[],
  /** The wait the trak is parked at — `TrakDetailDto.waiting` — and the instant, or nothing. */
  parked: Parked | undefined,
): readonly MapRow[] => {
  const entries = plan?.steps ?? []
  const byEntry = marksBy(marks, stoodAt(log, entries))
  const statuses = stepStatuses(state, log, entries.length)
  const end = endRow(state, branchMoved(log), handedUp(log), parked)
  // One run per compose entry, in the same order — the engine writes one entry the first
  // time a session lands one, so zipping them is a fact rather than a guess. The turns
  // come from the transcript; whether the entry has landed comes from the log.
  const runs = composerRuns(turns)
  const landed = landedSessions(log)
  const composes = entries.filter((e) => e.type === "compose").length

  if (entries.length === 0)
    return [
      mapRow(
        {
          key: "compose:0",
          at: 0,
          kind: "compose",
          status: composerStatus(state, log, undefined, true),
          mark: ListTree,
          title: "composer",
          caption: composerCaption(plan),
          pieces: undefined,
          sha: undefined,
          // **Every composer turn there is, and not none.** A trak with no plan entries
          // is not a trak nothing has run — it is one whose composer has not *landed* a
          // plan, which is also every trak still composing and every trak whose first run
          // asked a question instead. Handing this row an empty list drew *Nothing has run
          // here yet* over a live transcript, and — because the question card rides in a
          // turn — left a composer's first questions with no form to answer them in, on
          // the one screen that is meant to ask them. All the runs rather than the newest:
          // one row stands for the composer here, so it accounts for all of it.
          turns: runs.flatMap((run) => run.turns),
          continues: undefined,
          ...NO_MODEL,
          badge: undefined,
        },
        byEntry,
      ),
      ...(end === undefined ? [] : [end]),
    ]

  // A last entry with no run of its own is still to come — and only where the composer
  // scheduled it, which is what `why`'s absence says. An entry carrying one was written the
  // moment something asked, so the turn it stands for is the one happening right now,
  // including the first second of it, before the run has a line in the transcript to be
  // found by.
  //
  // **`runs.length < composes` is what carries this, and the entry's own shape cannot.** A
  // landed compose is usually not the last entry, because the engine appends the steps it
  // proposed straight after it — but the answer that says the work is already done appends
  // none, so that one ends the plan looking exactly like a turn nobody has taken. Counting
  // runs against entries tells them apart; reading the entry does not.
  const last = entries.at(-1)
  const stillToCome = last?.type === "compose" && last.why === undefined && runs.length < composes
  // **Which entry the state is describing, and it is not simply the last compose.** A plan
  // that ends in a re-cut the composer scheduled has an entry nothing has run, where the
  // state is answering about the run that landed several entries back — so reading it onto
  // that entry left the plan gate with no row reading `gate` at all, and `DrawerPane` hangs
  // the approval on the row that does. A trak whose first plan stopped short could not be
  // approved from this surface.
  const liveAt = composes - (stillToCome ? 2 : 1)

  let seen = 0
  const drawn = entries.map((entry, i): MapRow => {
    if (entry.type !== "compose") {
      const own = stepTurns(turns, i)
      return mapRow(
        {
          key: `step:${String(i)}`,
          at: i,
          kind: "step",
          status: statuses[i] ?? "todo",
          mark: entryMark(entry, agents),
          title: entryName(entry),
          caption: entry.instruction,
          pieces: piecesOf(entry),
          sha: keptAt(log, i),
          turns: own,
          continues:
            entry.type === "agent"
              ? continuesOf(entry.continues, own, entries, turns, runs)
              : undefined,
          ...modelOf(entry),
          badge: badgeOn(entry, i, parked),
        },
        byEntry,
      )
    }
    const run = runs[seen]
    // Which session landed this entry, off the log — `undefined` where none has yet.
    const session = landed[seen]
    const first = seen === 0
    // The newest run is the one the trak's state is describing; every earlier one is
    // settled and answers from its own session alone. Which entry that is, is `liveAt`.
    const live = seen === liveAt
    // The entry still to come reads `todo` rather than whatever the state is saying about
    // somewhere else. An ask nothing has run for yet reads `todo` too, by a different
    // route: it is live, and with no landed session `composerStatus` has nothing to call
    // `done`.
    const pending = stillToCome && i === entries.length - 1
    seen += 1
    return mapRow(
      {
        key: `compose:${String(i)}`,
        at: i,
        kind: first ? "compose" : "recompose",
        status: pending ? "todo" : composerStatus(state, log, session, live),
        // One family for both: a *list* is what the composer produces, and the second
        // says it was produced again. A rotating arrow would read as a retry.
        mark: first ? ListTree : ListRestart,
        title: first ? "composer" : "re-compose",
        // Three sources, one each. A compose the composer planned says what it is for; one
        // something asked for says what it was asked; and the run that wrote the plan is
        // the only one that may caption itself with its title.
        caption:
          entry.instruction ??
          (entry.why === undefined ? composerCaption(plan) : whyText(entry.why)),
        pieces: undefined,
        sha: undefined,
        turns: run?.turns ?? [],
        continues: undefined,
        ...NO_MODEL,
        badge: badgeOn(entry, i, parked),
      },
      byEntry,
    )
  })
  return withEnding(drawn, end)
}

/**
 * What a press on one position is called, for a reader who cannot see the square.
 *
 * **The status word is appended only where there *is* one, and that is the whole of this
 * function.** Two rows carry no `StepStatus` by construction — the trak's own ending, and
 * a spawn piece's, which is the position that piece is merged from (`endRow` says why) —
 * and coercing that absence to `todo` names a merged piece *not started*. Their caption is
 * `trakLabel`'s own sentence, which already says where they stand, so the name is the
 * title and the caption and nothing else.
 *
 * **One function because two surfaces build this string**: the strip's full-size squares
 * and the 14px tiles inside a spawn. The tile had its own copy and got it wrong for
 * exactly as long as it had one, which is the drift `MapRow.mark` and `format/tone` exist
 * to stop one level down.
 *
 * `TrakMap` states the same rule and cannot share this. Its row already draws the title
 * and the caption as text, so it adds the status word alone in an `sr-only` span — an
 * `aria-label` there would replace the name the row actually has. The rule the three
 * agree on is *a row with no status is named without a status word*; only the two that
 * build a whole label share the code.
 */
export const positionName = (row: Pick<MapRow, "title" | "caption" | "status">): string =>
  `${row.title} — ${row.caption}${row.status === undefined ? "" : ` — ${statusText(row.status)}`}`

/**
 * Where the drawer points when nobody has picked a row.
 *
 * Always a real row: a trak with no plan yet opens on the composer, which is the thing
 * that is actually happening, and a trak whose plan has run out opens on its ending —
 * which is the position that has something to ask, where the last step it ran has not.
 *
 * Exported for `family.ts`, whose bands are one per row and in the same order — so the
 * index this returns names the band the parent is standing at, and the family's own
 * default position is that band's first spot.
 */
export const opensAt = (rows: readonly MapRow[], state: TrakStateDto): number => {
  const here = stepAt(state)
  if (here !== undefined) {
    const found = rows.findIndex((r) => r.key === `step:${String(here)}`)
    if (found >= 0) return found
  }
  // A failure has no step on the state — `stepAt` says why — so the row that reads
  // `failed` is where it died, and it is where the failure notice is drawn. Without this
  // a trak that stopped at step 1 of 5 opened on step 4 through the `lastStep` branch
  // below, with the explanation and its restart on a position nobody was looking at.
  // Falls through where no row reads it: a `worktree` or `engine` failure blames no
  // entry, and those land wherever the trak's plan left off. An `archive` failure blames
  // none either, and lands on the ending row below — where the press that archived was.
  if (state._tag === "Failed" && state.kind !== "archive") {
    const died = rows.findLastIndex((r) => r.status === "failed")
    if (died >= 0) return died
  }
  // Before the `planning` branch below, and before the last step: the seven states that
  // draw it carry no position and none of them is `planning`, so wherever this row exists
  // it is where the trak is — mid-plan included, where a wait has stood it before the
  // entry it holds.
  const end = rows.findIndex((r) => r.kind === "end")
  if (end >= 0) return end
  const lastStep = rows.findLastIndex((r) => r.kind === "step")
  if (planning(state) || lastStep < 0)
    // The newest composer row that has *run*, which the last one is not when the plan ends
    // in a re-cut the composer scheduled: the entry still to come is the only row that
    // reads `todo` here, and opening on it put a reader in front of *Nothing has run here
    // yet* while the proposal they were being asked to approve sat on the row above.
    return Math.max(
      rows.findLastIndex((r) => r.kind !== "step" && r.status !== "todo"),
      0,
    )
  return lastStep
}
