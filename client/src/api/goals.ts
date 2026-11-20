/** The `goals` slice's routes: a direction that outlasts any one trak. */

import { Schema } from "effect"
import { CreatedDto as CreatedSchema } from "@orkestra/shared/dto/actions"
import {
  GoalDetailDto as GoalDetailSchema,
  GoalListDto as GoalListSchema,
} from "@orkestra/shared/dto/goals"
import { withAttachments } from "./attachments"
import { get, post } from "./http"
import type {
  CreatedDto,
  GoalActionDto,
  GoalDetailDto,
  GoalListDto,
  GoalSettingsDto,
  RunModeDto,
} from "./types"

const decodeGoals = Schema.decodeUnknownSync(GoalListSchema)
const decodeGoal = Schema.decodeUnknownSync(GoalDetailSchema)
const decodeCreated = Schema.decodeUnknownSync(CreatedSchema)

const goalPath = (id: string): string => `/api/goals/${encodeURIComponent(id)}`

/** `GET /api/goals`. Free: every goal this project started, newest first. */
export const listGoals = async (): Promise<GoalListDto> => decodeGoals(await get("/api/goals"))

/** `GET /api/goals/:id`. Free: the goal, its log, and its composer's transcript. */
export const goalDetail = async (id: string): Promise<GoalDetailDto> =>
  decodeGoal(await get(goalPath(id)))

/**
 * `POST /api/goals` with a sentence. **Spends money**: the goal's composer starts at once
 * and drafts its file, which is a real `claude`. `modes` are the run modes its traks may
 * open on. Any number of goals may be going at once. `attachments` are upload ids.
 */
export const startGoal = async (
  asked: string,
  modes: readonly [RunModeDto, ...RunModeDto[]],
  attachments: readonly string[],
): Promise<CreatedDto> =>
  decodeCreated(await post("/api/goals", { asked, modes, ...withAttachments(attachments) }))

/**
 * `POST /api/goals/:id/dismiss`. Free: a goal at rest is taken off the traks list, for
 * every device. `409 NotAtRest` while it is going.
 */
export const dismissGoal = async (id: string): Promise<void> => {
  await post(`${goalPath(id)}/dismiss`, {})
}

/**
 * `POST /api/goals/:id/act`. **Spends money** for every action but `Confirm`: the press
 * owes the goal's composer a turn, which is a real `claude` the moment the goal is not
 * paused. A `Chat` while a turn runs or is owed starts none: that turn reads it. `409
 * NotParked` where the goal does not offer the action, `409 Driving` for a `Retry` or
 * `NewSession` while a turn runs, `409 AtRest` once the goal is done or dropped, and `409
 * GoalBranchRefused` where approving a draft that names a goal branch could not make it.
 * `attachments` are upload ids, and only a `Chat` carries any.
 */
export const actOnGoal = async (
  id: string,
  action: GoalActionDto,
  attachments: readonly string[] = [],
): Promise<void> => {
  await post(`${goalPath(id)}/act`, { ...action, ...withAttachments(attachments) })
}

/**
 * `POST /api/goals/:id/pause` or `/resume`. Pausing spends nothing: the goal's live traks
 * are held at their next gate and its composer takes no turn. **Resuming spends** where
 * the goal owes a turn, which starts at once. `409 AtRest` once the goal is at rest.
 */
export const pauseGoal = async (id: string, paused: boolean): Promise<void> => {
  await post(`${goalPath(id)}/${paused ? "pause" : "resume"}`, {})
}

/**
 * `POST /api/goals/:id/stop`. Free: the composer turn in flight is killed, and the goal
 * stands where the turn would have left it, owing no turn. `409 NothingToStop` where none
 * is running, `409 AtRest` once the goal is at rest. Answers once the kill is over.
 */
export const stopGoal = async (id: string): Promise<void> => {
  await post(`${goalPath(id)}/stop`, {})
}

/**
 * `POST /api/goals/:id/drop`. Free: a composer turn in flight is killed, the holds a pause
 * put on come off, and the goal comes to rest as Dropped. Its traks keep running as the
 * person's own. `409 AtRest` once the goal is at rest.
 */
export const dropGoal = async (id: string, reason: string): Promise<void> => {
  await post(`${goalPath(id)}/drop`, { reason })
}

/**
 * `POST /api/goals/:id/settings`. **Spends nothing**: the goal's limits, modes and
 * auto-merge are replaced whole on its log, and no turn starts. `409 AtRest` once the goal
 * is at rest, `409 NotParked` while its file is still a draft.
 */
export const setGoalSettings = async (id: string, settings: GoalSettingsDto): Promise<void> => {
  await post(`${goalPath(id)}/settings`, settings)
}
