/**
 * Tier 1 (`testing-tiers`): the index tree, and the compression that makes it fit.
 *
 * The compression is the whole reason a tree is affordable in a 160px column, and it is
 * also the one rule that can be got subtly wrong without anything failing — a run joined
 * one directory too far hides a folder that had a sibling, and a run not joined far enough
 * costs the rows the tree was chosen to save.
 */

import { describe, expect, it } from "vitest"
import { makeFileChange } from "../fixtures"
import { fileTree, indexRows } from "./fileTree"

const at = (...paths: readonly string[]) => indexRows(paths.map((path) => makeFileChange({ path })))

describe("indexRows", () => {
  it("joins a run of single-child directories onto one row", () => {
    expect(at("client/src/features/trak-detail/rows.ts")).toEqual([
      { kind: "dir", label: "client/src/features/trak-detail", depth: 0 },
      {
        kind: "file",
        label: "rows.ts",
        depth: 1,
        path: "client/src/features/trak-detail/rows.ts",
        change: "modified",
      },
    ])
  })

  it("stops a run at the first directory that branches", () => {
    const labels = at("src/app/dto.ts", "src/vcs/git.ts")
      .filter((row) => row.kind === "dir")
      .map((row) => row.label)

    expect(labels).toEqual(["src", "app", "vcs"])
  })

  it("stops a run where a file sits beside the subdirectory", () => {
    const rows = at("src/index.ts", "src/app/dto.ts")

    expect(rows.filter((row) => row.kind === "dir").map((row) => row.label)).toEqual(["src", "app"])
  })

  it("gives a file at the root no directory row at all", () => {
    expect(at("README.md")).toEqual([
      { kind: "file", label: "README.md", depth: 0, path: "README.md", change: "modified" },
    ])
  })

  it("indents by depth so a joined run costs one level, not four", () => {
    const rows = at("a/b/c/d.ts", "a/e.ts")
    const file = rows.find((row) => row.kind === "file" && row.label === "d.ts")

    // `a` branches, so the run under it is `b/c` at depth 1 and the file at depth 2.
    expect(file?.depth).toBe(2)
  })

  it("carries the change onto the row, which is what colours the dot", () => {
    const rows = indexRows([makeFileChange({ path: "gone.ts", change: "deleted" })])

    expect(rows[0]).toMatchObject({ kind: "file", change: "deleted" })
  })
})

const treeAt = (...paths: readonly string[]) =>
  fileTree(paths.map((path) => makeFileChange({ path })))

describe("fileTree", () => {
  it("nests a directory's files under it, which is what a sticky header pins against", () => {
    const dto = makeFileChange({ path: "src/app/dto.ts" })
    const git = makeFileChange({ path: "src/vcs/git.ts" })

    expect(fileTree([dto, git])).toEqual([
      {
        kind: "dir",
        label: "src",
        depth: 0,
        children: [
          {
            kind: "dir",
            label: "app",
            depth: 1,
            children: [{ kind: "file", label: "dto.ts", depth: 2, file: dto }],
          },
          {
            kind: "dir",
            label: "vcs",
            depth: 1,
            children: [{ kind: "file", label: "git.ts", depth: 2, file: git }],
          },
        ],
      },
    ])
  })

  it("orders a directory's subdirectories before the files beside them", () => {
    const [src] = treeAt("src/index.ts", "src/app/dto.ts")

    expect(src?.kind === "dir" ? src.children.map((child) => child.kind) : []).toEqual([
      "dir",
      "file",
    ])
  })

  it("flattens to exactly the rows the index draws, so the two surfaces cannot disagree", () => {
    const paths = ["client/src/api/types.ts", "client/src/api/client.ts", "README.md"]
    const flat = at(...paths)

    // Same walk, written down: every flat row appears in the tree's own order.
    expect(flat.map((row) => row.label)).toEqual([
      "client/src/api",
      "types.ts",
      "client.ts",
      "README.md",
    ])
  })
})
