/**
 * What a goal is doing, in words and an ink — the coloured word on the traks list's banner
 * and the chip on the goal's own head, so the two cannot disagree.
 *
 * **Paused wins over every state but a gate.** A paused goal at a gate is still owed an
 * answer, and the answer is what the person came for; anywhere else the pause is the
 * whole of what is true about it.
 *
 * **A composer turn wins over open traks**, owed or executing alike: a trak's landing
 * wakes the composer while its siblings are still open, and the turn is what is moving.
 * Waiting on traks names them and counts the open ones, a trak parked at a gate included.
 *
 * **Watching with nothing open is idle, and idle is owed.** No trak is running and no turn
 * is coming, so nothing moves the goal until the person does — most often because the
 * composer's last message asked for something without opening a gate. It reads in the
 * waiting ink and carries an ask, so it is not mistaken for traks at work.
 */

import type { GoalDto, GoalStateDto } from "../api/types"
import { toneInk, toneSolid, type Tone } from "./tone"

/**
 * One of the five tones, or `composer` — a composer turn, drawn in `source-machine` cyan
 * so it reads apart from the traks' working blue. **Not a sixth tone**: who is acting is
 * the source axis, and `styles.css` says why the two families stay apart.
 */
export type GoalInk = Tone | "composer"

/** The ink as a foreground, and as a solid fill for the banner's rail. Whole class names. */
export const goalInk: Record<GoalInk, string> = { ...toneInk, composer: "text-source-machine" }
export const goalSolid: Record<GoalInk, string> = { ...toneSolid, composer: "bg-source-machine" }

export interface GoalWords {
  readonly label: string
  readonly ink: GoalInk
}

/** The goal's traks still open, a trak parked at a gate among them. */
export const openTraks = (goal: Pick<GoalDto, "traks">): number =>
  goal.traks.filter((t) => t.status === "live").length

/** Watching, not paused and with no trak open: nothing moves the goal but the person. */
const idle = (goal: Pick<GoalDto, "state" | "paused" | "traks">): boolean =>
  goal.state._tag === "Watching" && !goal.paused && openTraks(goal) === 0

/** "2 traks running". */
const traksRunning = (open: number): string =>
  `${String(open)} trak${open === 1 ? "" : "s"} running`

type Gate = Extract<GoalStateDto, { _tag: "AtGate" }>["gate"]

const GATE_LABEL: Record<Gate, string> = {
  file: "File to approve",
  plan: "Plan to approve",
  escalation: "Needs you",
  action: "Needs you to act",
  done: "Proposed done",
}

const GATE_ASK: Record<Gate, string> = {
  file: "Approve the goal file",
  plan: "Approve the plan",
  escalation: "The composer is asking you",
  action: "The composer needs you to do something",
  done: "Is the goal done?",
}

const IDLE_ASK = "Nothing is running. Tell the composer what next"

const PAUSED: GoalWords = { label: "Paused", ink: "neutral" }

export const goalWords = (
  goal: Pick<GoalDto, "state" | "paused" | "file" | "parent" | "traks">,
): GoalWords => {
  const { state } = goal
  switch (state._tag) {
    case "AtGate":
      return { label: GATE_LABEL[state.gate], ink: "waiting" }
    case "Composing":
      if (goal.paused) return PAUSED
      // A goal with no approved file is writing one; a sub-goal has no file to write.
      return {
        label: goal.file === undefined && goal.parent === undefined ? "Drafting" : "Composing",
        ink: "composer",
      }
    case "Watching":
      if (goal.paused) return PAUSED
      return idle(goal)
        ? { label: "Idle", ink: "waiting" }
        : { label: traksRunning(openTraks(goal)), ink: "working" }
    case "Failed":
      return { label: "Turn failed", ink: "bad" }
    case "Done":
      return { label: "Done", ink: "good" }
    case "Dropped":
      return { label: "Dropped", ink: "neutral" }
  }
}

/**
 * What the person owes the goal right now, or `undefined` where nothing is. A gate, a
 * turn the provider lost, or an idle goal — the states only a person moves on from.
 */
export const goalAsk = (goal: Pick<GoalDto, "state" | "paused" | "traks">): string | undefined => {
  const { state } = goal
  switch (state._tag) {
    case "AtGate":
      return GATE_ASK[state.gate]
    case "Failed":
      return "The composer's turn failed"
    case "Watching":
      return idle(goal) ? IDLE_ASK : undefined
    case "Composing":
    case "Done":
    case "Dropped":
      return undefined
  }
}

/** Done or dropped: nothing moves the goal again. */
export const goalAtRest = (goal: Pick<GoalDto, "state">): boolean =>
  goal.state._tag === "Done" || goal.state._tag === "Dropped"

/** What a goal is called: its file's title, the draft's while one waits, and before either. */
export const goalTitle = (goal: Pick<GoalDto, "title">): string => goal.title ?? "New goal"

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** When something happened, as a goal at rest says it: `Tue 14:02` within the week, `3 Oct` before. */
export const pastWhen = (at: number, now: number): string => {
  const d = new Date(at)
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  return now - at < 6 * 86_400_000
    ? `${WEEKDAY[d.getDay()] ?? ""} ${hhmm}`
    : `${String(d.getDate())} ${MONTH[d.getMonth()] ?? ""}`
}

/**
 * How a goal at rest ended, in one line: what the banner says under its marks and what
 * the rest card leads with. `undefined` for a goal still going.
 */
export const goalEnding = (goal: Pick<GoalDto, "state" | "done" | "traks">): string | undefined => {
  const { state } = goal
  switch (state._tag) {
    case "Done":
      return goal.done ?? "You confirmed the goal is done."
    case "Dropped": {
      const open = openTraks(goal)
      return open === 0
        ? `Dropped: ${state.reason}`
        : `Dropped: ${state.reason}. ${String(open)} of its traks still run, as your own.`
    }
    case "Composing":
    case "AtGate":
    case "Watching":
    case "Failed":
      return undefined
  }
}
