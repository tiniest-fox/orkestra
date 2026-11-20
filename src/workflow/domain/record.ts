// How a trak went, computed from its log. Pure, like everything else here.
//
// Nothing writes this down while a trak runs. The log is stored with the trak and
// this is a view of it, so it cannot drift, needs no write on the way to a terminal
// state, and needs no backfill for the traks already at rest. `high-level.md`
// decision 6 says the record is "stored with the trak"; the log is, and this is what
// reads it.
//
// **No agent writes it either.** A summariser is the worst-placed participant to
// decide what is forgettable — "the run went smoothly" about a trak where verify
// failed once is correct per-trak and destroys the only signal that mattered.
//
// **The record of a trak whose checkout is gone is also kept as files**, because a log
// is not something a
// person greps and `.orkestra/.trak/` goes with the worktree. `folder` and
// `recordFiles` say what that folder is called and what is in it;
// `src/app/records.ts` is what puts it on disk.

import { noUsage, type Usage } from "../../agent/types/usage.js"
import type { Event } from "./event.js"
import type { Document } from "./outputs/artifact.js"
import { stuckText } from "./outputs/stuck.js"
import { decisionsText, type Identified, identified } from "./outputs/decided.js"
import { artifactKey, instructionOf, isSpawn, stepName } from "./outputs/proposal.js"
import { documentFile, visibleArtifacts } from "./projection.js"
import { replayHistory } from "./replay.js"
import { type ChildRun, slotAt, type Trak, type TrakId } from "./trak.js"

// ============================================================================
// What a record is
// ============================================================================

/**
 * Where a trak's time went, split by who was holding it.
 *
 * Two numbers rather than one, because they are different findings: four hours
 * of turns is a fact about the work, and four hours parked is a fact about a
 * human's attention. A total alone cannot tell you which you have.
 *
 * Both are zero for a log written before events carried times, and `TrakRecord.timed`
 * is what says so — the record reports no duration rather than a false zero.
 */
export interface Elapsed {
  readonly working: number
  readonly waiting: number
}

/** Something a human typed instead of approving, kept exactly as they typed it. */
export interface Said {
  /** `undefined` at a gate the composer put them at, which has no step. */
  readonly step: number | undefined
  readonly text: string
}

/** A step that could not do the work, and its account of why. */
export interface Stuck {
  readonly step: number
  readonly account: string
}

/**
 * A step that did its work and sent the plan back anyway.
 *
 * Here because it is the symptom worth watching for: every entry buys a composer
 * turn and a plan gate, so a record where every step raised something is the channel
 * being filled out of diligence rather than consequence. Nothing else in a record
 * would show that — the work all succeeded.
 *
 * **Corrections and nothing else.** A requirement is in the record already, under the
 * intent it landed on, and printing it twice would make the section unreadable
 * exactly when it has something to say. Legacy `uncovered_work` joins them: it bought
 * the same round and landed nowhere else.
 */
export interface Corrected {
  readonly step: number
  readonly items: readonly string[]
}

/**
 * How a child of a spawn ended, and not a boolean.
 *
 * `ork close` on a child is a **drop** — a first-class ending whose work
 * deliberately did not go in, and whose ruled-out approach is often the most
 * valuable thing the piece produced. A record that read only whether the child came
 * back reported thrown-away work as work that shipped.
 *
 * `reported` is the same press on a child that had nothing to merge: a piece that
 * only wrote documents — a survey, a research pass — never moves its branch, so the
 * only door off its ending screen is the archive, and calling that a drop reports a
 * piece that did its job as work thrown away. The two are told apart by the child's
 * own log and nothing else: a drop has a commit on its branch, a report has none.
 */
export type ChildOutcome = "merged" | "dropped" | "reported" | "still going"

/** One trak a spawn position broke into, and where to read its own account. */
export interface ChildRecord {
  readonly id: TrakId
  readonly outcome: ChildOutcome
  /**
   * Its folder in the corpus — absent unless its log was handed to `record` *and*
   * replays to a state `keptInCorpus` accepts, which is exactly the pair of
   * conditions that writes one.
   */
  readonly folder: string | undefined
}

/** How one plan entry went. */
export interface StepRecord {
  readonly index: number
  /** The agent that ran it, or `spawn`. `artifactKey`'s second half. */
  readonly name: string
  readonly instruction: string
  /** Completed turns. More than one means it was sent back. */
  readonly iterations: number
  /** Turns that answered in prose rather than filing. */
  readonly conversations: number
  /** Every check failure at this position, in the order they happened. */
  readonly checkFailures: readonly string[]
  readonly skipped: boolean
  /** What the human said when they skipped it, if anything. */
  readonly skipNote: string | undefined
  readonly filed: boolean
  /** What this step's document is called in the corpus. Absent when it filed none. */
  readonly filedAs: string | undefined
  readonly children: readonly ChildRecord[]
  /**
   * What this position spent, **including what its children spent** — their cost is
   * the spawn's cost, and a parent reporting only its own says a fan-out was free.
   */
  readonly usage: Usage
  readonly elapsed: Elapsed
}

