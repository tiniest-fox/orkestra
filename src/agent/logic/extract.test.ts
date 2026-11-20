// One entry point, so every case goes through `extractJson` — testing the two
// internal strategies separately would pin an implementation detail the rest of
// the system can't observe.
//
// Most cases here are regressions. The first implementation took the FIRST fence
// and sliced first-brace-to-last-brace; both picked the wrong JSON on shapes a
// real coding agent produces constantly.

import { Option } from "effect"
import { describe, expect, it } from "vitest"
import { extractJson, type Extracted, unparsedEnvelope } from "./extract.js"

const got = (o: Option.Option<Extracted>): unknown => (Option.isSome(o) ? o.value.value : undefined)

/** The response with the envelope taken out — what a surface draws. See `Extracted`. */
const left = (text: string): string | undefined => {
  const found = extractJson(text)
  return Option.isNone(found) ? text : text.replace(found.value.envelope, "")
}

const envelope = (content: string) => ({ _tag: "Artifact", content })
const fence = (body: unknown, tag = "json") => `\`\`\`${tag}\n${JSON.stringify(body)}\n\`\`\``
const wanted = envelope("the real one")
const decoy = envelope("the decoy")

describe("the shapes an agent actually produces", () => {
  it.each([
    ["a bare fenced envelope", fence(wanted)],
    ["prose, then the fence", `Sure, here you go.\n\n${fence(wanted)}`],
    ["unfenced JSON only", JSON.stringify(wanted)],
    ["prose, then unfenced JSON", `Done. ${JSON.stringify(wanted)}`],
    ["a legacy ork fence", fence(wanted, "ork")],
    ["an uppercase info string", fence(wanted, "JSON")],
    ["a bare ``` fence", fence(wanted, "")],
  ])("resolves %s", (_label, text) => {
    expect(got(extractJson(text))).toEqual(wanted)
  })
})

describe("JSON that is not at the end", () => {
  it("ignores a sign-off after the fence", () => {
    // The most common real shape by far, and the one no earlier test covered:
    // the model emits the envelope and then keeps talking.
    const text = `${fence(wanted)}\n\nLet me know if you'd like anything changed!`
    expect(got(extractJson(text))).toEqual(wanted)
  })

  it("ignores a sign-off containing a stray brace", () => {
    // A trailing `}` moves the end of the trailing-object scan past the
    // envelope, so this only resolves because fences are tried first.
    const text = `${fence(wanted)}\n\nI also touched main.ts — see the else { } branch.`
    expect(got(extractJson(text))).toEqual(wanted)
  })

  it("ignores a sign-off after unfenced JSON", () => {
    const text = `Here you go: ${JSON.stringify(wanted)} — hope that helps.`
    expect(got(extractJson(text))).toEqual(wanted)
  })

  it("skips a leading code block rather than giving up on it", () => {
    // Old behaviour: None. The first fence wasn't JSON, so it stopped there.
    const text = `\`\`\`ts\nconst x = 1\n\`\`\`\n${fence(wanted)}`
    expect(got(extractJson(text))).toEqual(wanted)
  })

  it("skips a trailing code block that follows the envelope", () => {
    // Last-fence-wins must mean "last fence that PARSES", not "last fence".
    const text = `${fence(wanted)}\n\nFor reference:\n\`\`\`sh\nork list --json\n\`\`\``
    expect(got(extractJson(text))).toEqual(wanted)
  })

  it("ignores an earlier brace in prose", () => {
    // first-brace-to-last-brace produced garbage here and returned None.
    expect(got(extractJson(`I edited {main.ts} as asked. ${JSON.stringify(wanted)}`))).toEqual(
      wanted,
    )
  })
})

