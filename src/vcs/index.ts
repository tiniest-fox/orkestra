// The public surface of vcs/. Deliberately Effect-free, for the reason
// `src/prompts/index.ts` is: `workflow/domain` imports `Worktree` from here, and
// a barrel that re-exported the Layer would drag `Layer` in behind it.
//
// The `Vcs` and `Forge` tags live in `ports/`, and each adapter's Layer in
// `adapters/` — import those directly.

export type { ChangeHunk, ChangeLine, Changes, FileChange } from "./types/changes.js"
export {
  ForgeAnswer,
  ForgeListing,
  ForgeMerge,
  ForgeOpen,
  MERGE_METHOD,
  type MergeMethod,
} from "./types/pull-request.js"
export {
  HostHead,
  type HostStatus,
  type StashedPress,
  StashedSync,
  SyncRefusal,
} from "./types/host-status.js"
export { branchFor, carriedRefFor, type CheckoutPlace } from "./logic/paths.js"
export { updateAfterMerge } from "./logic/host-status.js"
export {
  BranchMove,
  BranchName,
  ChangeRange,
  CommitSha,
  KeptWork,
  MergeInto,
  MergeOutcome,
  Removal,
  Worktree,
  WorktreePath,
} from "./types/worktree.js"
