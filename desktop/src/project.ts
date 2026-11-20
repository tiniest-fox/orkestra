// Whether a folder is one the app may open, decided before anything spawns.
//
// Three checks, and the refusal names which one failed: a folder that is no longer
// there — a recent whose repository was moved or deleted — one that is not a git
// repository, and one that has no `.orkestra/`. The engine's own loader walks *up* from
// a start directory to find `.orkestra/`, which is right for a command typed inside a
// worktree and wrong for a picker — a person who chose `src/` would get their
// repository's engine under a name that is not the repository. So the checks are on the
// folder itself. Writing an `.orkestra/` is a separate setup step nobody has designed;
// this only opens one that exists.
//
// Pure over a `kind` callback so the decision is testable without a filesystem; the
// caller hands in `stat`.

export type EntryKind = "missing" | "file" | "directory"

/** Which check failed, and the sentence the dialog shows. */
export interface Refusal {
  readonly check: "missing" | "git" | "orkestra"
  readonly reason: string
}

/**
 * `.git` is a directory in a repository and a file in a worktree, and both are
 * repositories to git — so either kind passes. `.orkestra` has to be a directory.
 *
 * The folder itself is checked first: a deleted repository has no `.git` either, and
 * *not a git repository* would send a person looking for one in a folder that is gone.
 */
export const projectRefusal = (
  dir: string,
  kind: (path: string) => EntryKind,
): Refusal | undefined => {
  if (kind(dir) === "missing") {
    return { check: "missing", reason: `${dir} no longer exists.` }
  }
  if (kind(`${dir}/.git`) === "missing") {
    return { check: "git", reason: `${dir} is not a git repository — there is no .git in it.` }
  }
  if (kind(`${dir}/.orkestra`) !== "directory") {
    return {
      check: "orkestra",
      reason: `${dir} has no .orkestra/ — Orkestra opens only a repository that already has one.`,
    }
  }
  return undefined
}
