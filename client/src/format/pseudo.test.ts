import { describe, expect, it } from "vitest"
import { pseudoRuns } from "./pseudo"

/** Each coloured run of one line, as `hue:text`. */
const lit = (source: string, line = 0): readonly string[] =>
  (pseudoRuns(source)[line] ?? []).flatMap((r) =>
    r.hue === undefined ? [] : [`${r.hue}:${r.text}`],
  )

describe("pseudoRuns", () => {
  it("colours a define's keyword and its name as a call", () => {
    expect(lit("define load_agent(file)\n  return file")).toEqual([
      "keyword:define",
      "call:load_agent",
    ])
  })

  it("makes `in` a keyword only in a loop's head, and the words after its comma rules", () => {
    expect(lit("each section in sections, in order\n  skip")).toEqual([
      "keyword:each",
      "keyword:in",
      "rule:in",
      "rule:order",
    ])
  })

  it("reads a line with a body under it and no core keyword as a rules line", () => {
    expect(lit("when: error\n  log(it)")).toEqual(["rule:when", "rule:error"])
  })

  it("keeps a hole, a string and a comment in their own hue on any line", () => {
    expect(lit('refuse("unknown", {the file}) # never silently')).toEqual([
      "call:refuse",
      'string:"unknown"',
      "hole:{the file}",
      "comment:# never silently",
    ])
  })

  it("joins a condition with keywords, and leaves `C#` a word", () => {
    expect(lit("if lang is not C#\n  return true")).toEqual([
      "keyword:if",
      "keyword:is",
      "keyword:not",
    ])
    expect(lit("if lang is not C#\n  return true", 1)).toEqual(["keyword:return", "constant:true"])
  })

  it("returns one list of runs per line, the text whole", () => {
    const source = "x = 1\n\n# done"
    expect(pseudoRuns(source).map((runs) => runs.map((r) => r.text).join(""))).toEqual(
      source.split("\n"),
    )
  })
})
