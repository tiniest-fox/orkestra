# `COMPOSITION.md`

**Path:** `.orkestra/COMPOSITION.md`, or `.orkestra/.local/COMPOSITION.md`, which replaces
it whole.

How this team wants plans sequenced, given to the **composer**. The composer chooses
agents by their `description:`; this file holds what no single description can say —
which agent goes first for a kind of work, what always follows what, and costs the
composer cannot see.

## A minimal example

```markdown
# Sequencing

- A change whose whole diff is prose is one `write-docs` step, with no review.
- Work that adds a screen starts with a `ui-prototype` step.
- A plan that changes a tracked file ends with a `pull-request` step.
```

## Format

Free markdown, with no frontmatter and no keys. Absent is normal.

## What the engine does with it

It writes the file into every composer prompt under the heading *Team conventions*, after
the list of available agents. No other step receives it; guidance for every step goes in
[`ORKESTRA.md`](orkestra-md.md).

Write about sequencing only: which agents, in what order, and how many. What each agent
knows, what its artifact contains and which checks it runs are in its agent file, and the
composer cannot change them.
