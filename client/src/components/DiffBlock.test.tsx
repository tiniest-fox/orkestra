/**
 * How a fence's lines become rows — the part of `DiffBlock` that can be wrong silently.
 */

import { describe, expect, it } from "vitest"
import { rowsOf } from "./DiffBlock"

describe("rowsOf", () => {
  it("keeps a bare block's context as written, so indentation stays a column true", () => {
    // What an agent writes: no leading space on context. Stripping one would pull
    // `  return x` a column left of the `+  b` beside it.
    expect(rowsOf("function f() {\n-  a\n+  b\n  return x\n}")).toEqual([
      { kind: "context", text: "function f() {" },
      { kind: "del", text: "  a" },
      { kind: "add", text: "  b" },
      { kind: "context", text: "  return x" },
      { kind: "context", text: "}" },
    ])
  })

  it("strips a patch's context space, where every context line carries one", () => {
    expect(rowsOf(" function f() {\n-  a\n+  b\n\n }")).toEqual([
      { kind: "context", text: "function f() {" },
      { kind: "del", text: "  a" },
      { kind: "add", text: "  b" },
      { kind: "context", text: "" },
      { kind: "context", text: "}" },
    ])
  })

  it("tells a file header from a removed line, and a range from either", () => {
    expect(rowsOf("--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n-old\n+new")).toEqual([
      { kind: "header", text: "--- a/x.ts" },
      { kind: "header", text: "+++ b/x.ts" },
      { kind: "range", text: "@@ -1,2 +1,2 @@" },
      { kind: "del", text: "old" },
      { kind: "add", text: "new" },
    ])
  })

  it("reads a bare `---` as a header and `----` as a removed rule", () => {
    expect(rowsOf("---\n----")).toEqual([
      { kind: "header", text: "---" },
      { kind: "del", text: "---" },
    ])
  })
})
