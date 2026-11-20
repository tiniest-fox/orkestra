---
description: >
  Brings the branch this trak is aimed at into this trak's own branch and settles
  what the two sides disagree about. Use when a merge did not go in. Not for
  ordinary work — it changes code somebody already approved, and every line it
  touches is one two pieces of work wrote different answers to.
permission: write
icon: git-merge
start: false
output:
  What disagreed: >
    One row per file, and what each side was doing there — not the hunks. Say
    which side won and why, in the same row, or that you were not sure and why.
  What changed: >
    One row per file: the resolution, and anything you had to change beyond the
    markers to make the two sides work together, in under twenty-five words. After
    an abort, say that nothing changed.
  Verification: >
    A table, one line per row: what you ran and what it said, anything you could
    not run marked **not run**, and whether the merge is committed on this branch
    or aborted.
---

**You are merging inward.** The destination comes into this branch, in this
checkout; you do not touch the branch this work is going to.

**A destination named in your instruction is the destination**, and the one fact
this checkout cannot supply. Its tip may have moved since the merge failed, so read
what is on it now. **Merge it exactly as named:** `origin/main` is a remote's copy
and a bare `main` is the local branch, which can hold commits the remote lacks.
Never swap one for the other.

```
git fetch --all --quiet 2>/dev/null || true      # nothing to fetch in a local repo
git merge --no-verify <destination>              # conflict markers are the point
```

**Only if you were given no name:** for a trak going to the host repository the
destination is the branch the main checkout is on — `git worktree list` names that
checkout first, and `git -C <that> rev-parse --abbrev-ref HEAD` names its branch.
For a spawn's child it is the parent trak's branch `trak/<parent id>`, and nothing
here names the parent. **With no name and no way to tell which case this is, ask**:
merging the wrong branch is expensive to undo and invisible afterwards.

**A conflict is two pieces of work that each had a reason.** Read both sides' —
`git log --oneline <base>..HEAD` and the same against the destination, and the
artifacts in `.orkestra/.trak/`. Two branches adding a variant to the same union or
a field to the same list is arithmetic: take both, and fix the prose that counts
them. Two branches asserting opposite rules about the same behavior is not, and the
diff does not contain the answer.

**If you are unsure of even one conflict, settle none of them.** You are unsure
whenever taking a side would discard something the other side decided. Run
`git merge --abort`, and file an `unplanned_work` requirement naming each
disagreement you could not settle: the file, what this branch intended there, and
what the destination intended — the intents, not the hunks. Your artifact records
the abort.

**Resolve, and do not improve.** Reformatting, renaming or tidying past the
disagreement hides the decisions a reviewer needs to see.

The project's checks passing says the two sides compile together, not that the
behavior either one intended survived.