/**
 * What the composer spent, pulled back out of the overhead it lands in.
 *
 * Its turns carry no `step` — a plan has no index — so they fold into the trak's
 * overhead alongside worktree setup and the merge. That is the right bucket and the
 * wrong label: one row reading *setting up, composing, integrating* beside a column
 * of `compose` positions showing dashes reads as though re-planning were free.
 *
 * **Not attributed to the `compose` positions instead**, because there is no
 * mapping: a trak can run nine composer turns against six of them, since the first
 * proposal and every `questions` turn belong to no position at all.
 */
export interface Composing {
  readonly turns: number
  readonly usage: Usage
  readonly elapsed: Elapsed
}

/**
 * One trak, as a reader finds it afterwards.
 *
 * Facts only. No totals ranked, no thresholds, no score — the moment
 * tokens-per-trak is a number someone wants down, you get cheaper worse work and
 * the metric faithfully reports improvement. Cost appears beside the step that
 * spent it, because the finding is the **disagreement**: 200k tokens says nothing,
 * and 200k on a step the composer routed as trivial says the composer was wrong.
 */
export interface TrakRecord {
  readonly id: TrakId
  /** The H1, and what the folder is named after. A child's names its parent. */
  readonly headline: string
  readonly description: string
  /**
   * A child's own brief. Its `description` is its parent's request — which is
   * deliberate, and leaves the instruction it was actually given nowhere else to go.
   */
  readonly piece: string | undefined
  /** How it came to rest, or that it has not. The merge sha is `mergeSha`. */
  readonly outcome: string
  /** Where this trak's folder goes, relative to the corpus root. */
  readonly folder: string
  readonly branch: string | undefined
  readonly mergeSha: string | undefined
  readonly parent: { readonly id: TrakId; readonly step: number } | undefined
  /** A child's own only, numbered over the whole list first — see `record`. */
  readonly decisions: readonly Identified[]
  readonly steps: readonly StepRecord[]
  readonly said: readonly Said[]
  readonly stuck: readonly Stuck[]
  readonly corrected: readonly Corrected[]
  readonly composing: Composing
  /** Setting up, composing, integrating — everything that belongs to no step. */
  readonly overhead: { readonly usage: Usage; readonly elapsed: Elapsed }
  readonly usage: Usage
  readonly elapsed: Elapsed
  /** False when the log predates `at`, and every duration above is meaningless. */
  readonly timed: boolean
  readonly events: number
  /** Every document the trak filed, in plan order. `recordFiles` writes them out. */
  readonly artifacts: readonly (readonly [string, Document])[]
}

/**
 * The logs of the traks a record is joined to — its parent, and a spawn's children.
 *
 * Passed in rather than fetched, because this file may not do I/O and because the
 * roll-up is the one thing a record cannot compute from its own log: a child's spend
 * is in the child's log, and so is the day its folder is filed under. `relatedTraks`
 * is what a caller asks to know which ones to read.
 */
export type Related = ReadonlyMap<TrakId, readonly Event[]>

// ============================================================================
// Reading the log
// ============================================================================

/** Which position an event belongs to. `undefined` is the trak's own overhead. */
const stepOf = (e: Event): number | undefined => ("step" in e ? e.step : undefined)

const usageOf = (e: Event): Usage | undefined => ("usage" in e ? e.usage : undefined)

const plus = (a: Usage, b: Usage): Usage => {
  const tools: Record<string, number> = { ...a.tools }
  for (const [name, calls] of Object.entries(b.tools)) tools[name] = (tools[name] ?? 0) + calls
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: a.costUsd + b.costUsd,
    tools,
  }
}

/** Tools stay with the left side: they are counted once, on the whole trak. */
const minus = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens - b.inputTokens,
  outputTokens: a.outputTokens - b.outputTokens,
  cacheReadTokens: a.cacheReadTokens - b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens - b.cacheWriteTokens,
  costUsd: a.costUsd - b.costUsd,
  tools: a.tools,
})

/** One interval between two consecutive events, and who was holding the trak. */
interface Gap {
  readonly step: number | undefined
  readonly ms: number
  readonly waiting: boolean
}

/**
 * Every interval in the log, attributed to the position that **ended** it.
 *
 * A pair with no time on either side contributes nothing rather than a zero, so a
 * log part-written before `at` existed reports what it can.
 *
 * A `HumanActed` closes a wait by definition: whatever came before it is what
 * parked the trak. The exception is a gate the composer put them at — `parkedAt`
 * records `step: 0` there because a plan has no index, and a human reading a plan
 * is the trak's overhead rather than its first step's.
 *
 * **A finished trak waiting to be merged is waiting too.** The interval before a
 * `Merged`, a `Closed` or an `Abandoned` is a person deciding, and nothing else:
 * without this a branch that sat for a working day reported six hours of *work*
 * against an overhead row that spent nothing.
 */
