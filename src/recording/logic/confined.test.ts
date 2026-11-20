import { Script } from "node:vm"
import { describe, expect, it } from "vitest"
import { blockBody, type Span } from "./allowance.js"
import { type Compiles, confined } from "./confined.js"
import { closing, lex } from "./lex.js"

const OLD = `export const used = (x: number): number => x + 1
export function unused(x: number): number {
  const y = { a: \`\${x}\` }
  return x * 2 + y.a.length
}
export function other(): string {
  return "}"
}
`

/**
 * The inside of each named function's braces in `text`, as the recorder would allow it —
 * found from the brace that ends the line, since the TypeScript here has return types the
 * head reader, which reads compiled code, does not expect.
 */
const bodies = (text: string, ...names: readonly string[]): readonly Span[] =>
  names.map((name) => {
    const open = text.indexOf("{\n", text.indexOf(`function ${name}`))
    const close = closing(text, open)
    if (close === undefined) throw new Error(`no body for ${name}`)
    return [open + 1, close - 1]
  })

const allowed = bodies(OLD, "unused", "other")

/**
 * V8 compiling the text without running it, as the adapter's child `node --check` does.
 * A script rather than a module, so `export` is blanked and strictness asked for.
 */
const compiles: Compiles = (javascript) => {
  try {
    return (
      new Script(`"use strict";${javascript.replaceAll("export ", "       ")}`) instanceof Script
    )
  } catch {
    return false
  }
}

describe("an edit inside the body of a function never called", () => {
  it("is confined", () => {
    expect(confined(OLD, OLD.replace("x * 2", "x * 3"), allowed, compiles)).toBe(true)
  })

  it("is confined across two such functions edited at once", () => {
    const next = OLD.replace("x * 2", "x * 3").replace('return "}"', 'return "{"')
    expect(confined(OLD, next, allowed, compiles)).toBe(true)
  })

  it("is confined when it adds a line", () => {
    expect(
      confined(
        OLD,
        OLD.replace("  return x * 2", "  const z = 1\n  return x * z"),
        allowed,
        compiles,
      ),
    ).toBe(true)
  })
})

describe("an edit that is not confined", () => {
  it("is one outside every allowed body", () => {
    expect(confined(OLD, OLD.replace("x + 1", "x + 2"), allowed, compiles)).toBe(false)
  })

  it("is one to the function's name or its parameters", () => {
    expect(
      confined(OLD, OLD.replace("function unused", "function unusual"), allowed, compiles),
    ).toBe(false)
    expect(
      confined(
        OLD,
        OLD.replace("unused(x: number)", "unused(x: number, y = 1)"),
        allowed,
        compiles,
      ),
    ).toBe(false)
  })

  it("is one that closes the body early and puts code at the top level", () => {
    const next = OLD.replace(
      "  return x * 2 + y.a.length\n",
      "  return 1 }\nsideEffect()\nfunction g() {\n",
    )
    expect(confined(OLD, next, allowed, compiles)).toBe(false)
  })

  it("is one that leaves the file failing to parse", () => {
    expect(confined(OLD, OLD.replace("const y", "const const y"), allowed, compiles)).toBe(false)
  })

  it("is one that adds a declaration the module then fails to compile", () => {
    expect(
      confined(
        OLD,
        OLD.replace("  return x * 2", "  let z = 1\n  let z = 2\n  return x * 2"),
        allowed,
        compiles,
      ),
    ).toBe(false)
  })

  it("is one with no body allowed at all", () => {
    expect(confined(OLD, OLD.replace("x * 2", "x * 3"), [], compiles)).toBe(false)
  })
})

describe("the lexer", () => {
  it("finds the bracket that closes, past strings, templates and comments", () => {
    const text = 'f(a, "(", `${g(")")}`, /* ) */ b) + 1'
    expect(text.slice(0, closing(text, 1))).toBe('f(a, "(", `${g(")")}`, /* ) */ b)')
  })

  it("refuses text that closes a bracket it did not open", () => {
    expect(lex("a }", 0, 3)).toBeUndefined()
  })

  it("reads a slash after a word as division and after `return` as a pattern", () => {
    expect(lex("a / b / c", 0, 9)).toEqual({ open: "", mode: "code" })
    expect(lex("return /}/", 0, 10)).toEqual({ open: "", mode: "code" })
  })
})

describe("the body of a function, from where V8 says it starts", () => {
  it("is inside the braces of a declaration, a method and a block arrow", () => {
    const text =
      "function f(a = ()=>{}) { return a }\nclass C { m() { x } }\nconst g = async (b) => { y }"
    const inside = (start: number) => {
      const span = blockBody(text, start, text.length)
      return span === undefined ? undefined : text.slice(...span)
    }
    expect(inside(0)).toBe(" return a ")
    expect(inside(text.indexOf("m()"))).toBe(" x ")
    expect(inside(text.indexOf("async"))).toBe(" y ")
  })

  it("is nothing for an expression body, a class field or a computed name", () => {
    const text = "const f = (x) => x + 1\nclass C { a = 1; [k()]() {} }"
    expect(blockBody(text, text.indexOf("(x)"), text.length)).toBeUndefined()
    expect(blockBody(text, text.indexOf("a = 1"), text.length)).toBeUndefined()
    expect(blockBody(text, text.indexOf("[k"), text.length)).toBeUndefined()
  })
})
