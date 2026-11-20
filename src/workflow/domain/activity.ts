// When something last happened to a trak, and whether it has been left long enough to be
// idle.
//
// **Idle is computed, never recorded.** It depends on the clock, and nothing is appended
// when three days pass — so every reader compares the newest activity with now on each
// read, and an append that counts as activity ends it with no wake press. The list sinks
// an idle row and the engine stops reading its log (`Idle`, `src/workflow/ports/idle.ts`).
//
// Two times, for two readers. *Touched* is a person's newest press, and orders the list.
// *Active* adds a finished turn to that, and decides idleness: a trak a goal or an agent
// worked on yesterday is not one anybody has left.

import type { Event } from "./event.js"
import { archived, type Trak, waitingAt } from "./trak.js"

/** How long a trak goes with no activity before it is idle: three days, and not a setting. */
export const IDLE_AFTER_MS = 3 * 24 * 60 * 60 * 1000

/**
 * The events a person causes, and the whole of what *human activity* means here.
 *
 * Everything else in the log is an agent or the engine, and counting those
 * inverts the list's ordering: a trak nobody has looked at all afternoon writes
 * an event every turn and would sit above one somebody answered a minute ago.
 *
 * `TrakCreated` counts on a spawned child too, though the engine minted it and
 * nobody typed its description — a child with no touch time sorts to the bottom
 * of `Needs you`, which is the wrong end for the row that is the reason the page
 * was opened.
 *
 * **`Restarted` deliberately does not count, and `Stopped` does.** The daemon writes a
 * restart on boot recovery as well as when a person presses Resume, and the event
 * carries nothing that tells the two apart — so counting it would float every
 * interrupted trak to the top of the list after a crash. The cost is accepted and it is
 * small: you resume a failure and it stays where it was in `Errors`. Nothing but a
 * person's press ever writes a stop, and the gate it opens is one they are standing at.
 * A change of mode, a hold, a skip, a check ended, a wait skipped and a press asking
 * the step to file count for the same reason: only a person writes one — as only a
 * person writes a message that waits.
 */
const touchedBy = (e: Event): boolean =>
  e._tag === "TrakCreated" ||
  e._tag === "HumanActed" ||
  e._tag === "Closed" ||
  e._tag === "Merged" ||
  e._tag === "Abandoned" ||
  // The engine's own re-entry of an auto-merging trak carries a cause; nobody touched it.
  (e._tag === "Reentered" && e.cause === undefined) ||
  e._tag === "WaitSkipped" ||
  e._tag === "StopRequested" ||
  e._tag === "Stopped" ||
  e._tag === "FilingAsked" ||
  e._tag === "ChecksCancelled" ||
  e._tag === "ModeChanged" ||
  e._tag === "HoldChanged" ||
  e._tag === "SkipChecksChanged" ||
  e._tag === "AutoMergeChanged" ||
  e._tag === "MergeMethodPicked" ||
  e._tag === "OwnerChanged" ||
  e._tag === "MessageWaiting"

/** A person's press, or a turn that finished — answered, or failed. */
const activeBy = (e: Event): boolean =>
  touchedBy(e) ||
  e._tag === "AgentReturned" ||
  e._tag === "ComposerReturned" ||
  e._tag === "TurnFailed"

/**
 * The newest `at` among the events `counts` accepts, or `undefined` where nothing says.
 *
 * The newest rather than the last such event, because a log part-written before the
 * store stamped anything holds untimed events among timed ones — taking the last one's
 * `at` would report absent for a trak somebody touched this morning.
 */
const newestAt = (history: readonly Event[], counts: (e: Event) => boolean): number | undefined => {
  let newest: number | undefined
  for (const e of history) {
    if (!counts(e) || e.at === undefined) continue
    if (newest === undefined || e.at > newest) newest = e.at
  }
  return newest
}

/** When a person last touched the trak — what the list orders on. */
export const touchedAt = (history: readonly Event[]): number | undefined =>
  newestAt(history, touchedBy)

/** When a person last pressed or a turn last finished — what idleness counts from. */
export const activeAt = (history: readonly Event[]): number | undefined =>
  newestAt(history, activeBy)

/**
 * Whether the log alone lets the trak go idle: it is not put away, and not resting on a
 * condition the sweep still asks. A wait that has given up is asked no more, so it does
 * not hold the trak. Whether anything drives it is daemon memory, and the reader's.
 */
export const mayIdle = (trak: Trak): boolean => {
  if (archived(trak.state)) return false
  const wait = waitingAt(trak)
  return wait === undefined || wait.stopped
}

/**
 * Whether a trak `mayIdle` lets go idle has been left long enough, at `now`. A log with
 * no timed activity at all — written before events carried `at` — is idle: nothing in it
 * says anybody has been near it since.
 */
export const leftSince = (active: number | undefined, now: number): boolean =>
  active === undefined || now - active >= IDLE_AFTER_MS
