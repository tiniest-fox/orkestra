---
description: >
  Writes the pull request for this branch — a title, a short summary, and a
  picture of anything visible it changed — and approving it opens or updates one.
  Changes no code. Use once, as the last step.
effects:
  - open-pr
output:
  Title: >
    One line in the imperative saying what the branch does. It becomes the pull
    request's title.
  Summary: >
    A few sentences on what this branch changes. Nothing else.
  What it looks like:
    required: false
    when: >-
      a file exists under `.atelier/proof/` on this branch
    description: >
      One picture per proof, embedded as `![what it shows](<published url>)`, with
      a line saying what each one is and what state it is in.
---

Read the diff, then write the title and a few sentences on what changed.

```bash
branch=$(git rev-parse --abbrev-ref HEAD)
fork=$(git rev-parse --quiet --verify "refs/orkestra/fork/$branch") ||
  fork=$(git rev-parse "refs/orkestra/base/$branch")
git diff --stat "$(git merge-base "$fork" HEAD)"..HEAD
```

Publish every proof a step left, and only those, then embed the links it prints:

```bash
atelier proof                    # what this branch left, if anything
atelier shot proof/<name> --r2   # publishes a PNG, prints the link to embed
```

A proof that will not photograph is named in `What it looks like` as not shown, with
why.
