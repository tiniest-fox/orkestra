/**
 * What a composer handed off, read off the log — the traks its hand-offs were opened as.
 *
 * Kind `pure`. The descriptions themselves ride the composer's answer (`ProposalDto` and
 * `FinishedDto` both carry `handOff`), so nothing here re-reads those; what the log adds
 * is the `HandedOff` that says the gate went past and names the traks, which is the one
 * fact that turns a description into a link.
 */

import type { EventDto } from "../../../../api/types"

/**
 * The traks one compose entry's hand-offs were opened as, and the branch they were cut
 * from. None and no branch on a goal's trak, whose hand-off went to the goal.
 */
export interface Opened {
  readonly step: number
  readonly base: string | undefined
  readonly ids: readonly string[]
}

/**
 * Where a hand-off at the gate goes: the branch a new trak would be cut from — absent
 * where the repository names none — or the goal whose composer places it,
 * `TrakDetailDto.handOffGoal`. Threaded from `DrawerPane` to `HandOffs`.
 */
export type HandOffBase = string | { readonly goal: string } | undefined

/**
 * Every hand-off this trak's log opened, in log order — one entry per compose run that
 * handed work off and had its gate go past.
 */
export const handedOffTraks = (log: readonly EventDto[]): readonly Opened[] =>
  log.flatMap((e) => (e._tag === "HandedOff" ? [{ step: e.step, base: e.base, ids: e.ids }] : []))

/**
 * The traks the compose entry at `step` handed off, or `undefined` while nothing has
 * opened them — which is the whole of the difference between the block that argues for
 * them at the gate and the one that points at them afterwards.
 *
 * The last such event at the position, on `handedUp`'s rule: a compose entry lands one
 * run and is named once, so there is at most one.
 */
export const openedAt = (log: readonly EventDto[], step: number): Opened | undefined =>
  handedOffTraks(log).findLast((o) => o.step === step)

/**
 * The goal the finish at `step` proposed started as, or `undefined` while it has not —
 * `GoalOpened`, written once the trak finished and the goal began.
 */
export const goalOpenedAt = (log: readonly EventDto[], step: number): string | undefined =>
  openedGoals(log).findLast((o) => o.step === step)?.goal

/** Every goal this trak's finishes started, in log order, with the entry that proposed it. */
export const openedGoals = (
  log: readonly EventDto[],
): readonly { readonly step: number; readonly goal: string }[] =>
  log.flatMap((e) => (e._tag === "GoalOpened" ? [{ step: e.step, goal: e.goal }] : []))

/**
 * What the compose entry at `step` opened outside this trak — `openedAt`'s traks and
 * `goalOpenedAt`'s goal — as the two props `ComposerOutputView` takes them in.
 */
export const openedOn = (
  log: readonly EventDto[],
  step: number,
): { readonly opened: readonly string[] | undefined; readonly goalOpened: string | undefined } => ({
  opened: openedAt(log, step)?.ids,
  goalOpened: goalOpenedAt(log, step),
})

/** How many new traks a count of them is, in words — `1 new trak`, `3 new traks`. */
export const newTraks = (n: number): string => `${String(n)} new trak${n === 1 ? "" : "s"}`

/** A count of hand-offs for a card's head: new traks, or `2 for the goal` on a goal's trak. */
export const handOffCount = (n: number, base: HandOffBase): string =>
  typeof base === "object" ? `${String(n)} for the goal` : newTraks(n)
