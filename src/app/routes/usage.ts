// Each CLI's plan usage, as held. Answers with `@orkestra/shared/dto/usage`.

import { Effect } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import type { CliUsagesDto } from "@orkestra/shared/dto/usage"
import { Provider } from "../../agent/ports/provider.js"
import { USAGE_CLIS } from "../../agent/types/plan-usage.js"
import { fleet } from "../../library/logic/resolve.js"
import { Lib } from "../../library/ports/library.js"
import { toCliUsageDto } from "../dto.js"
import { UsageMemory } from "../plan-usage.js"

/**
 * The plan usage of every CLI some agent in the project runs on, as this engine's turns
 * last reported it. A CLI no agent names is left out, so a screen draws nothing for it.
 * Memory alone, so a screen that opens late gets what is held, and the `Usage` frame
 * brings every change after.
 */
const usageRoute = Router.get(
  "/api/usage",
  Effect.gen(function* () {
    const usage = yield* UsageMemory
    const provider = yield* Provider
    const named = new Set(fleet(yield* Lib).map((agent) => provider.cliFor(agent.model)))
    const clis = yield* Effect.forEach(
      USAGE_CLIS.filter((cli) => named.has(cli)),
      usage.current,
    )
    return yield* ServerResponse.json({ clis: clis.map(toCliUsageDto) } satisfies CliUsagesDto)
  }),
)

export const usageRoutes = Router.empty.pipe(usageRoute)