const gapsIn = (history: readonly Event[]): readonly Gap[] => {
  const out: Gap[] = []
  for (const [i, cur] of history.entries()) {
    const prev = history[i - 1]
    if (prev?.at === undefined || cur.at === undefined) continue
    const atComposerGate = prev._tag === "ComposerReturned"
    out.push({
      step: atComposerGate ? undefined : stepOf(cur),
      ms: cur.at - prev.at,
      waiting: decidedByHand(cur),
    })
  }
  return out
}

/** The events only a person produces: approving, typing, skipping a wait, and every ending. */
const decidedByHand = (e: Event): boolean =>
  e._tag === "HumanActed" ||
  e._tag === "Merged" ||
  e._tag === "Closed" ||
  e._tag === "Abandoned" ||
  e._tag === "Reentered" ||
  e._tag === "WaitSkipped"

const totalMs = (gaps: readonly Gap[]): number => gaps.reduce((n, g) => n + g.ms, 0)

const elapsedFor = (gaps: readonly Gap[], step: number | undefined): Elapsed => {
  const mine = gaps.filter((g) => g.step === step)
  return {
    working: totalMs(mine.filter((g) => !g.waiting)),
    waiting: totalMs(mine.filter((g) => g.waiting)),
  }
}

const usageFor = (history: readonly Event[], step: number | undefined): Usage =>
  history
    .filter((e) => stepOf(e) === step)
    .reduce((u, e) => plus(u, usageOf(e) ?? noUsage), noUsage)

/**
 * What a human typed instead of approving, verbatim.
 *
 * Approving is the ordinary answer and says nothing; typing is the correction, and
 * it is the one part of a record no computed count can stand in for. Answers are
 * joined rather than numbered — the questions they answer are in the log beside
 * them, and this is a report of what was said.
 */
const saidIn = (history: readonly Event[]): readonly Said[] => {
  const out: Said[] = []
  for (const [i, e] of history.entries()) {
    if (e._tag !== "HumanActed") continue
    const atComposerGate = history[i - 1]?._tag === "ComposerReturned"
    const step = atComposerGate ? undefined : e.step
    if (e.action._tag === "Chat") out.push({ step, text: e.action.message })
    if (e.action._tag === "AnswerQuestions") {
      out.push({ step, text: e.action.answers.join(" · ") })
      // An entry of its own rather than another item in that join. The join is the
      // answers in the order the questions were asked, so a note inside it reads as
      // an answer to the last question — a wrong attribution, not an untidy one.
      if (e.action.note !== undefined) out.push({ step, text: e.action.note })
    }
  }
  return out
}

/** Every step that could not do the work, whatever the person at the gate did. */
const stuckIn = (history: readonly Event[]): readonly Stuck[] =>
  history.flatMap((e) =>
    e._tag === "AgentReturned" && e.output.type === "stuck"
      ? [{ step: e.step, account: stuckText(e.output) }]
      : [],
  )

/**
 * Every step that filed its work and sent the plan back, one entry per step however
 * many turns filed under it.
 *
 * A step sent back files its whole artifact again, corrections included, so the raw
 * log repeats it verbatim. Collapsed here rather than at the render, because a step
 * that said one thing twice said one thing.
 */
const correctedIn = (history: readonly Event[]): readonly Corrected[] => {
  const by = new Map<number, string[]>()
  for (const e of history) {
    if (e._tag !== "AgentReturned" || e.output.type !== "artifact") continue
    const out = e.output
    const items = [
      ...(out.corrections ?? []).map((c) => `\`${c.at}\` — ${c.text}`),
      ...(out.uncovered_work ?? []),
    ]
    if (items.length === 0) continue
    const held = by.get(e.step) ?? []
    for (const item of items) if (!held.includes(item.trim())) held.push(item.trim())
    by.set(e.step, held)
  }
  return [...by.entries()].map(([step, items]) => ({ step, items }))
}

const countAt = (history: readonly Event[], step: number, is: (e: Event) => boolean): number =>
  history.filter((e) => stepOf(e) === step && is(e)).length

const composingIn = (history: readonly Event[]): Composing => {
  let usage = noUsage
  let working = 0
  let waiting = 0
  for (const [i, cur] of history.entries()) {
    const prev = history[i - 1]
    if (cur._tag === "ComposerReturned") usage = plus(usage, cur.usage ?? noUsage)
    if (prev?.at === undefined || cur.at === undefined) continue
    // The composer's own turn, then the wait at the gate its proposal opened.
    if (cur._tag === "ComposerReturned") working += cur.at - prev.at
    else if (prev._tag === "ComposerReturned" && decidedByHand(cur)) waiting += cur.at - prev.at
  }
  return {
    turns: history.filter((e) => e._tag === "ComposerReturned").length,
    usage,
    elapsed: { working, waiting },
  }
}

// ============================================================================
// Where a record goes — the corpus layout
//
// A day directory holding a folder per trak, and every name derived from the log
// rather than chosen: a corpus accumulates under whatever shape ships first, and
// every reader after learns it.
// ============================================================================

