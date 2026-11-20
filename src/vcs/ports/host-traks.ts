// port: the traks whose checkout is on this machine although the project has a runner.
//
// A trak is placed here when its starting agent sets `place: host` and the host allows it
// for this project — only the project cloned from the repository the host's own code came
// from, as the host decides. Its checkout is then a linked worktree on this
// machine, made as it is with no runner, for the whole of its life: the decision is taken
// once, when the checkout is first made, and recorded, so an edit to the agent file never
// moves a checkout that exists.
//
// **Every routing site asks this, and they have to agree.** Git's choice between this
// machine and the sandbox, the Process layer's routing by working directory,
// `Sandboxes.placeOf` and `Sandboxes.holds`, and the `--runners-only` guard each read
// the same record; one that did not would run half a trak's work in a sandbox that holds
// no checkout. Every reader takes it as an optional service, and a layer set without it
// places nothing here.

import { Context, type Effect } from "effect"
import type { GitFailed } from "../types/errors.js"

export interface HostTraksShape {
  /** Whether `trak`'s checkout is on this machine by the record. `false` where the host does not allow it. */
  readonly has: (trak: string) => Effect.Effect<boolean>
  /** Whether `path` is in the checkout of a trak `has` answers for, under any spelling of the project. */
  readonly at: (path: string) => Effect.Effect<boolean>
  /**
   * Record `trak` as placed here, before its checkout is made. Answers whether it is: `false`,
   * recording nothing, where the host does not allow it for this project. A record that
   * could not be written fails, so no checkout is made here that `has` would deny.
   */
  readonly place: (trak: string) => Effect.Effect<boolean, GitFailed>
}

export class HostTraks extends Context.Tag("HostTraks")<HostTraks, HostTraksShape>() {}
