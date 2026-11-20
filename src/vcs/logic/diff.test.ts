// Every patch below is the output of a real `git diff` in a scratch repository,
// pasted verbatim. The format has more corners than it looks — `\ No newline at
// end of file`, a rename header, `new file mode`, an empty heading, a binary
// stub — and hand-writing one produces a fixture that agrees with the parser
// rather than with git.
//
// To regenerate: make the change in a scratch repo and run the invocation
// `adapters/git-cli.ts` uses (`DIFF` there, plus the two ends of the range).
// **A patch of code containing a backtick or `${` has to be escaped** on the way
// into these template literals, and a tab at the end of a line is written `\t`
// so a formatter cannot eat it.

import { describe, expect, it } from "vitest"
import { parseUnifiedDiff } from "./diff.js"

/**
 * One commit against the one before it: a deletion, a rename with an edit, a
 * binary file, a two-hunk modification, a new file, and a file with no trailing
 * newline on either side.
 */
const COMMITTED = `diff --git a/doomed.txt b/doomed.txt
deleted file mode 100644
index e0628e2..0000000
--- a/doomed.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-this file is going away
-second line
diff --git a/old-name.md b/new-name.md
similarity index 84%
rename from old-name.md
rename to new-name.md
index 9ede301..00e25c8 100644
--- a/old-name.md
+++ b/new-name.md
@@ -3,3 +3,6 @@ It has some words in it.
 And a few more so the rename is detected.
 Line four.
 Line five.
+
+
+Appended a line.
diff --git a/shot.png b/shot.png
index a9d814e..f730d06 100644
Binary files a/shot.png and b/shot.png differ
diff --git a/lib/calc.ts b/lib/calc.ts
index 180bcb9..9c46b69 100644
--- a/lib/calc.ts
+++ b/lib/calc.ts
@@ -2,8 +2,10 @@ export const add = (a: number, b: number): number => a + b
 
 export const sub = (a: number, b: number): number => a - b
 
+export const neg = (a: number): number => -a
+
 const helper = (): string => {
-  return "one"
+  return "two"
 }
 
 export const mul = (a: number, b: number): number => a * b
@@ -13,3 +15,5 @@ export const div = (a: number, b: number): number => a / b
 export const mod = (a: number, b: number): number => a % b
 
 export const pow = (a: number, b: number): number => a ** b
+
+export const abs = (a: number): number => Math.abs(a)
diff --git a/lib/fresh.ts b/lib/fresh.ts
new file mode 100644
index 0000000..858b121
--- /dev/null
+++ b/lib/fresh.ts
@@ -0,0 +1 @@
+export const fresh = true
diff --git a/tail.txt b/tail.txt
index d33b21f..2da414b 100644
--- a/tail.txt
+++ b/tail.txt
@@ -1 +1 @@
-no trailing newline here
\\ No newline at end of file
+no trailing newline here, changed
\\ No newline at end of file
`

/** `git diff --no-index -- /dev/null <path>`, which is how an untracked file is read. */
const UNTRACKED_TEXT = `diff --git a/untracked.ts b/untracked.ts
new file mode 100644
index 0000000..67dac95
--- /dev/null
+++ b/untracked.ts
@@ -0,0 +1,2 @@
+export const brandNew = 1
+export const other = 2
`

const UNTRACKED_BINARY = `diff --git a/new.bin b/new.bin
new file mode 100644
index 0000000..0baf6f3
Binary files /dev/null and b/new.bin differ
`

/**
 * Two hazards in one commit: a path with a space in it, which git follows with a
 * tab on the `---`/`+++` lines, and a file whose own content is a patch — so its
 * removed lines read as `----` and `-+++` once the marker is on the front.
 */
const AWKWARD = `diff --git a/my notes.md b/my notes.md
index 4cb29ea..289bbda 100644
--- a/my notes.md\t
+++ b/my notes.md\t
@@ -1,3 +1,3 @@
 one
-two
+two changed
 three
diff --git a/patch-of-a-patch.diff b/patch-of-a-patch.diff
index bb3f015..228ed75 100644
--- a/patch-of-a-patch.diff
+++ b/patch-of-a-patch.diff
@@ -1,5 +1,5 @@
---- a/before.ts
-+++ b/before.ts
+--- a/after.ts
++++ b/after.ts
 @@ -1,2 +1,2 @@
 -old
 +new
`

/** Git's marker, exactly as it writes it — the text a kept row carries. */
const NO_NEWLINE = String.raw`\ No newline at end of file`