/**
 * Long enough to recognise a trak by, short enough to list.
 *
 * Cut at a word boundary rather than mid-word, because the truncation is read: a
 * folder called `header-overflow-menu-for-ending-a-tra` looks like a bug.
 */
const SLUG_MAX = 40

const slug = (s: string): string => {
  const words = s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .split("-")
  const kept: string[] = []
  for (const word of words) {
    if (kept.join("-").length >= SLUG_MAX) break
    kept.push(word)
  }
  return kept.join("-")
}

/**
 * Whether the corpus holds a folder for this trak: its checkout is gone, so the
 * documents it filed have no other way out of the log.
 *
 * **`Merged`, `Closed` and `Abandoned`, and never `Finished`.** A finished trak still
 * holds its checkout and can go on to merge, and `restedOn` dates a folder by the
 * merge where there is one — so a trak filed at `Finished` and again at `Merged`
 * would be two folders on two days. The one predicate for the corpus' two writers
 * and for the link a parent's record draws to a child, so none of them can point at
 * a folder another never writes.
 */
export const keptInCorpus = (trak: Trak): boolean =>
  trak.state._tag === "Merged" || trak.state._tag === "Closed" || trak.state._tag === "Abandoned"

/**
 * The day the trak came to rest, which for a merged one is the day it landed.
 *
 * The merge is the moment the record is written and the only date that never needs
 * revising, so a day directory answers *what landed*. A trak that ended without one
 * takes the day of its last event, which is the archive. Filing by creation day
 * would scatter a trak across the week it ran.
 */
const restedOn = (history: readonly Event[]): string => {
  const merged = history.find((e) => e._tag === "WorkMerged")
  const at = merged?.at ?? history.at(-1)?.at
  return at === undefined ? "undated" : new Date(at).toISOString().slice(0, 10)
}

/**
 * What a trak is called before its title exists, which is every trak until the
 * composer's first turn — and the name a child is derived from.
 */
const nameOf = (trak: Trak, id: TrakId): string =>
  trak.plan?.title ?? trak.description.trim().split("\n")[0] ?? id

/**
 * A child's folder is its parent's name plus which piece, so a day's listing puts
 * the three together with the parent first.
 *
 * **Not the child's own title**, which `childPlan` sets to the whole of its first
 * step's instruction — 340 characters of prose in the worked case, unusable as a
 * heading and worse as a directory. Fixing that upstream means a `title` on `Child`.
 */
const stemFor = (name: string, piece: number | undefined): string =>
  piece === undefined ? slug(name) : `${slug(name)}-piece-${piece}`

/**
 * The day, the stem, and the whole id — **never a prefix of one.**
 *
 * The id is what makes two traks with the same title on the same day two
 * directories, and it is the string a reader takes back to `ork resume` or to
 * `.orkestra/.database/traks/`. A trak is named with three words, so eight
 * characters of one is a fragment of its adjective: it matches no directory and
 * nothing accepts it, since a partial phrase names no trak. Shortening it would
 * also put the disambiguation back at risk — two phrases sharing an adjective
 * would collide here where two whole ids cannot.
 *
 * The ids already written as UUIDs are long, and are shown whole too: one rule
 * cannot tell the two forms apart and nothing here should have to.
 */
const folderFor = (history: readonly Event[], stem: string, id: TrakId): string =>
  `${restedOn(history)}/${stem}-${id}`

/**
 * What an artifact is called in the corpus: its key, zero-padded to two digits.
 *
 * `10.1-build` stays; `3-build` becomes `03-build`, so a folder of thirteen lists in
 * plan order rather than as `1, 10.0, 10.1, 11, 13, 14, 16, 17, 3, 6, 8, 9`. The
 * cost is accepted: the same document is `3-build.md` in the live `.orkestra/.trak/`
 * and `03-build.md` here. A piece's folder and each document in it are padded
 * alike, for the same sort.
 */
const fileFor = (key: string): string =>
  `${key
    .split("/")
    .map((part) => part.replace(/^(\d)(?=[.-])/, "0$1"))
    .join("/")}.md`

// ============================================================================
// record
// ============================================================================

/**
 * How it came to rest, in the words a reader wants.
 *
 * Abandonment reads as its own outcome rather than as a kind of failure, because
 * that is what it is: a person decided, nothing broke, and *tried three times,
 * gave up, did it by hand* is the finding. Their reason is quoted rather than
 * summarised — it is the only sentence here nobody could have computed, and it is
 * optional, because ending an agent's turn never required an explanation. Nothing
 * said is `abandoned` and no dash: a separator with nothing after it reads as a
 * reason the record lost.
 *
 * **And there may be no reason.** The drawer's ending sends the empty string, because
 * interrupting an agentic session never requires a message — so the dash goes with the
 * sentence rather than standing there with nothing after it.
 *
 * `finished`, `closed` and `merged` are three outcomes for the same reason: the
 * first is a trak whose plan ran out and which nobody has decided anything about,
 * the second is one somebody was done with, and the third is one whose work went
 * somewhere. A corpus that could not tell them apart would report every held trak
 * as a completed one.
 *
 * **The merge sha is not here**, though the state carries it: this line is the one a
 * cross-trak grep reads, and a 40-character hash in it is 40 characters of nothing.
 * It goes on a pointer, which is what a reader wanting it is looking for anyway.
 */
