/**
 * The slices of work a diff can be, as `ChangesDto` values the catalogue can name.
 *
 * **The cases here are the ones that break a renderer, not the ones that look good.** A
 * rename, a deleted file, a binary, a file over the cap, a slice with nothing in it, and a
 * slice whose file list was truncated — every state the surface has to hold has a value
 * here, so the catalogue draws each of them without anybody building one by hand.
 *
 * Nothing imports this: the atelier finds `*.fixtures.ts` by walking, which is why the file
 * is in `knip.json`'s entry list. See `.claude/skills/atelier/references/catalogue.md`.
 */

import type { ChangesDto, FileChangeDto } from "../../../api/types"
import { makeChanges, makeFileChange } from "../../../fixtures"

const renamed: FileChangeDto = makeFileChange({
  path: "client/src/features/trak-detail/ChangeFile.tsx",
  oldPath: "client/src/features/trak-detail/FileCard.tsx",
  change: "renamed",
  additions: 0,
  deletions: 0,
  hunks: [],
})

const removed: FileChangeDto = makeFileChange({
  path: "client/src/features/trak-detail/old-diff.ts",
  change: "deleted",
  additions: 0,
  deletions: 48,
})

const binary: FileChangeDto = makeFileChange({
  path: "docs/shot.png",
  change: "added",
  additions: 0,
  deletions: 0,
  binary: true,
  omitted: "binary",
  hunks: [],
})

const huge: FileChangeDto = makeFileChange({
  path: "pnpm-lock.yaml",
  additions: 4102,
  deletions: 811,
  omitted: "too-large",
  hunks: [],
})

/** The ordinary case: a few files, all with hunks. */
export const changes: ChangesDto = makeChanges({
  files: [
    makeFileChange(),
    makeFileChange({
      path: "client/src/queryCache.ts",
      change: "modified",
      additions: 11,
      deletions: 0,
    }),
    makeFileChange({
      path: "shared/src/dto.ts",
      change: "added",
      additions: 84,
      deletions: 0,
    }),
  ],
})

/** Every shape that draws something other than hunks, in one slice. */
export const changesOdd: ChangesDto = makeChanges({
  files: [makeFileChange(), renamed, removed, binary, huge],
})

/** A slice the file cap truncated — the count is what stops it reading as a complete list. */
export const changesCapped: ChangesDto = makeChanges({
  files: [makeFileChange(), removed],
  omittedFiles: 24,
})

/** Nothing changed. Which of the four sentences is drawn comes from the picked slice's kind. */
export const changesNone: ChangesDto = makeChanges({ at: "uncommitted", files: [] })
