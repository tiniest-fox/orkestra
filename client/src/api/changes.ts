/** The `changes` slice's route: what a trak's branch, a step or the checkout changed. */

import { Schema } from "effect"
import { ChangesDto as ChangesSchema } from "@orkestra/shared/dto/changes"
import { get, trakPath } from "./http"
import type { ChangesDto } from "./types"

const decodeChanges = Schema.decodeUnknownSync(ChangesSchema)

/**
 * `GET /api/traks/:id/changes`. Free — a replay to resolve `at`, then `git diff`.
 *
 * `at` is `all` for everything the branch has done since it forked, `uncommitted` for what
 * is in the checkout and not yet committed, or a step index for what that one step landed.
 * The engine echoes it back on the answer, so a caller holding several slices can tell
 * which one came home.
 *
 * **`uncommitted` is the one slice that needs the checkout still to exist**; the rest are
 * computed from refs, so a merged or closed trak still answers.
 */
export const trakChanges = async (id: string, at: string): Promise<ChangesDto> =>
  decodeChanges(await get(`${trakPath(id)}/changes?at=${encodeURIComponent(at)}`))

/**
 * `GET /api/traks/:id/changes?at=&path=` — one file of a slice, with its hunks. How a file
 * the slice sent collapsed, `omitted: "generated"`, is opened. A path the slice does not
 * touch answers no files.
 */
export const trakChangedFile = async (id: string, at: string, path: string): Promise<ChangesDto> =>
  decodeChanges(
    await get(
      `${trakPath(id)}/changes?at=${encodeURIComponent(at)}&path=${encodeURIComponent(path)}`,
    ),
  )