const outcomeOf = (t: Trak): string => {
  const s = t.state
  if (s._tag === "Finished") return "finished"
  if (s._tag === "Closed") return "closed"
  if (s._tag === "Merged") return "merged"
  if (s._tag === "Abandoned") return s.reason === "" ? "abandoned" : `abandoned — ${s.reason}`
  if (s._tag === "Failed") return `failed (${s.kind}) — ${s.error}`
  return `still going — ${s._tag}`
}

/**
 * Whether anything was kept on the branch: a `WorkCommitted` carrying a sha.
 *
 * The hash and never the event — `CommitWork` runs at every step boundary whether
 * or not anything landed, and records no sha when the branch tip is where the
 * checkout started. `src/app/dto.ts`'s `branchMoved` is the same predicate on the
 * wire, and the two have to agree: a child this reads as `reported` is one whose
 * ending screen withheld Merge.
 */
const branchMoved = (log: readonly Event[]): boolean =>
  log.some((e) => e._tag === "WorkCommitted" && e.sha !== undefined)

/**
 * How a child ended, read from the child's own log — the same thing that decides
 * whether a folder was ever written for it.
 *
 * A close with nothing on the branch is the report, not the drop: the child wrote
 * documents and no code, so the archive was the only press on offer. An abandonment
 * is a drop whatever the branch holds — a person ended it before its plan ran out,
 * so what it wrote is not a piece that did its job.
 *
 * The parent's landing answers only where the log is gone, and it cannot tell a
 * report from a drop — `landOnParent` files a landing with no `sha` for both, since
 * the sha is where the work landed on the parent and neither landed any. A child
 * whose log was wiped reads as the drop, which is the older of the two readings.
 */
const childOutcome = (
  run: ChildRun,
  child: Trak | undefined,
  log: readonly Event[] | undefined,
): ChildOutcome => {
  const state = child?.state._tag
  if (state === "Merged") return "merged"
  if (state === "Closed") return log !== undefined && branchMoved(log) ? "dropped" : "reported"
  if (state === "Abandoned") return "dropped"
  // Failed, finished-and-undecided, or parked at a gate: all of them are a piece
  // nobody has settled, which is what a reader of the parent's row needs to know.
  if (state !== undefined) return "still going"
  if (run.landing === undefined) return "still going"
  return run.landing.sha === undefined ? "dropped" : "merged"
}

/** What a spawn's children cost, and where each one's own record is. */
const childrenOf = (
  trak: Trak,
  index: number,
  name: string,
  related: Related,
): readonly ChildRecord[] =>
  slotAt(trak, index).children.map((run, piece) => {
    const log = related.get(run.id)
    const child = log === undefined ? undefined : replayHistory(run.id, log)
    return {
      id: run.id,
      outcome: childOutcome(run, child, log),
      // Linked on the condition that writes a folder and on no other: both
      // `keepRecord` and `writeCorpus` file a log that replays to a state
      // `keptInCorpus` accepts, so linking on *a log exists* would point a child
      // still going at a path nothing has created.
      folder:
        log === undefined || child === undefined || !keptInCorpus(child)
          ? undefined
          : folderFor(log, stemFor(name, piece + 1), run.id),
    }
  })

/**
 * A spawn's row carries what its children **spent**, and not what they took.
 *
 * Cost adds; time does not. The children ran concurrently and the parent was parked
 * for the whole of it, so the parent's own gap across the spawn position already
 * contains their wall clock — adding theirs on top reported a two-day trak as
 * thirty-two hours of work.
 */
const spentAt = (
  history: readonly Event[],
  index: number,
  kids: readonly (readonly Event[])[],
): Usage =>
  kids.reduce(
    (u, log) => log.reduce((k, e) => plus(k, usageOf(e) ?? noUsage), u),
    usageFor(history, index),
  )

const stepRecord = (
  trak: Trak,
  history: readonly Event[],
  gaps: readonly Gap[],
  index: number,
  related: Related,
): StepRecord => {
  const step = trak.plan?.steps[index]
  const slot = slotAt(trak, index)
  const children = childrenOf(trak, index, nameOf(trak, trak.id), related)
  const filed = step !== undefined && !isSpawn(step) && trak.artifacts.has(artifactKey(step, index))
  return {
    index,
    name: step === undefined ? "?" : stepName(step),
    instruction: (step === undefined ? undefined : instructionOf(step)) ?? "",
    iterations: slot.iterations,
    conversations: countAt(
      history,
      index,
      (e) => e._tag === "AgentReturned" && e.output.type === "message",
    ),
    checkFailures: history.flatMap((e) =>
      e._tag === "CheckFailed" && e.step === index ? [e.name] : [],
    ),
    skipped: slot.skipped,
    skipNote: slot.skipNote,
    filed,
    filedAs: filed ? fileFor(artifactKey(step, index)) : undefined,
    children,
    usage: spentAt(
      history,
      index,
      children.flatMap((c) => {
        const log = related.get(c.id)
        return log === undefined ? [] : [log]
      }),
    ),
    elapsed: elapsedFor(gaps, index),
  }
}