const fileAt = (patch: string, path: string) => {
  const found = parseUnifiedDiff(patch).files.find((f) => f.path === path)
  if (found === undefined) throw new Error(`no file ${path} in the parsed patch`)
  return found
}

describe("what a patch says happened to each file", () => {
  it("reads every file in one commit, in path order", () => {
    // Sorted rather than in git's order, because the uncommitted slice appends a
    // diff per untracked file and an answer where the new ones clump at the
    // bottom reads as two lists.
    expect(parseUnifiedDiff(COMMITTED).files.map((f) => f.path)).toEqual([
      "doomed.txt",
      "lib/calc.ts",
      "lib/fresh.ts",
      "new-name.md",
      "shot.png",
      "tail.txt",
    ])
  })

  it("counts additions and deletions off the patch itself", () => {
    // No `--numstat`: a second invocation could only disagree with this one, and
    // it says `-` for exactly the binary files it looks like it would rescue.
    expect(fileAt(COMMITTED, "lib/calc.ts")).toMatchObject({
      change: "modified",
      additions: 5,
      deletions: 1,
      binary: false,
    })
  })

  it("draws a rename as one file naming both paths", () => {
    // `-M` is on so a moved file is one row rather than two large opposite ones,
    // and the `rename from`/`rename to` headers are the unambiguous source of
    // both names.
    expect(fileAt(COMMITTED, "new-name.md")).toMatchObject({
      change: "renamed",
      oldPath: "old-name.md",
      additions: 3,
      deletions: 0,
    })
  })

  it("says added and deleted from the headers, not from the counts", () => {
    expect(fileAt(COMMITTED, "lib/fresh.ts").change).toBe("added")
    expect(fileAt(COMMITTED, "doomed.txt")).toMatchObject({
      change: "deleted",
      additions: 0,
      deletions: 2,
    })
  })

  it("gives a binary file a row, a reason, and no invented counts", () => {
    // Git counts no lines in a binary file, so `0/0` is what is true. The row
    // exists because the file changing is the fact a reader wants.
    expect(fileAt(COMMITTED, "shot.png")).toMatchObject({
      change: "modified",
      binary: true,
      omitted: "binary",
      additions: 0,
      deletions: 0,
      hunks: [],
    })
  })

  it("keeps the no-newline marker as a row with no numbers on it", () => {
    // Not a line of the file, so it takes neither number and neither count — but
    // it is the only thing that says a trailing newline moved, and without it the
    // two rows below draw as the same text twice with nothing explaining why.
    //
    // Both positions git writes it in are here: the first follows the removed
    // line while the hunk still has its added line to come, and the second
    // follows the last line of the hunk, where git's own counts have already run
    // out and only the leading backslash says what it is.
    const hunk = fileAt(COMMITTED, "tail.txt").hunks[0]
    expect(hunk?.lines).toEqual([
      { kind: "del", text: "no trailing newline here", oldLine: 1 },
      { kind: "context", text: NO_NEWLINE },
      { kind: "add", text: "no trailing newline here, changed", newLine: 1 },
      { kind: "context", text: NO_NEWLINE },
    ])
  })
})

