// Nowhere to project, so nothing is written.
//
// The counterpart of `NoVcsLayer`, and provided by the same callers: the offline
// demos, and `pnpm real:compose`, which runs with no `Vcs` at all in the human's
// own checkout. A projection there would write this trak's paperwork into the
// directory someone is sitting in, which is precisely what a worktree exists to
// prevent — so the answer is a Layer rather than a flag the runtime reads.

import { Effect, Layer } from "effect"
import { Workspace, type WorkspaceShape } from "../ports/workspace.js"

export const NoWorkspaceLayer = Layer.succeed(Workspace, {
  project: () => Effect.void,
  // A demo trak that reaches a merge leaves no record either, for the same reason:
  // there is no directory here that is ours to write into.
  keepRecord: () => Effect.void,
} satisfies WorkspaceShape)