/**
 * The traks whose logs `record` wants beside this one: its parent, and every child
 * of every spawn position.
 *
 * Exported so a caller reads exactly what the record can use and nothing more —
 * without it the alternative is handing `record` a `Store`, which is the dependency
 * `domain/` does not take.
 */
export const relatedTraks = (id: TrakId, history: readonly Event[]): readonly TrakId[] => {
  const trak = replayHistory(id, history)
  const kids = (trak.plan?.steps ?? []).flatMap((_s, i) =>
    slotAt(trak, i).children.map((run) => run.id),
  )
  return trak.parent === undefined ? kids : [trak.parent.id, ...kids]
}

/**
 * The whole record, from an id, its log, and the logs of the traks it is joined to.
 *
 * It replays rather than taking a `Trak`, so the derived half and the raw half
 * cannot disagree about which trak they are describing.
 *
 * `related` is optional and an empty map is a complete answer: a record without its
 * children's logs reports the parent's own spend and links no child folder, which is
 * what `pnpm ork record` on a trak whose children were wiped should say.
 */
export const record = (
  id: TrakId,
  history: readonly Event[],
  related: Related = new Map(),
): TrakRecord => {
  const trak = replayHistory(id, history)
  const gaps = gapsIn(history)
  const steps = (trak.plan?.steps ?? []).map((_s, i) => stepRecord(trak, history, gaps, i, related))
  const overhead = { usage: usageFor(history, undefined), elapsed: elapsedFor(gaps, undefined) }
  const parentLog = trak.parent === undefined ? undefined : related.get(trak.parent.id)
  const parentName =
    trak.parent === undefined || parentLog === undefined
      ? undefined
      : nameOf(replayHistory(trak.parent.id, parentLog), trak.parent.id)
  const piece = trak.parent === undefined ? undefined : trak.parent.child + 1
  // Born holding its parent's decisions, and they are the head of the list because
  // `replayHistory` seeds from `TrakCreated.decisions` and appends. Told apart by
  // that count rather than by provenance: a child's step 0 files under `0-build`,
  // and so did its parent's, so the keys collide. Numbered before the slice for the
  // same collision: the child's own `0-build` entry is `0-build.2` everywhere else,
  // and a list numbered after the slice would call it `0-build.1` here alone.
  const created = history.find((e) => e._tag === "TrakCreated")
  const inherited = created?._tag === "TrakCreated" ? (created.decisions?.length ?? 0) : 0
  const merged = history.find((e) => e._tag === "WorkMerged")
  const ready = history.find((e) => e._tag === "WorktreeReady")
  return {
    id,
    headline: parentName === undefined ? nameOf(trak, id) : `${parentName} · piece ${piece ?? 1}`,
    description: trak.description,
    piece: trak.parent === undefined ? undefined : trak.plan?.title,
    outcome: outcomeOf(trak),
    folder: folderFor(history, stemFor(parentName ?? nameOf(trak, id), piece), id),
    branch: ready?._tag === "WorktreeReady" ? ready.worktree.branch : undefined,
    mergeSha: merged?._tag === "WorkMerged" ? merged.sha : undefined,
    parent: trak.parent === undefined ? undefined : { id: trak.parent.id, step: trak.parent.step },
    decisions: identified(trak.decisions).slice(inherited),
    steps,
    said: saidIn(history),
    stuck: stuckIn(history),
    corrected: correctedIn(history),
    composing: composingIn(history),
    overhead,
    usage: steps.reduce((u, r) => plus(u, r.usage), overhead.usage),
    elapsed: steps.reduce(
      (e, r) => ({
        working: e.working + r.elapsed.working,
        waiting: e.waiting + r.elapsed.waiting,
      }),
      overhead.elapsed,
    ),
    timed: history.some((e) => e.at !== undefined),
    events: history.length,
    artifacts: visibleArtifacts(trak, undefined),
  }
}

// ============================================================================
// Rendering — the record as something to read
// ============================================================================

/** Terse and comparable: five records only add up if they are written the same way. */
const duration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/**
 * Two decimals, and four only below a cent.
 *
 * A column of costs is read by comparing it, so one format for everything that
 * rounds legibly is worth more than precision nobody uses. Under a cent, two
 * decimals round every turn to `$0.00`, which is the one case where the precision
 * is the whole reading.
 */
const money = (usd: number): string => `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`

/**
 * Tokens, at the two magnitudes that occur.
 *
 * Cache reads run to hundreds of millions and output to hundreds of thousands, so
 * one unit for both would print either `0.6M` or `93200k`. Neither reads.
 */
const tokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

/**
 * What a turn wrote, and what it had to re-read to write it.
 *
 * Output and cache read, not all four: across the corpus that settled this, input
 * was 66k against 837M of cache read, and cache write tracked output closely enough
 * to say nothing on its own. The pair is the finding — 623k written against 93.2M
 * re-read is a step that spent its budget reloading context, and the ratio survives
 * the over-report the caveats name.
 */
const spentTokens = (u: Usage): string =>
  u.outputTokens === 0 && u.cacheReadTokens === 0
    ? "—"
    : `${tokens(u.outputTokens)} / ${tokens(u.cacheReadTokens)}`

const span = (e: Elapsed, timed: boolean): string =>
  timed ? `${duration(e.working)} / ${duration(e.waiting)}` : "— / —"

/** Busiest first: the shape of a turn's tool use is the finding, not the order. */
const toolsText = (u: Usage): string =>
  Object.entries(u.tools)
    .sort(([, a], [, b]) => b - a)
    .map(([name, calls]) => `${name} ×${calls}`)
    .join(", ")

/** The same check failing four times is one finding with a count, not four names. */
const failuresText = (names: readonly string[]): string =>
  [...new Set(names)]
    .map((name) => {
      const times = names.filter((n) => n === name).length
      return times === 1 ? name : `${name} ×${times}`
    })
    .join(", ")

/**
 * Each child, and which way it went — merged carries no word because it is the
 * ordinary answer, and a link only where there is a folder at the other end.
 *
 * The id whole, on `folderFor`'s rule: a child still going has no folder to link
 * to, so its id is the only way back to it and a prefix is not one.
 */
const childrenText = (children: readonly ChildRecord[], folder: string): string =>
  children
    .map((c) => {
      const label = `${c.id}${c.outcome === "merged" ? "" : ` (${c.outcome})`}`
      return c.folder === undefined ? label : `[${label}](${upTo(folder, c.folder)})`
    })
    .join(", ")

/**
 * A link from one trak's folder to another's, both relative to the corpus root.
 *
 * Hand-rolled rather than `node:path`: this is `domain/`, and the rule that keeps the
 * filesystem out of it does not make an exception for the cheap half. A day directory
 * is one segment, so the walk up is the number of segments in the source folder.
 */
const upTo = (from: string, to: string): string =>
  `${"../".repeat(from.split("/").length)}${to}/record.md`

/**
 * A compose position is the plan being rewritten, not work.
 *
 * It files nothing and spends nothing that lands on it — the composer's turn has no
 * index, so its cost is on the `composing` row. Rendered as *re-planned* with dashes
 * rather than `nothing filed; 0ms / 0ms; $0.0000`, which on a trak re-planned six
 * times was six rows of zeroes saying only that the plan changed.
 */
const stepRow = (s: StepRecord, r: TrakRecord): string => {
  if (s.name === "compose") return `| ${s.index} | compose | re-planned from here | — | — | — | — |`
  const notes = [
    ...(s.iterations > 1 ? [`${s.iterations} runs`] : []),
    ...(s.conversations > 0 ? [`${s.conversations} talked`] : []),
    ...(s.checkFailures.length === 0 ? [] : [`**${failuresText(s.checkFailures)} failed**`]),
    ...(s.skipped ? [`skipped${s.skipNote === undefined ? "" : ` — ${s.skipNote}`}`] : []),
    ...(s.children.length === 0 ? [] : [childrenText(s.children, r.folder)]),
    ...(s.filed || s.children.length > 0 ? [] : ["nothing filed"]),
  ]
  const filed = s.filedAs === undefined ? "—" : `[${s.filedAs}](${s.filedAs})`
  return `| ${s.index} | ${s.name} | ${notes.join("; ") || "—"} | ${span(s.elapsed, r.timed)} | ${spentTokens(s.usage)} | ${money(s.usage.costUsd)} | ${filed} |`
}

/**
 * The table, then the two rows that belong to no position.
 *
 * Two rather than one, because they are two findings: what the planning cost, and
 * what the machinery around it cost. One row hid every composer turn inside the
 * word *setting*.
 */
const stepTable = (r: TrakRecord): readonly string[] => {
  const rest = {
    usage: minus(r.overhead.usage, r.composing.usage),
    elapsed: {
      working: r.overhead.elapsed.working - r.composing.elapsed.working,
      waiting: r.overhead.elapsed.waiting - r.composing.elapsed.waiting,
    },
  }
  return [
    "| # | step | notes | working / waiting | out / read | cost | filed |",
    "|---|---|---|---|---|---|---|",
    ...r.steps.map((s) => stepRow(s, r)),
    ...(r.composing.turns === 0
      ? []
      : [
          `| — | composing | ${r.composing.turns} turns | ${span(r.composing.elapsed, r.timed)} | ${spentTokens(r.composing.usage)} | ${money(r.composing.usage.costUsd)} | — |`,
        ]),
    `| — | setting up, integrating | — | ${span(rest.elapsed, r.timed)} | ${spentTokens(rest.usage)} | ${money(rest.usage.costUsd)} | — |`,
  ]
}