describe("several JSON blocks", () => {
  it("takes the last fence when the agent reconsiders", () => {
    // Old behaviour: the FIRST fence won, so the engine parked for questions the
    // agent had already answered itself two lines later.
    const text = `${fence({ _tag: "Questions", questions: ["which subcommands?"] })}\n\nActually, I can see it — done:\n\n${fence(wanted)}`
    expect(got(extractJson(text))).toEqual(wanted)
  })

  it("takes the last of three fences", () => {
    const text = [fence(decoy), "then", fence(decoy), "no wait", fence(wanted)].join("\n")
    expect(got(extractJson(text))).toEqual(wanted)
  })

  it("prefers a fence over unfenced JSON that appears later", () => {
    // The fence is the deliberate signal; loose JSON in a sign-off is not.
    const text = `${fence(wanted)}\n\nfor reference the old value was ${JSON.stringify(decoy)}`
    expect(got(extractJson(text))).toEqual(wanted)
  })

  it("takes the last of several unfenced objects", () => {
    const text = `First I tried ${JSON.stringify(decoy)}, then settled on ${JSON.stringify(wanted)}`
    expect(got(extractJson(text))).toEqual(wanted)
  })
})

describe("nothing usable", () => {
  it("returns none for plain prose — the park_plain_text case", () => {
    expect(Option.isNone(extractJson("Sure, I've added the flag and updated the tests."))).toBe(
      true,
    )
  })

  it("returns none for a fence holding no JSON", () => {
    expect(Option.isNone(extractJson("```ts\nconst x = 1\n```"))).toBe(true)
  })

  it("does not throw on malformed JSON inside a well-formed fence", () => {
    expect(Option.isNone(extractJson("```json\n{not json\n```"))).toBe(true)
  })

  it("rejects a bare array — every schema we elicit is a struct", () => {
    expect(Option.isNone(extractJson("[1,2,3]"))).toBe(true)
  })
})

describe("JSON that merely contains braces", () => {
  it("keeps nested objects whole", () => {
    expect(got(extractJson('done: {"a":{"b":1}}'))).toEqual({ a: { b: 1 } })
  })

  it("tolerates braces inside strings", () => {
    expect(got(extractJson('{"note":"use {braces} freely"}'))).toEqual({
      note: "use {braces} freely",
    })
  })

  it("handles an artifact whose content is itself JSON-ish prose", () => {
    const inner = 'the config takes {"port": 8080}'
    expect(got(extractJson(fence(envelope(inner))))).toEqual(envelope(inner))
  })
})

// What a surface subtracts, which is the half a person sees. Each case asserts on the
// residue rather than on the value: leaving a delimiter behind draws an empty code
// block, and that is indistinguishable from the envelope never having been taken.
describe("the slice the value came from", () => {
  const artifact = JSON.stringify({ type: "artifact", sections: { Summary: "done" } })

  it("covers the fence, not just the object inside it", () => {
    expect(left("Here it is.\n\n```json\n" + artifact + "\n```")?.trim()).toBe("Here it is.")
  })

  it("is the object alone when the agent fenced nothing", () => {
    expect(left("Renamed the field.\n\n" + artifact)?.trim()).toBe("Renamed the field.")
  })

  it("covers a fence of four backticks", () => {
    // The realistic one — a model reaches for a fourth backtick precisely when the
    // content holds backticks, which an artifact's JSON routinely does.
    expect(left("Filed it.\n\n````json\n" + artifact + "\n````")?.trim()).toBe("Filed it.")
  })

  it("covers a fence indented inside a list item", () => {
    expect(left("- Filed it:\n\n  ```json\n  " + artifact + "\n  ```")?.trim()).toBe("- Filed it:")
  })

  it("covers a fence of tildes", () => {
    expect(left("Filed it.\n\n~~~json\n" + artifact + "\n~~~")?.trim()).toBe("Filed it.")
  })

  it("covers the fence when an unclosed block earlier in the prose desynchronises them", () => {
    // The ```sh block is never closed, so pairing openers to closers in order hands the
    // envelope's own opener to it. The agent's broken block stays broken; the envelope's
    // fence goes with the envelope.
    const text = "I ran:\n\n```sh\npnpm verify\n\n```json\n" + artifact + "\n```"
    expect(left(text)?.trim()).toBe("I ran:\n\n```sh\npnpm verify")
  })

  it("leaves the line above alone when it closes a block rather than opening one", () => {
    // The mirror, and the reason widening asks which end a bare ``` is: taking this one
    // would strip the block's closer and leave ```sh drawing over the rest.
    const said = left("```sh\npnpm verify\n```\n" + artifact + "\n```")
    expect(said?.includes("```sh\npnpm verify\n```")).toBe(true)
    expect(said?.includes("sections")).toBe(false)
  })

  it("stops at the closer rather than at a ``` the envelope's own markdown carries", () => {
    // The ordinary artifact: a section quoting a command. JSON has no literal newline in
    // a string, so that ``` is never at a line start and the anchored closer scans past it.
    const quoting = JSON.stringify({
      type: "artifact",
      sections: { Verification: "Ran it:\n\n```sh\npnpm verify\n```\n\nExit 0." },
    })
    const text = "```json\n" + quoting + "\n```"
    expect(got(extractJson(text))).toEqual(JSON.parse(quoting))
    expect(left(text)?.trim()).toBe("")
  })

  it("keeps a sign-off written after it — the agent is still talking to the reader", () => {
    const text = "```json\n" + artifact + "\n```\n\nShout if the naming is wrong."
    expect(left(text)?.trim()).toBe("Shout if the naming is wrong.")
  })
})

