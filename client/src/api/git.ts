/** The `git` slice's routes: the project checkout's git bar, read and pressed. */

import { Schema } from "effect"
import {
  GitPressedDto as GitPressedSchema,
  HostGitDto as HostGitSchema,
} from "@orkestra/shared/dto/git"
import { get, post } from "./http"
import type { GitActionDto, GitPressedDto, HostGitDto } from "./types"

const decodeHostGit = Schema.decodeUnknownSync(HostGitSchema)
const decodeGitPressed = Schema.decodeUnknownSync(GitPressedSchema)

/**
 * `GET /api/git`. Free of an agent, not of processes: a `git status` against the project
 * checkout — and, when this engine's last fetch began five or more minutes ago, a `git
 * fetch` the engine starts and does not wait for. So a screen polling this is what keeps
 * the counts current, and nothing fetches while no screen is polling.
 */
export const hostGit = async (): Promise<HostGitDto> => decodeHostGit(await get("/api/git"))

/**
 * `POST /api/git/{fetch,pull,reconcile,push}`. **Spends nothing and claims no custody**:
 * `git` against the project checkout, which no trak owns. The answer is the read's shape,
 * after the press, so the bar redraws from it — and `stashed` beside it where a press
 * with `stash` landed and left the changes in the stash.
 *
 * `stash` is read by pull and reconcile alone: it sets a dirty tree aside for the press
 * and puts it back, where the press would otherwise be refused `Dirty`.
 *
 * A `409` for a press the repository's state refuses — `Dirty`, `Conflict`, `Behind` and
 * the rest — which is a `RefusedError`. A press git itself failed is **not** an error
 * here: it is a `200` whose `failure` names the press and quotes git.
 */
export const pressGit = async (press: {
  readonly action: GitActionDto
  readonly stash: boolean
}): Promise<GitPressedDto> =>
  decodeGitPressed(await post(`/api/git/${press.action}`, press.stash ? { stash: true } : {}))
