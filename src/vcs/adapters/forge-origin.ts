// The only Layer here: a `Forge` that answers `NoOrigin` for a repository with no remote
// named `origin`, and asks the forge it wraps otherwise.
//
// **A wrapper rather than a check inside `GhForgeLayer`**, so one decision serves every
// forge and the `gh` adapter stays one spawn per request. The test is `HostStatus.origin`,
// read off local configuration: a repository whose `origin` is on no forge we speak to
// still reaches the wrapped forge, which answers `Unavailable` as before.
//
// **A host status that cannot be read asks the wrapped forge.** *I could not tell whether
// there is a remote* is not *there is none*, and reading it as one would draw a verdict
// about a repository nobody looked at.

import { Effect, Layer } from "effect"
import { Forge, type ForgeShape } from "../ports/forge.js"
import { Vcs } from "../ports/vcs.js"
import { ForgeAnswer, ForgeListing, ForgeMerge, ForgeOpen } from "../types/pull-request.js"

const NO_ORIGIN = "there is no `origin` remote"

export const OriginForgeLayer = <E, R>(
  forge: Layer.Layer<Forge, E, R>,
): Layer.Layer<Forge, E, R | Vcs> =>
  Layer.effect(
    Forge,
    Effect.gen(function* () {
      const inner = yield* Forge
      const vcs = yield* Vcs
      const hasOrigin = vcs.hostStatus().pipe(
        Effect.map((status) => status.origin),
        Effect.orElseSucceed(() => true),
      )
      /** `ask` where there is an `origin`, and `none` where there is not. */
      const unlessNoOrigin = <A>(ask: Effect.Effect<A>, none: A): Effect.Effect<A> =>
        Effect.flatMap(hasOrigin, (origin) => (origin ? ask : Effect.succeed(none)))
      return {
        pullRequest: (branch) => unlessNoOrigin(inner.pullRequest(branch), ForgeAnswer.NoOrigin()),
        listing: (branches) => unlessNoOrigin(inner.listing(branches), ForgeListing.NoOrigin()),
        merge: (branch, pick) =>
          unlessNoOrigin(inner.merge(branch, pick), ForgeMerge.Refused({ why: NO_ORIGIN })),
        openPullRequest: (head, base, title, body) =>
          unlessNoOrigin(
            inner.openPullRequest(head, base, title, body),
            ForgeOpen.Refused({ why: NO_ORIGIN }),
          ),
      } satisfies ForgeShape
    }),
  ).pipe(Layer.provide(forge))
