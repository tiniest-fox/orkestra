{{! The `files` figure's grammar. Rendered into the contract only for a step whose
    agent declares `figure: files` on a section. Stored inside filed documents, so
    the old form must still parse after any change. }}
`files` — one item per file, each ended by a blank line. `+ path` is a new file,
`~ path` a changed one, and a bare path one that exists and is not touched. The
indented line under it says what the file is.

```files
+ app/parse/fence.ts
  reads a fence's lines into items

~ app/render/markdown.tsx
  where each fence label is drawn

app/render/diagram.tsx
  the precedent: a labeled fence drawn in place
```