/** Where `src/workflow/adapters/store-file.ts` keeps a trak, as a reader would type it. */
const LOGS = ".orkestra/.database/traks"

/**
 * The one line a cross-trak grep reads, and the pointers under it.
 *
 * Everything on the line is a number worth ranking a corpus by, which is why the
 * branch, the sha and the paths are bullets under it rather than on it: a header
 * that has to stay greppable stays short.
 *
 * **The id is the exception to short, and it leads the line.** What a grep over
 * the corpus is for is finding the trak again, and a prefix of a three-word name
 * is a fragment of one word — it matches nothing and names nothing. The merge sha
 * beside it *is* abbreviated, at git's own seven: that one is git's identifier and
 * git resolves a prefix of it.
 */
const headLines = (r: TrakRecord): readonly string[] => [
  `# ${r.headline}`,
  "",
  `\`${r.id}\` · ${r.outcome} · ${r.events} events · ${tokens(r.usage.outputTokens)} out, ${tokens(r.usage.cacheReadTokens)} read · ${money(r.usage.costUsd)}` +
    (r.timed
      ? ` · ${duration(r.elapsed.working)} working, ${duration(r.elapsed.waiting)} waiting`
      : ""),
  "",
  ...(r.branch === undefined
    ? []
    : [
        `- branch \`${r.branch}\`${r.mergeSha === undefined ? "" : ` → merged as \`${r.mergeSha.slice(0, 7)}\``}`,
      ]),
  // The database is machine-local and wipeable, so this promises a path and not that
  // it resolves. Rendering the transcript instead was tried and dropped: turn-splitting
  // lives in `client/`, and nothing outside `src/app/` reads a stored transcript.
  `- log \`${LOGS}/${r.id}/log.jsonl\` · turns \`${LOGS}/${r.id}/transcript.jsonl\``,
  ...(r.parent === undefined
    ? []
    : [
        `- a piece of step ${r.parent.step} of \`${r.parent.id}\` — its record is the one to read first`,
      ]),
  ...(r.steps.some((s) => s.children.length > 0)
    ? ["- broke into children; the table links the folder of each one whose checkout is gone"]
    : []),
]

/**
 * What a reader must not take at face value, named in the document rather than
 * anywhere else — a caveat a reader has to go and find is a caveat nobody applies.
 */
const SPAWN_TIME =
  "**A spawn row's time is the parent's own.** Children's cost rolls up; their wall " +
  "clock does not — they ran at the same time as each other, inside the parent's wait."

/**
 * The record as markdown.
 *
 * A heading is absent when its section is empty rather than saying "none" — the
 * same rule `trak.md` follows, and for the same reason: a line every reader skips
 * is the beginning of skipping the ones that matter.
 *
 * **The requirements come before the table**, which is the one ordering choice here
 * that is not chronological: the intent is what a corpus is read for, and the table
 * is a fact about one trak.
 */
export const recordText = (r: TrakRecord): string => {
  const parts = [...headLines(r), "", "## The request", "", r.description.trim()]
  if (r.piece !== undefined) parts.push("", "## This piece", "", r.piece.trim())
  if (r.decisions.length > 0) parts.push("", "## Requirements", "", decisionsText(r.decisions))
  if (r.steps.length > 0) parts.push("", "## How it went", "", ...stepTable(r))
  if (r.said.length > 0) {
    parts.push(
      "",
      "## What a human said",
      "",
      ...r.said.map(
        (s) => `- **${s.step === undefined ? "the plan" : `step ${s.step}`}** — ${s.text}`,
      ),
    )
  }
  // One section with the step on each bullet: a heading per step was five headings
  // for what a reader reads as one list.
  if (r.corrected.length > 0) {
    parts.push("", "## What sent the plan back", "")
    for (const c of r.corrected)
      parts.push(...c.items.map((item) => `- **step ${c.step}** — ${item}`))
  }
  for (const s of r.stuck) parts.push("", `## Step ${s.step} could not do the work`, "", s.account)
  const tools = toolsText(r.usage)
  if (tools !== "") parts.push("", "## Tools", "", tools)
  if (r.steps.some((s) => s.children.length > 0))
    parts.push("", "## Caveats", "", `- ${SPAWN_TIME}`)
  return `${parts.join("\n")}\n`
}

/**
 * The trak's folder in the corpus: the record, and every document it filed.
 *
 * The artifacts are the point of keeping anything — a summary is derivable from the
 * log forever, and the prose a trak wrote has no path out of it at all once the
 * worktree that held `.orkestra/.trak/` is gone.
 */
export const recordFiles = (r: TrakRecord): ReadonlyMap<string, string> =>
  new Map<string, string>([
    ["record.md", recordText(r)],
    ...r.artifacts.map(([key, doc]): readonly [string, string] => [
      fileFor(key),
      documentFile(key, doc, r.decisions),
    ]),
  ])
