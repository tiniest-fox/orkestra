// The project checkout's git bar: its status, and the presses on it. Answers with
// `@orkestra/shared/dto/git`.

import { Effect, Schema } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import { GitPressRequestDto } from "@orkestra/shared/dto/git"
import type { StashedPress } from "../../vcs/index.js"
import { Prompts } from "../../prompts/ports/prompts.js"
import { toGitPressedDto, toHostGitDto, toSyncRefusalDto } from "../dto.js"
import { HostGit, type Pressed } from "../host-git.js"
import { refuse } from "./common.js"

/**
 * The git bar's read: the project checkout against its remote. Polled by every screen
 * that draws the bar, which is what drives the automatic fetch — see `HostGit`.
 */
const gitStatusRoute = Router.get(
  "/api/git",
  Effect.flatMap(HostGit, (git) =>
    Effect.flatMap(git.status, (view) => ServerResponse.json(toHostGitDto(view))),
  ),
)

/**
 * One press on the git bar. Not a drive and nothing a trak holds: it acts on the project
 * checkout, which no trak owns, so no custody is taken and none refuses it. A merge into
 * that checkout running at the same moment can collide on git's own lock, and the loser
 * is a git failure on the bar like any other.
 *
 * **A request that goes away does not stop its press.** `HostGit` runs each one on its
 * own fiber and this handler waits on it, so a browser reloading mid-press loses the
 * answer and nothing else.
 */
const gitPressed = (pressed: Pressed) =>
  Effect.gen(function* () {
    if (pressed.refusal !== undefined) {
      return yield* refuse(409, toSyncRefusalDto(pressed.refusal, yield* Prompts))
    }
    return yield* ServerResponse.json(toGitPressedDto(yield* (yield* HostGit).status, pressed))
  })

const gitPressRoute = (action: "fetch" | "push") =>
  Router.post(
    `/api/git/${action}`,
    Effect.flatMap(HostGit, (git) => Effect.flatMap(git[action], gitPressed)),
  )

/**
 * The two presses a dirty tree refuses, which is why they take a body: `{ stash: true }`
 * runs the press around a stash. **No body at all is no stash**, since every caller
 * before the field existed sent none.
 */
const gitStashableRoute = (action: StashedPress) =>
  Router.post(
    `/api/git/${action}`,
    Effect.gen(function* () {
      const text = yield* (yield* ServerRequest.HttpServerRequest).text
      const asked =
        text.trim() === "" ? {} : yield* Schema.decode(Schema.parseJson(GitPressRequestDto))(text)
      return yield* gitPressed(yield* (yield* HostGit)[action]({ stash: asked.stash === true }))
    }),
  )

export const gitRoutes = Router.empty.pipe(
  gitStatusRoute,
  gitPressRoute("fetch"),
  gitStashableRoute("pull"),
  gitStashableRoute("reconcile"),
  gitPressRoute("push"),
)
