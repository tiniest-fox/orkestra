/**
 * What the thread says about each of the goal's own lines, and what a move's call row
 * says it acted on. A trak is named by the title the goal holds for it.
 */

import type { AttachmentDto, GoalDto, GoalEventDto } from "../../api/types"
import { planChange, type CallMoveDto, type GoalLineDto } from "./thread"

/** A line of the thread: something the engine or the person did, or words the person sent. */
export type LineWords =
  | {
      readonly _tag: "Said"
      readonly text: string
      readonly attachments: readonly AttachmentDto[]
    }
  | { readonly _tag: "Note"; readonly text: string; readonly tone: "good" | "bad" | undefined }

const titleIn = (goal: Pick<GoalDto, "traks">, id: string): string =>
  goal.traks.find((t) => t.id === id)?.title ?? id

const note = (text: string, tone?: "good" | "bad"): LineWords => ({ _tag: "Note", text, tone })

const WOKE = {
  landed: "landed",
  failed: "failed",
  stuck: "stopped stuck",
  checks: "failed a check",
} as const

const SUBGOAL_WOKE = {
  done: "is done",
  dropped: "was dropped",
  stuck: "is stuck",
} as const

const subgoalIn = (goal: Pick<GoalDto, "subgoals">, id: string): string =>
  goal.subgoals.find((s) => s.id === id)?.title ?? id

const traks = (n: number): string => `${String(n)} ${n === 1 ? "trak" : "traks"}`

export const lineWords = (
  event: GoalLineDto,
  goal: Pick<GoalDto, "traks" | "subgoals" | "file" | "parent">,
  log: readonly GoalEventDto[],
): LineWords => {
  switch (event._tag) {
    case "GoalStarted":
      return note(
        goal.parent === undefined
          ? `Goal started from ${goal.file ?? "its file"}`
          : `Opened as a sub-goal of “${goal.parent.title}”`,
      )
    case "GoalAsked":
      return { _tag: "Said", text: event.asked, attachments: event.attachments ?? [] }
    case "GoalTurnFailed":
      return note(`The composer's turn failed — ${event.reason}`, "bad")
    case "GoalTurnStopped":
      return note("You stopped the composer")
    case "TrakWoke":
      return note(
        `“${titleIn(goal, event.trak)}” ${WOKE[event.kind]}`,
        event.kind === "landed" ? "good" : "bad",
      )
    case "SubgoalWoke":
      return note(
        `Sub-goal “${subgoalIn(goal, event.goal)}” ${SUBGOAL_WOKE[event.kind]}${event.kind === "done" || event.said === undefined ? "" : ` — ${event.said}`}`,
        event.kind === "done" ? "good" : event.kind === "stuck" ? "bad" : undefined,
      )
    case "TrakHandedOff":
      return note(
        `“${titleIn(goal, event.trak)}” handed off ${event.handOff.length === 1 ? "a piece" : `${String(event.handOff.length)} pieces`} of work`,
      )
    case "GoalPaused":
      return note(
        event.held.length === 0
          ? "You paused the goal"
          : `You paused the goal · ${traks(event.held.length)} hold at their next gate`,
      )
    case "GoalResumed":
      return note("You resumed the goal")
    case "GoalDropped":
      return note(`The goal was dropped — ${event.reason}`)
    case "TrakDropped":
      return note(`Dropped “${titleIn(goal, event.trak)}” — ${event.reason}`)
    case "GoalActed":
      switch (event.action._tag) {
        case "Chat":
          return {
            _tag: "Said",
            text: event.action.message,
            attachments: event.action.attachments ?? [],
          }
        case "Answer":
          return note(`You answered: ${event.action.answers.join(" · ")}`)
        case "Approve":
          // The first approval of a goal started from a sentence is of its file: no plan
          // had been proposed before it.
          return note(
            log.slice(0, log.indexOf(event)).some((e) => e._tag === "PlanProposed")
              ? "You approved the plan"
              : "You approved the goal file",
          )
        case "Reported":
          return event.action.done
            ? note(
                event.action.note === undefined
                  ? "You reported it done"
                  : `You reported it done — ${event.action.note}`,
                "good",
              )
            : note(`You couldn't do it — ${event.action.note ?? "no reason given"}`, "bad")
        case "Confirm":
          return note("You confirmed the goal is done", "good")
        case "Retry":
          return note("You asked the composer to try again")
        case "NewSession":
          return note("You asked the composer to try again in a new session")
      }
  }
}

/** What a move's call row says it acted on, beside the tool's name. */
export const moveAbout = (
  move: CallMoveDto,
  goal: Pick<GoalDto, "traks">,
  log: readonly GoalEventDto[],
): string => {
  switch (move._tag) {
    case "TrakDropped":
      return titleIn(goal, move.trak)
    case "Replanned": {
      const { added, dropped } = planChange(log, move)
      return added.length === 0 && dropped.length === 0
        ? "no change"
        : `+${String(added.length)} −${String(dropped.length)}`
    }
    case "TrakOpened":
    case "SubgoalOpened":
      return move.title
    case "TrakMessaged":
    case "TrakRecomposed":
      return titleIn(goal, move.trak)
  }
}
