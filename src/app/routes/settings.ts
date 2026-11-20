// How a trak is run from its next gate on — mode, hold, skip-checks, auto-merge and the
// merge method. Each appends through `appendSetting`, spends nothing and interrupts nothing.

import { Effect } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import {
  HoldRequestDto,
  ModeRequestDto,
  SkipChecksRequestDto,
  AutoMergeRequestDto,
  MergeMethodRequestDto,
} from "@orkestra/shared/dto/actions"
import {
  AtRestDto,
  OnManualDto,
  ArchivedDto,
  ChildTrakDto,
  GoalForbidsAutoMergeDto,
} from "@orkestra/shared/dto/common"
import { archived, atRest, type TrakId } from "../../workflow/domain/trak.js"
import { Events } from "../../workflow/domain/event.js"
import { replayHistory } from "../../workflow/domain/replay.js"
import { GoalStore } from "../../workflow/ports/goal-store.js"
import { Store } from "../../workflow/ports/store.js"
import { replayGoal } from "../../workflow/domain/goal.js"
import { appendSetting } from "../drive.js"
import { pathId, refuse } from "./common.js"

/**
 * The trak a change of setting applies to, or the refusal.
 *
 * **Not the drive's business, and that is the whole shape of these two routes.** Every
 * other action either waits for the drive or kills it; a person changing how the trak
 * is run wants neither — the turn in flight finishes, and the next gate is the first
 * one the new setting decides. So there is no `409 Driving` here and no parked check:
 * `decide` re-parks a gate and settles everything else. The one refusal is a trak at
 * rest, which has no next gate for a setting to reach.
 */
const settable = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return { refusal: ServerResponse.empty({ status: 404 }) }
    const trak = replayHistory(id, events)
    if (atRest(trak.state)) return { refusal: yield* refuse(409, AtRestDto.make({})) }
    return { trak }
  })

/**
 * Change a running trak's run mode. **Spends nothing** and interrupts nothing.
 *
 * 404 unknown id · 409 at rest.
 */
const modeRoute = Router.post(
  "/api/traks/:id/mode",
  Effect.gen(function* () {
    const id = yield* pathId
    const request = yield* ServerRequest.schemaBodyJson(ModeRequestDto)
    const found = yield* settable(id)
    if ("refusal" in found) return found.refusal
    return yield* appendSetting(id, Events.modeChanged(request.mode))
  }),
)

/**
 * Hold the current step until it is accepted, whatever the mode would do at its gates,
 * or take that back. Not refused at a spawn: the engine passes the hold over one, and the
 * picker withholds the switch there, so a press from elsewhere is harmless.
 *
 * **Refused on `manual` rather than recorded**, because it would promise nothing the
 * mode does not and `holding` would then be `true` on a screen with nowhere to draw
 * it. Taking a hold back on `manual` is refused too — the engine cleared it when the
 * mode was set, so there is nothing to take back.
 *
 * 404 unknown id · 409 at rest · 409 on manual.
 */
const holdRoute = Router.post(
  "/api/traks/:id/hold",
  Effect.gen(function* () {
    const id = yield* pathId
    const request = yield* ServerRequest.schemaBodyJson(HoldRequestDto)
    const found = yield* settable(id)
    if ("refusal" in found) return found.refusal
    if (found.trak.mode === "manual") return yield* refuse(409, OnManualDto.make({}))
    return yield* appendSetting(id, Events.holdChanged(request.holding))
  }),
)

/**
 * Keep the next check run from happening, or take that back. `holdRoute`'s door and
 * `holdRoute`'s refusals but one: not refused on `manual`, because every mode runs its
 * checks and the switch means the same thing on each. Which run is next is read by the
 * runtime as it is issued — `RunChecks` — so the route reads nothing but the trak's
 * existence.
 *
 * 404 unknown id · 409 at rest.
 */
const skipChecksRoute = Router.post(
  "/api/traks/:id/skip-checks",
  Effect.gen(function* () {
    const id = yield* pathId
    const request = yield* ServerRequest.schemaBodyJson(SkipChecksRequestDto)
    const found = yield* settable(id)
    if ("refusal" in found) return found.refusal
    return yield* appendSetting(id, Events.skipChecksChanged(request.skipping))
  }),
)

/**
 * Turn auto-merge on or off. `appendSetting`'s door, so it spends nothing and starts no
 * drive — but not `settable`'s refusals: it is taken at `Finished`, where deciding to merge
 * on green after reading the result is the point, and the forge sweep reads it next tick.
 * On is a fresh start, which is how a stopped auto-merge is picked up again.
 *
 * Refused once the trak is archived or being archived, where there is no pull request left
 * to merge; on a child, which lands in its parent's checkout and has none; and turning it
 * on where the trak's goal file forbids it, the refusal `open_trak` gives. Turning it off is
 * never refused by the goal.
 *
 * 404 unknown id · 409 archived · 409 a child · 409 the goal forbids it.
 */
const autoMergeRoute = Router.post(
  "/api/traks/:id/auto-merge",
  Effect.gen(function* () {
    const id = yield* pathId
    const request = yield* ServerRequest.schemaBodyJson(AutoMergeRequestDto)
    const events = yield* (yield* Store).events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })
    const trak = replayHistory(id, events)
    if (archived(trak.state)) return yield* refuse(409, ArchivedDto.make({}))
    if (trak.parent !== undefined) return yield* refuse(409, ChildTrakDto.make({}))
    if (request.on && trak.goal !== undefined) {
      const goal = replayGoal(trak.goal, yield* (yield* GoalStore).events(trak.goal))
      if (goal?.spec?.limits.autoMerge === "never") {
        return yield* refuse(409, GoalForbidsAutoMergeDto.make({}))
      }
    }
    return yield* appendSetting(id, Events.autoMergeChanged(request.on))
  }),
)

/**
 * Pick the method this trak's pull request merges by — the press on the finished band and
 * auto-merge both read it. `appendSetting`'s door, so it spends nothing, starts no drive and
 * merges nothing; taken at `Finished`, where the band offers it, for `autoMergeRoute`'s
 * reason. Whether the forge still allows the method is asked at the merge rather than here,
 * since the repository's settings can change after a pick.
 *
 * 404 unknown id · 409 archived · 409 a child, which has no pull request.
 */
const mergeMethodRoute = Router.post(
  "/api/traks/:id/merge-method",
  Effect.gen(function* () {
    const id = yield* pathId
    const request = yield* ServerRequest.schemaBodyJson(MergeMethodRequestDto)
    const events = yield* (yield* Store).events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })
    const trak = replayHistory(id, events)
    if (archived(trak.state)) return yield* refuse(409, ArchivedDto.make({}))
    if (trak.parent !== undefined) return yield* refuse(409, ChildTrakDto.make({}))
    return yield* appendSetting(id, Events.mergeMethodPicked(request.method))
  }),
)

export const settingRoutes = Router.empty.pipe(
  modeRoute,
  holdRoute,
  skipChecksRoute,
  autoMergeRoute,
  mergeMethodRoute,
)
