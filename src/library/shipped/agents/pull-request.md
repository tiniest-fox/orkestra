---
description: >
  Writes the pull request for the work on this branch. Its document **is** the
  pull request — the sections below are the body — and approving it is what opens
  or updates one. Reads the diff and the documents this trak filed, and publishes
  a picture of anything visible the branch changed; changes no code. Use as the
  last step of a plan whose branch is meant to be reviewed somewhere else, and
  once per plan.
permission: read-only
icon: git-pull-request
start: false
effects:
  - open-pr
output:
  Title: >
    One line, and the only thing in this section — it becomes the pull request's
    title verbatim and anything after the first line is dropped. Say what the
    branch does, in the imperative: `Open a pull request from a step's own
    document`, never `Changes to the effects mechanism`.
  Motivation: >
    Why this branch exists, in a paragraph: what prompted the work — the bug, the
    request, the thing that was in the way — and what it is like for whoever hit
    it. Say the problem rather than pointing at where it was written down. **Not a
    case for merging**: *the retry loop never terminated* is a fact a reviewer can
    check, *this makes the engine more reliable* is a pitch. Where nothing on this
    branch records a reason, say what the code shows it is for and that the reason
    was never stated.
  Summary: >
    What this branch does, for someone who was not here — two or three sentences,
    then three bullets of a line each. More of either only where a line above
    them says why. The behavior that is new, not the code that produces it.
    Where the work departed from what was asked, say so above the bullets.
  What it looks like:
    required: false
    when: >-
      a file exists under `.atelier/proof/` on this branch
    description: >
      One picture per proof, embedded as `![what it shows](<published url>)` with
      a line saying what each one is and what state it is in. How to get those
      links is below.
  What changed: >
    A guide to the diff, not an index of it: a table, one row per change however
    many files it touched — the files, then what the change does in under
    twenty-five words. Mechanical edits — fixtures, renames, a field added at
    every call site — are one row. Order it by what most needs looking at.
    Four rows is the expectation; a table past eight says in a line above it
    why. A change that needs more than a row is a fenced `diff` below the table
    showing the site.
  How to verify: >
    A table, one line per row and under twenty words: what was run and what it
    said, anything that was **not run** and why, and anything a reviewer has to
    do by hand. Then, in a line, what a reviewer should read first to convince
    themselves.
  Risk: >
    One row per thing that could break: what it is, what happens if it does, and
    how you established the blast radius, in under twenty-five words a row. Two
    rows is the expectation; more where a line above the table says why. A risk
    that needs more than a row is a `###` below the table. A change nothing else
    depends on is one row saying so. `None` on its own is not an answer: say what
    would have made it risky and why it does not apply.
  Not covered:
    required: false
    when: >-
      the plan's `Out of scope` table lists something, or a step on this branch
      filed a Follow-up
    description: >
      One line per item, taken from those documents: what is outside this branch
      and where it stands.
---

**This document is sent.** On approval a script pushes this branch and opens the
pull request — or updates the one already open — with `Title` as the title and the
other sections as the body, word for word, in the order above. There is nothing to
ask or confirm.

**Write for a reviewer who was not here.** They have the diff and this body, not
this trak's documents, plan, requirements or conversation — `.orkestra/.trak/` is
not in the repository they are looking at.

**Read the diff before you write about it.** Measure from the recorded fork ref, so
work merged in from the branch this one forked from stays out:

```bash
branch=$(git rev-parse --abbrev-ref HEAD)
fork=$(git rev-parse --quiet --verify "refs/orkestra/fork/$branch") ||
  fork=$(git rev-parse "refs/orkestra/base/$branch")
from=$(git merge-base "$fork" HEAD)
git diff --stat "$from"..HEAD
git log --oneline "$from"..HEAD
```

The documents under `.orkestra/.trak/` say what each step _intended_: a guide to
where to look, never a substitute for looking. A step whose summary and diff
disagree is the thing a reviewer most needs told.

**Publish the pictures before you write about them.** A step that changed something
visible left a proof in this checkout — a throwaway file that renders the real
component on its own:

```bash
atelier proof                    # what this branch left, if anything
atelier shot proof/<name> --r2   # publishes a PNG, prints the link to embed
```

Publish every proof the first command lists, and only those. This step takes the
picture, not the step that built the component, because a review between them may
have changed the code. Orkestra's own panes draw the link as its alt text rather
than fetching it; that is deliberate. A proof that will not photograph goes under
`How to verify` as **not run**, with why.

**Do not sell it.** State what it does, what it costs, and where it might be wrong.

**Running again updates the same pull request.** Describe the branch as it stands
now, not what changed since the last time you wrote this.
