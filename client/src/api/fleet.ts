/** The `fleet` slice's routes: the agents a trak can start with, and the models. */

import { Schema } from "effect"
import { AgentDto as AgentSchema, ModelsDto as ModelsSchema } from "@orkestra/shared/dto/fleet"
import { get } from "./http"
import type { AgentDto, ModelsDto } from "./types"

/** Composed here because the server names no list type. */
const decodeAgents = Schema.decodeUnknownSync(Schema.Array(AgentSchema))
const decodeModels = Schema.decodeUnknownSync(ModelsSchema)

/**
 * `GET /api/agents`. Free: the engine walks the library it loaded at boot.
 *
 * Only the agents that can be started with — the engine filters, so a screen never holds
 * its own list of which ones are odd. That is the whole point of the field behind it: a
 * list kept here is drift the engine cannot check.
 */
export const listAgents = async (): Promise<readonly AgentDto[]> =>
  decodeAgents(await get("/api/agents"))

/**
 * `GET /api/models`. Free: `models.yaml` as the engine last read it, at boot or a reload.
 *
 * `allowed` verbatim and in file order, and `default` is what a turn runs on when nobody
 * picks — a screen lists the first and marks the second, and knows nothing else about
 * any entry.
 */
export const listModels = async (): Promise<ModelsDto> => decodeModels(await get("/api/models"))
