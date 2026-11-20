/**
 * What a goal gate asks, read off the move that opened it — what the Chat tab's card is
 * fed — and how a press on that card is sent.
 */

import type {
  GoalDto,
  GoalActionDto,
  GoalActionRequestDto,
  GoalDraftDto,
  GoalEventDto,
  PlannedSubgoalDto,
  PlannedTrakDto,
  QuestionDto,
} from "../../../api/types"
import type { Answered } from "../../trak-detail/filed"
import type { Answering, Sent } from "../../trak-detail/useAnswer"
import type { GateMoveDto } from "../thread"
import type { GoalAct } from "../useGoalAct"

export type GateAsk =
  | { readonly _tag: "file"; readonly draft: GoalDraftDto }
  | {
      readonly _tag: "plan"
      readonly traks: readonly PlannedTrakDto[]
      readonly subgoals: readonly PlannedSubgoalDto[]
    }
  | { readonly _tag: "escalation"; readonly questions: readonly QuestionDto[] }
  | { readonly _tag: "action"; readonly request: GoalActionRequestDto }
  | { readonly _tag: "done"; readonly summary: string }

/**
 * Where a sub-goal's Confirm done merges, when its parent has a goal branch: its own branch
 * into the parent's. `undefined` is a goal whose Confirm merges nothing here.
 */
export interface DoneMerge {
  readonly from: string
  readonly into: string
}

export const doneMergeOf = (goal: Pick<GoalDto, "branch" | "parent">): DoneMerge | undefined =>
  goal.branch === undefined || goal.parent?.branch === undefined
    ? undefined
    : { from: goal.branch, into: goal.parent.branch }

/** Every ask but the question and the work asked by hand, which have cards of their own. */
export type CardAsk = Exclude<GateAsk, { readonly _tag: "escalation" | "action" }>

export const askOfMove = (move: GateMoveDto): GateAsk => {
  switch (move._tag) {
    case "GoalDrafted":
      return { _tag: "file", draft: move.draft }
    case "PlanProposed":
      return { _tag: "plan", traks: move.traks, subgoals: move.subgoals ?? [] }
    case "Escalated":
      return { _tag: "escalation", questions: move.questions }
    case "ActionRequested":
      return {
        _tag: "action",
        request: {
          title: move.title,
          steps: move.steps,
          why: move.why,
          ...(move.trak === undefined ? {} : { trak: move.trak }),
        },
      }
    case "DoneProposed":
      return { _tag: "done", summary: move.summary }
  }
}

/**
 * What a person answered this escalation: the first `Answer` after it in the log, before
 * the next escalation. `undefined` is one nobody answered — the composer moved past it.
 */
export const answerTo = (
  log: readonly GoalEventDto[],
  move: Extract<GateMoveDto, { readonly _tag: "Escalated" }>,
): Answered | undefined => {
  for (const e of log.slice(log.indexOf(move) + 1)) {
    if (e._tag === "Escalated") return undefined
    if (e._tag === "GoalActed" && e.action._tag === "Answer")
      return {
        answers: e.action.answers,
        ...(e.action.note === undefined ? {} : { note: e.action.note }),
      }
  }
  return undefined
}

/** `QuestionsCard`'s form, sent as the goal's `Answer`: every answer, and the note apart. */
export const answerAction = (sent: Sent): GoalActionDto => ({
  _tag: "Answer",
  answers: sent.answers,
  ...(sent.note === undefined ? {} : { note: sent.note }),
})

/** The goal's one press hook, as the `Answering` the question form takes. */
export const answeringOf = (act: GoalAct): Answering => ({
  send: (sent) => {
    act.act(answerAction(sent))
  },
  isPending: act.isPending,
  disabled: act.disabled,
  said: act.said,
})

/**
 * The person's report on work asked of them, as the goal's `Reported`. A note is trimmed and
 * sent only where something is left; one that could not be done is refused without one,
 * since the composer cannot act on "couldn't" alone — `undefined` is that refusal.
 */
export const reportAction = (done: boolean, note: string): GoalActionDto | undefined => {
  const said = note.trim()
  if (!done && said === "") return undefined
  return { _tag: "Reported", done, ...(said === "" ? {} : { note: said }) }
}