describe("a trailing comma", () => {
  const trailing =
    '```json\n{\n  "type": "artifact",\n  "sections": { "Summary": "done", },\n  "items": [1, 2, ],\n}\n```'

  it("is read as the envelope it was meant as", () => {
    expect(got(extractJson(trailing))).toEqual({
      type: "artifact",
      sections: { Summary: "done" },
      items: [1, 2],
    })
    expect(unparsedEnvelope(trailing)).toBeUndefined()
  })

  it("leaves a comma inside a string alone", () => {
    const text = '{ "type": "artifact", "note": "a, }", "quoted": "\\", ]", }'
    expect(got(extractJson(text))).toEqual({ type: "artifact", note: "a, }", quoted: '", ]' })
  })
})

describe("an envelope that does not parse", () => {
  it.each([
    ["a json fence", '```json\n{ "sections": { "a": "x" "b": "y" } }\n```'],
    ["a fence of another tag opening with a type key", '```\n{ "type": "artifact" "x": 1 }\n```'],
    ["a bare block opening with a type key", 'Filed:\n{ "type": "artifact", "x": tru }'],
    ["an indented bare block", 'Filed:\n\n  {\n    "type": "artifact", "x": tru }'],
  ])("reports the parser's complaint for %s", (_label, text) => {
    expect(unparsedEnvelope(text)).toMatch(/JSON/)
  })

  it("names the position the parser stopped at", () => {
    expect(unparsedEnvelope('```json\n{ "type": "artifact" "x": 1 }\n```')).toMatch(
      /at position 21/,
    )
  })

  it.each([
    ["plain prose", "Sure, I've added the flag and updated the tests."],
    ["prose with braces", "I edited {main.ts} and the else { } branch."],
    [
      "prose quoting an envelope inline",
      'It was not read because the envelope `{ "type": "artifact", "sections": { … } }` had a trailing comma.',
    ],
    [
      "prose describing the shape",
      'Your reply should look like {"type": "artifact", ...} at the end.',
    ],
    [
      "a line ending in an inline code span",
      'The last line of a reply is the envelope, `{"type": "artifact", …}`',
    ],
    ["a non-json fence that does not parse", "```ts\nconst x = { a: 1 }\n```"],
    [
      "a broken example before a valid envelope",
      `\`\`\`json\n{ "type": \n\`\`\`\n\n${fence(wanted)}`,
    ],
  ])("says nothing for %s", (_label, text) => {
    expect(unparsedEnvelope(text)).toBeUndefined()
  })
})
