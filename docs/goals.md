# Goals

A goal is a finished state a person approves, and a composer that reaches it by opening
traks, waiting for each to land and opening more. Two things shape one:

- the **goal file**, which a goal's composer drafts and a person approves, and
- `.orkestra/GOALS.md`, the project's standing rules for every goal's composer.

## The goal file

**Path:** none. A goal file is never written to disk. The goal's composer drafts it in the
shape of a file, the engine checks the draft by the rules below, and the approved draft is
kept in the goal's log. The goal stops for a person at the drafted file before it opens any trak.

```markdown
---
title: Every screen works on a phone
line: Make each screen usable at 375px wide.
parallel: 2
traks_per_day: 10
modes: [smart, manual]
auto_merge: never
---
Every screen in the app renders without horizontal scrolling at 375px wide, every
control can be reached by touch, and a test fails when a screen regresses.
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `title:` | non-empty string | **required** | The goal's name where a list shows it |
| `line:` | non-empty string | **required** | The one line a list shows under the title |
| `parallel:` | positive whole number | no limit | How many of the goal's traks may be live at once |
| `traks_per_hour:` | positive whole number | no limit | How many traks the composer may open in an hour |
| `traks_per_day:` | positive whole number | no limit | How many traks the composer may open in a day |
| `modes:` | non-empty list of `manual`, `smart`, `auto`, `decider` | all four | The run modes a trak may be opened on |
| `auto_merge:` | `never` or `always` | the composer decides per trak | Whether the goal's traks merge their own pull requests: `never`, or `always` once its checks pass. `false` and `true` are read as `never` and as the default |
| `branch:` | branch name | none | The **goal branch**. Every trak of the goal lands there, and one pull request carries it into the default branch once the goal is done. Without it, traks land on the default branch |

**The body is required**: it describes the world once the goal is over, in the person's
words, and a goal without one can never be done.

**An unknown key fails the draft.** `model:` is refused because a goal's composer runs on
`models.yaml`'s `default:`; `description:` is refused because the body is the description.

The engine refuses the composer a trak past any limit, with the reason, so a goal nobody
is watching cannot widen its own bounds.

## `GOALS.md`

**Path:** `.orkestra/GOALS.md`, or `.orkestra/.local/GOALS.md`, which replaces it whole.

Free markdown, with no frontmatter. The engine hands it to every goal's composer as this
project's rules for goals — for example, when to propose a goal branch, or which kinds of
work never run on `auto`. Absent is normal.
