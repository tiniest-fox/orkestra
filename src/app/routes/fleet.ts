// Policy rather than a log: the agents, the models and the MCP connection names
// `.orkestra/` declares, and reloading them. Answers with `@orkestra/shared/dto/fleet`,
// and a failed reload with `@orkestra/shared/dto/reload`.

import { Effect, Either, Option } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import { ModelsDto } from "@orkestra/shared/dto/fleet"
import { ReloadFailedDto } from "@orkestra/shared/dto/reload"
import { fleet } from "../../library/logic/resolve.js"
import { Lib } from "../../library/ports/library.js"
import { ProjectFiles } from "../../workflow/ports/project-files.js"
import { toAgentDtos } from "../dto.js"

/**
 * The whole library — every agent's name, description, icon, model, whether `start:` marks
 * it and whether a plan may name it. A surface resolving a plan entry's agent needs the ones a person cannot open a
 * trak with too, so filtering is the caller's.
 *
 * **Free, and it reads no trak at all.** The only route here whose subject is policy
 * rather than a log: `.orkestra/agents/` is loaded once into `Lib`, so this is a map
 * walk. It is also the whole reason `src/app/` depends on the library, which nothing
 * here needed until a person had to be shown the fleet.
 */
const agentsRoute = Router.get(
  "/api/agents",
  Effect.gen(function* () {
    const lib = yield* Lib
    return yield* ServerResponse.json(toAgentDtos(fleet(lib), new Set(lib.agents.keys())))
  }),
)

/**
 * `models.yaml` as loaded — the list every `model:` is checked against, and the default.
 * Policy for `agentsRoute`'s reason, and free for the same one: read once into `Lib`.
 * `default` is `ModelRegistry.composer`, which is also what the engine's own agent runs
 * on, so it is what a chat runs on when nobody picks — one key on disk, not two.
 */
const modelsRoute = Router.get(
  "/api/models",
  Effect.gen(function* () {
    const { models } = yield* Lib
    return yield* ServerResponse.json(
      ModelsDto.make({ default: models.composer, allowed: models.allowed }),
    )
  }),
)

/**
 * Read `.orkestra/` and the templates again, and swap both in — or neither, answering
 * 422 with the loader's line. Nothing running is interrupted: a turn in flight finishes
 * on the pair it began with, and the next step, check run and process start read the
 * new one. 404 where this engine holds a fixed pair and nothing to reload. Under an
 * external store the read is of the default branch's commit as last fetched.
 */
const reloadRoute = Router.post(
  "/api/reload",
  Effect.gen(function* () {
    const files = yield* Effect.serviceOption(ProjectFiles)
    if (Option.isNone(files)) return ServerResponse.empty({ status: 404 })
    const reloaded = yield* Effect.either(files.value.reload)
    if (Either.isLeft(reloaded)) {
      return yield* ServerResponse.json(ReloadFailedDto.make({ reason: reloaded.left.reason }), {
        status: 422,
      })
    }
    return ServerResponse.empty({ status: 204 })
  }),
)

export const fleetRoutes = Router.empty.pipe(agentsRoute, modelsRoute, reloadRoute)
