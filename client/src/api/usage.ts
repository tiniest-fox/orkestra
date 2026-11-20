/** The `usage` slice's route: each CLI's plan usage. */

import { Schema } from "effect"
import { CliUsagesDto as CliUsagesSchema } from "@orkestra/shared/dto/usage"
import { get } from "./http"
import type { CliUsagesDto } from "./types"

const decodeUsage = Schema.decodeUnknownSync(CliUsagesSchema)

/**
 * `GET /api/usage`: each CLI's plan usage as the engine last read it. Free — the engine
 * answers from memory, which only its Claude turns report into.
 */
export const usage = async (): Promise<CliUsagesDto> => decodeUsage(await get("/api/usage"))
