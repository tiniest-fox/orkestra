// Views — what an MCP tool's call left to draw, and the presses on it. No custody
// and no event: a press calls a tool through a CLI and moves no trak.

import { Effect } from "effect"
import * as Headers from "@effect/platform/Headers"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import {
  NoCheckoutDto,
  CliNotStartedDto,
  ToolCallFailedDto,
  ToolNotOpenDto,
} from "@orkestra/shared/dto/common"
import { ViewCallRequestDto } from "@orkestra/shared/dto/trak"
import { Provider } from "../../agent/ports/provider.js"
import { Store } from "../../workflow/ports/store.js"
import { toViewDto, toViewResultDto } from "../dto.js"
import { type PressRefused, Views } from "../views.js"
import { pathId, refuse, checkoutOf } from "./common.js"

/** The `:call` segment, or nothing. */
const pathCall = Effect.map(Router.params, (params) => params["call"])

/**
 * One kept view, whole: its HTML with the network policy written in, and the call's
 * arguments and result. **Free, and it starts nothing** — everything here was stored
 * when the call completed, so a view redraws on a reload with no CLI running.
 *
 * JSON rather than a page, deliberately: see `ViewDto.html`.
 *
 * 404 unknown trak, or a call that left no view.
 */
const viewRoute = Router.get(
  "/api/traks/:id/views/:call",
  Effect.gen(function* () {
    const id = yield* pathId
    const call = yield* pathCall
    if (call === undefined || call === "") return ServerResponse.empty({ status: 400 })
    const view = yield* (yield* Store).view(id, call)
    if (view === undefined) return ServerResponse.empty({ status: 404 })
    const cli = (yield* Provider).cliFor(view.model)
    const answers = (yield* checkoutOf(id)) !== undefined
    return yield* ServerResponse.json(toViewDto(view, cli, answers), {
      headers: Headers.fromInput({ "cache-control": "no-store" }),
    })
  }),
)

const pressRefusal = (refused: PressRefused) => {
  switch (refused.why) {
    case "Unknown":
      return Effect.succeed(ServerResponse.empty({ status: 404 }))
    case "NotOpen":
      return refuse(403, ToolNotOpenDto.make({}))
    case "NoCheckout":
      return refuse(409, NoCheckoutDto.make({}))
    case "NotStarted":
      return refuse(
        503,
        CliNotStartedDto.make({ cli: refused.cli ?? "the CLI", reason: refused.reason }),
      )
    case "Failed":
      return refuse(502, ToolCallFailedDto.make({ reason: refused.reason }))
  }
}

/**
 * A view's press: call one tool on the view's own server, through a CLI, and answer
 * with what the tool returned. **No model turn, so it spends nothing** — and it is
 * allowed on every step, a read-only one included, with nothing asked first.
 *
 * **Which tool is the engine's to allow**, not the surface's: only one the view's
 * server opened to views when the call completed. The body names no server, so a press
 * has no way to ask for another's.
 *
 * During a turn the call goes down the turn's own pipe. With none running, the first
 * press starts the same CLI in the trak's checkout with no prompt and waits for it —
 * so that press is slow, and every one after it is not. No custody is claimed either
 * way, so a drive under way refuses nothing here.
 *
 * 404 unknown view · 403 `ToolNotOpen` · 409 `NoCheckout` · 503 `CliNotStarted` ·
 * 502 `ToolCallFailed`.
 */
const viewCallRoute = Router.post(
  "/api/traks/:id/views/:call/call",
  Effect.gen(function* () {
    const id = yield* pathId
    const call = yield* pathCall
    if (call === undefined || call === "") return ServerResponse.empty({ status: 400 })
    const request = yield* ServerRequest.schemaBodyJson(ViewCallRequestDto)
    return yield* (yield* Views).press(id, call, request.tool, request.arguments).pipe(
      Effect.flatMap((result) => ServerResponse.json(toViewResultDto(result))),
      Effect.catchTag("PressRefused", pressRefusal),
    )
  }),
)

export const viewRoutes = Router.empty.pipe(viewRoute, viewCallRoute)
