// A `HostGit` whose update after a merge is only recorded.
//
// The update itself is pinned against a fake `Vcs` beside `HostGit`. What a merge's caller
// owes is narrower — that it starts the update after the forge answered `Merged`, on the
// pull request's base, and never otherwise — and running the real update would answer
// that only through whatever the fake `Vcs` makes of a fetch.

import { Effect } from "effect"
import { HostGit } from "../../src/app/host-git.js"

/** Run `effect` with `afterMerge` recording each base it is started on, and hand both back. */
export const recordingAfterMerge = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const git = yield* HostGit
    const bases: string[] = []
    const answer = yield* Effect.provideService(effect, HostGit, {
      ...git,
      afterMerge: (base) =>
        Effect.sync(() => {
          bases.push(base)
        }),
    })
    return { answer, bases }
  })
