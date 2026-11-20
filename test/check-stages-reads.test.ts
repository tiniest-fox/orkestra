// `src/check-stages.ts --related` on a file no test imports: one a `reads:` row names, the
// import of an entry a `run:` row names, and a document. The project and the run are
// `test/support/related-repo.ts`'s.

import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { edit, related, relatedRepo } from "./support/related-repo.js"

describe("check-stages --related, on a file no test imports", () => {
  it("runs the reader a reads: row names for a file that changed", () => {
    const { dir, passed } = relatedRepo()
    edit(dir, "data/table.txt")
    expect(related(dir, passed).ran).toStrictEqual(["reader"])
  }, 60_000)

  it("runs the reader a run: row names when a module its entry imports changed", () => {
    const { dir, passed } = relatedRepo()
    edit(dir, "dep.js")
    expect(related(dir, passed).ran).toStrictEqual(["spawn"])
  }, 60_000)

  it("runs no test for a document that changed", () => {
    const { dir, passed } = relatedRepo()
    writeFileSync(join(dir, "notes.md"), "# Notes\n")
    const { out, ran } = related(dir, passed)
    expect(ran).toStrictEqual([])
    expect(out).toBe("✓ pnpm test — no test file selected\n")
  }, 60_000)
})
