// What the log says of a trak's work as its checkout is taken away — the answer an
// archive or a drop under a runner falls back on when the last fetch out of the sandbox
// fails. Pure: the runtime reads the log and asks the forge, and the git adapter holds
// this answer against this machine's copy of the branch.

import { KeptWork } from "../../vcs/index.js"
import type { Event } from "./event.js"
import type { History } from "./replay.js"
import type { Trak } from "./trak.js"

/**
 * Whether an event records something run in the trak's checkout — something that may
 * have written there after the last commit. A record over every tag, so an event added
 * later has to be placed here before anything compiles; `true` is the side that keeps a
 * sandbox, so it is the answer where in doubt.
 */
const RAN_IN_CHECKOUT: Readonly<Record<Event["_tag"], boolean>> = {
  TrakCreated: false,
  ComposerReturned: true,
  AgentReturned: true,
  HumanActed: false,
  ChecksPassed: true,
  CheckFailed: true,
  ChecksCancelled: true,
  EffectsRan: true,
  EffectFailed: true,
  ConditionsMet: false,
  ConditionsUnmet: false,
  WaitSkipped: false,
  WorktreeReady: false,
  WorktreeFailed: false,
  // Setup writes what the repository ignores, as it did when it ran before `WorktreeReady`.
  SetupStarted: false,
  SetupPassed: false,
  // Ends a turn only where it names one — see `ranAfter`.
  SetupFailed: false,
  MergeFailed: false,
  Conflicted: false,
  StepRefused: false,
  WorkCommitted: false,
  WorktreeRemoved: false,
  TurnFailed: true,
  // Each ends a turn only where it names one — see `ranAfter`.
  Restarted: false,
  StopRequested: false,
  Stopped: false,
  FilingAsked: false,
  ModeChanged: false,
  HoldChanged: false,
  SkipChecksChanged: false,
  AutoMergeChanged: false,
  MergeMethodPicked: false,
  OwnerChanged: false,
  MessageWaiting: false,
  MessageDelivered: true,
  ChildrenSpawned: false,
  HandedOff: false,
  GoalOpened: false,
  // A child merged into this checkout, and the fetch after it may have failed.
  ChildLanded: true,
  ChildRefiled: false,
  ChildrenJoined: true,
  Abandoned: false,
  Closed: false,
  Merged: false,
  WorkMerged: false,
  ChangesDropped: false,
  Reentered: false,
  AutoMergeStopped: false,
}

/**
 * Whether `event` ran something in the checkout. A restart, a stop or a failed setup that
 * names a step or a session ends a turn that wrote no ending of its own, and that turn may
 * have written.
 */
const ranAfter = (event: Event): boolean =>
  event._tag === "Restarted" ||
  event._tag === "StopRequested" ||
  event._tag === "Stopped" ||
  event._tag === "SetupFailed"
    ? event.step !== undefined || event.sessionId !== undefined
    : RAN_IN_CHECKOUT[event._tag]

/**
 * `Merged` where the branch went in — landed while a wait was pending, merged here, or,
 * as `merged` says, on the forge — and `atLastCommit` otherwise.
 */
export const keptWork = (trak: Trak, history: History, merged: boolean): KeptWork => {
  const closedMerged = trak.state._tag === "Closing" && trak.state.merged !== undefined
  return merged || closedMerged || trak.landed !== undefined
    ? KeptWork.Merged()
    : atLastCommit(trak, history)
}

/**
 * `At` the head the last `WorkCommitted` recorded — the base, where it recorded none —
 * unless something ran in the checkout after it, which is `Unsure` and names the first
 * such event.
 */
export const atLastCommit = (trak: Trak, history: History): KeptWork => {
  const worktree = trak.worktree
  if (worktree === undefined) return KeptWork.Unsure({ why: "the trak has no checkout" })
  const last = history.findLastIndex((event) => event._tag === "WorkCommitted")
  const committed = history[last]
  const since = history.slice(last + 1).find(ranAfter)
  if (since !== undefined) {
    const after = last < 0 ? "with nothing committed" : "after the last commit"
    return KeptWork.Unsure({ why: `${nameOf(since)} ran ${after}` })
  }
  const head = committed?._tag === "WorkCommitted" ? committed.sha : undefined
  return KeptWork.At({ head: head ?? worktree.base })
}

/** An event that ran something, as a person reads it in a refusal. */
const nameOf = (event: Event): string => {
  const step = "step" in event && typeof event.step === "number" ? ` at step ${event.step}` : ""
  return `${event._tag}${step}`
}
