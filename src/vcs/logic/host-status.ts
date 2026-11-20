// logic: where the host repository stands against its remote, and which presses that
// state refuses.
//
// The reading is `git status --porcelain=v2 --branch`'s header block, which answers
// the branch, the upstream and both counts in one command. The refusals are here rather
// than in the adapter so each rule is a function of a status and nothing else, and the
// adapter's job stays running git.

import { HostHead, type HostStatus, type StashedPress, SyncRefusal } from "../types/host-status.js"
import { BranchName, CommitSha } from "../types/worktree.js"

/** One `# branch.<key> <value>` header, or nothing for a line that is not one. */
const header = (line: string): readonly [string, string] | undefined => {
  const found = /^# branch\.(\S+) (.*)$/.exec(line)
  const key = found?.[1]
  const value = found?.[2]
  return key === undefined || value === undefined ? undefined : [key, value]
}

/**
 * The status, off the header block of `git status --porcelain=v2 --branch`.
 *
 * `branch.ab` is what says the upstream exists: git prints `branch.upstream` for a
 * branch configured to track a remote branch that has gone, and no counts for it.
 */
export const hostStatusOf = (porcelain: string, origin: boolean): HostStatus => {
  const headers = new Map(
    porcelain.split("\n").flatMap((line) => {
      const found = header(line)
      return found === undefined ? [] : [found]
    }),
  )
  const head = headers.get("head") ?? "(detached)"
  const upstream = headers.get("upstream")
  const counts = /^\+(\d+) -(\d+)$/.exec(headers.get("ab") ?? "")
  return {
    head:
      head === "(detached)"
        ? HostHead.Detached({ sha: CommitSha.make(headers.get("oid") ?? "") })
        : HostHead.Branch({ name: BranchName.make(head) }),
    origin,
    ...(upstream === undefined || counts === null
      ? {}
      : { upstream: { name: upstream, ahead: Number(counts[1]), behind: Number(counts[2]) } }),
  }
}

/**
 * Why a pull may not run, or nothing when it may. **The dirty tree is refused whole**,
 * not only where the incoming commits touch it: a fast-forward that happens to miss
 * every uncommitted file today is one that moves them tomorrow, and the rule a person
 * can predict is the one that does not depend on the diff.
 */
export const pullRefusal = (
  status: HostStatus,
  dirty: readonly string[],
): SyncRefusal | undefined => {
  if (status.head._tag === "Detached") return SyncRefusal.Detached()
  if (status.upstream === undefined) return SyncRefusal.NoUpstream()
  const [first, ...rest] = dirty
  if (first !== undefined) return SyncRefusal.Dirty({ files: [first, ...rest] })
  const { ahead, behind } = status.upstream
  if (ahead > 0 && behind > 0) return SyncRefusal.Diverged({ ahead, behind })
  return undefined
}

/**
 * Why a reconcile may not run, or nothing when it may. A reconcile is a merge of the
 * upstream into the branch, so a diverged branch is what it is for — and the dirty tree
 * is refused whole, for `pullRefusal`'s reason. Whether the merge would conflict is not
 * a function of the status, so the adapter asks git that.
 */
export const reconcileRefusal = (
  status: HostStatus,
  dirty: readonly string[],
): SyncRefusal | undefined => {
  if (status.head._tag === "Detached") return SyncRefusal.Detached()
  if (status.upstream === undefined) return SyncRefusal.NoUpstream()
  const [first, ...rest] = dirty
  if (first !== undefined) return SyncRefusal.Dirty({ files: [first, ...rest] })
  return undefined
}

/**
 * The paths `git merge-tree --write-tree --name-only` reports as conflicted: every
 * line between the tree it wrote, which is the first, and the blank line its messages
 * start after.
 */
export const conflictedIn = (mergeTree: string): readonly string[] => {
  const [, ...after] = mergeTree.split("\n")
  const end = after.indexOf("")
  return end === -1 ? after : after.slice(0, end)
}

/**
 * Which entry of `git stash list --format=%H%x09%gs` carries `message` — its commit, or
 * nothing. Matched on the message rather than taken off the top, because the stash
 * stack is one per repository and every worktree of it pushes to the same one.
 */
export const stashNamed = (list: string, message: string): string | undefined =>
  list
    .split("\n")
    .map((line) => line.split("\t"))
    .find(([, subject]) => subject?.endsWith(message) === true)?.[0]

/**
 * Why a push may not run, or nothing when it may. A branch with no upstream is pushed
 * to `origin`, so only that case needs one.
 */
export const pushRefusal = (status: HostStatus): SyncRefusal | undefined => {
  if (status.head._tag === "Detached") return SyncRefusal.Detached()
  if (status.upstream === undefined) return status.origin ? undefined : SyncRefusal.NoOrigin()
  const { ahead, behind } = status.upstream
  if (ahead > 0 && behind > 0) return SyncRefusal.Diverged({ ahead, behind })
  if (behind > 0) return SyncRefusal.Behind({ behind })
  return undefined
}

/**
 * Which press brings the checkout up to a merge into `base`, or nothing where none is
 * the engine's to make. Only the branch tracking `origin/<base>` is moved: another
 * branch would bring down commits the merge has nothing to do with.
 *
 * **Pull where the branch is only behind, never reconcile**: `git merge` honours a
 * person's `merge.ff=false` and would write a merge commit a fast-forward does not need.
 * A dirty tree and a conflict are the presses' own refusals, so they are not read here.
 */
export const updateAfterMerge = (status: HostStatus, base: string): StashedPress | undefined => {
  if (status.head._tag === "Detached" || status.upstream === undefined) return undefined
  const { name, ahead, behind } = status.upstream
  if (name !== `origin/${base}` || behind === 0) return undefined
  return ahead === 0 ? "pull" : "reconcile"
}