describe("what a hunk says about where its lines sit", () => {
  it("carries git's heading and both line spans", () => {
    const [first, second] = fileAt(COMMITTED, "lib/calc.ts").hunks
    expect(first).toMatchObject({
      oldStart: 2,
      oldCount: 8,
      newStart: 2,
      newCount: 10,
      heading: "export const add = (a: number, b: number): number => a + b",
    })
    expect(second).toMatchObject({ oldStart: 13, newStart: 15 })
  })

  it("numbers each line on the side it is on, and both for context", () => {
    const lines = fileAt(COMMITTED, "lib/calc.ts").hunks[0]?.lines ?? []
    // The first four rows walk both counters together, then the addition moves
    // only the new one — which is the whole of what a gutter draws.
    expect(lines.slice(0, 5)).toEqual([
      { kind: "context", text: "", oldLine: 2, newLine: 2 },
      {
        kind: "context",
        text: "export const sub = (a: number, b: number): number => a - b",
        oldLine: 3,
        newLine: 3,
      },
      { kind: "context", text: "", oldLine: 4, newLine: 4 },
      { kind: "add", text: "export const neg = (a: number): number => -a", newLine: 5 },
      { kind: "add", text: "", newLine: 6 },
    ])
    expect(lines.find((l) => l.kind === "del")).toEqual({
      kind: "del",
      text: '  return "one"',
      oldLine: 6,
    })
  })

  it("reads an omitted count as 1, the way git writes a single-line hunk", () => {
    expect(fileAt(COMMITTED, "tail.txt").hunks[0]).toMatchObject({
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      heading: "",
    })
  })

  it("leaves a hunk on git's counts, never on what a line looks like", () => {
    // The line that breaks a shape test: a removed line whose own content is
    // `--- a/before.ts` arrives as `----`, and a parser leaving the hunk there
    // takes it for the next file's header and loses the rest.
    const file = fileAt(AWKWARD, "patch-of-a-patch.diff")
    expect(file.change).toBe("modified")
    expect(file.hunks[0]?.lines).toEqual([
      { kind: "del", text: "--- a/before.ts", oldLine: 1 },
      { kind: "del", text: "+++ b/before.ts", oldLine: 2 },
      { kind: "add", text: "--- a/after.ts", newLine: 1 },
      { kind: "add", text: "+++ b/after.ts", newLine: 2 },
      { kind: "context", text: "@@ -1,2 +1,2 @@", oldLine: 3, newLine: 3 },
      { kind: "context", text: "-old", oldLine: 4, newLine: 4 },
      { kind: "context", text: "+new", oldLine: 5, newLine: 5 },
    ])
  })

  it("keeps a path that has a space in it, without the tab git follows it with", () => {
    expect(parseUnifiedDiff(AWKWARD).files.map((f) => f.path)).toContain("my notes.md")
  })
})

describe("an untracked file, read the way the uncommitted slice reads one", () => {
  it("is an addition with its contents, from a --no-index patch", () => {
    expect(fileAt(UNTRACKED_TEXT, "untracked.ts")).toMatchObject({
      change: "added",
      additions: 2,
      deletions: 0,
      binary: false,
    })
  })

  it("is a binary stub when that is what it is", () => {
    expect(fileAt(UNTRACKED_BINARY, "new.bin")).toMatchObject({
      change: "added",
      binary: true,
      omitted: "binary",
    })
  })

  it("joins onto the tracked diff as one answer", () => {
    // What the adapter hands over: the tracked patch with one `--no-index` patch
    // per untracked file appended. A concatenation of records is a valid patch,
    // which is what lets there be one parse rather than one per file.
    const files = parseUnifiedDiff([COMMITTED, UNTRACKED_TEXT].join("\n")).files
    expect(files.map((f) => f.path)).toContain("untracked.ts")
    expect(files.map((f) => f.path)).toContain("lib/calc.ts")
  })
})

/**
 * A patch of one added file with `n` lines, in git's own shape.
 *
 * Built rather than captured: the cap cases need a file longer than the cap, and
 * a fixture that size would be most of this file for no more evidence.
 */
const bigFile = (path: string, n: number): string =>
  [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..858b121",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${String(n)} @@`,
    ...Array.from({ length: n }, (_, i) => `+line ${String(i)}`),
    "",
  ].join("\n")

describe("what the caps do to an answer that would not fit", () => {
  it("keeps a huge file's counts and drops only its hunks", () => {
    // The counts are what make the cap bearable: the row still says how much of
    // the file changed, so a truncated answer is visibly truncated rather than
    // quietly short.
    const file = fileAt(bigFile("huge.ts", 5000), "huge.ts")
    expect(file).toMatchObject({ additions: 5000, deletions: 0, omitted: "too-large", hunks: [] })
  })

  it("leaves a file just under the cap whole", () => {
    expect(fileAt(bigFile("modest.ts", 400), "modest.ts").hunks).toHaveLength(1)
  })

  it("cuts the file list and says how many it cut", () => {
    const patch = Array.from({ length: 260 }, (_, i) =>
      bigFile(`f${String(i).padStart(3, "0")}.ts`, 1),
    ).join("")
    const changes = parseUnifiedDiff(patch)
    expect(changes.files).toHaveLength(200)
    expect(changes.omittedFiles).toBe(60)
    // Cut after the sort, so which files survive is a fact about the paths
    // rather than about the order git happened to print them.
    expect(changes.files[0]?.path).toBe("f000.ts")
  })

  it("says nothing about omitted files when none were", () => {
    expect(parseUnifiedDiff(COMMITTED).omittedFiles).toBeUndefined()
  })
})

describe("a patch with nothing in it", () => {
  it("is no files, which is what a step that changed nothing looks like", () => {
    expect(parseUnifiedDiff("")).toEqual({ files: [] })
  })
})
