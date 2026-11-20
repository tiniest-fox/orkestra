{{! The `changes` figure's grammar. Rendered into the contract only for a step whose
    agent declares `figure: changes` on a section. Paths are whole and repo-relative
    because the client joins each one to the step's diff by exact match and does the
    folding into a tree itself — a shortened path is a file the join cannot find.
    The kind marks are a closed set because the client draws one letter per kind.
    Stored inside filed documents, so the old form must still parse after any change. }}
`changes` — the diff, grouped by what each part of it is for. A `## Bucket` line
names a group and the `why:` line under it says what that group of changes does.
Each file under it starts with its kind — `+` added, `~` modified, `-` deleted,
`>` renamed, written `old -> new` — then its whole path from the repository root,
never shortened. The indented line under it says why that file changed. Every
changed file goes in exactly one bucket.

```changes
## The figure key
why: an output section can declare a figure, and the loader refuses a name it does not know
~ app/agents/types.ts
  FIGURES, the names a section may declare
~ app/agents/load.ts
  parses figure: and checks it against FIGURES at load

## The marked table
why: every table fence draws as one component configured per shape
+ web/format/markedTable.ts
  reads the table fences into one configuration, or refuses so the source draws
> web/components/InlineCode.tsx -> web/components/CodeSpans.tsx
  code spans and bold runs, now shared with the map
- web/components/FenceTable.tsx
  the plain table fences drew before; nothing imports it now
```
