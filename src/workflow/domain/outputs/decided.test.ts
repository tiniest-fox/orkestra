// One renderer over the accumulated list, which is what keeps `trak.md` and the
// record from disagreeing about what a decision looks like — the one field on an
// entry that decides whether filing it costs anything, and the two derived facts
// every later entry leans on: an entry's id, and what a re-run adds to the list.

import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  accumulated,
  Decided,
  decidedOf,
  decisionsText,
  identified,
  isUnplanned,
  Recorded,
  recorded,
  standing,
  supersededBy,
  supersededText,
} from "./decided.js"

const scope: Recorded = {
  text: "the admin view is out of scope for this trak",
  source: "stated",
  at: "0-discovery",
}
const responsive: Recorded = {
  text: '"responsive" means phone and desktop, not tablet',
  source: "assumed",
  at: "0-discovery",
}
const library: Recorded = {
  text: "we're staying on the current auth library",
  source: "stated",
  at: "2-build",
}

const accumulatedList: readonly Recorded[] = [scope, responsive, library]

describe("decisionsText", () => {
  it("marks every entry with who decided it and names it by its id, which nobody wrote down", () => {
    expect(decisionsText(identified(accumulatedList))).toBe(
      "- **stated** — the admin view is out of scope for this trak\n  *0-discovery.1*\n" +
        '- **assumed** — "responsive" means phone and desktop, not tablet\n  *0-discovery.2*\n' +
        "- **stated** — we're staying on the current auth library\n  *2-build.1*",
    )
  })

  it("renders nothing at all when nothing was decided, which is most turns", () => {
    // The heading is the caller's, and it is absent for the same reason: a line
    // every turn reads and nothing acts on is where boilerplate blindness starts.
    expect(decisionsText(identified([]))).toBe("")
  })

  it("trims the text, so an agent's trailing newline does not break the list", () => {
    expect(
      decisionsText(
        identified([{ text: "  drop the CSV export \n", source: "stated", at: "1-a" }]),
      ),
    ).toBe("- **stated** — drop the CSV export\n  *1-a.1*")
  })

  it("names what an entry supersedes beside its id", () => {
    // The text is the claim that is true now, and the reader deciding whether to
    // open the old document needs to know which one it is.
    const stale: Recorded = {
      text: "the parser lives under src/parse",
      source: "assumed",
      at: "2-build",
      supersedes: ["1-investigate"],
    }
    expect(decisionsText(identified([stale]))).toBe(
      "- **assumed** — the parser lives under src/parse\n  *2-build.1*, supersedes `1-investigate`",
    )
  })

  it("leaves out an entry a later one supersedes, and keeps every other id where it was", () => {
    // The replacing entry restates whatever of the old one still held — that is the
    // contract's rule for writing one — so the old one is read nowhere. The ids do
    // not move: the folded entry is still the second of its step's.
    const replaced: Recorded = {
      text: "the admin view is in after all, read-only",
      source: "stated",
      at: "2-build",
      supersedes: ["0-discovery.1"],
    }
    expect(decisionsText(identified([scope, responsive, replaced]))).toBe(
      '- **assumed** — "responsive" means phone and desktop, not tablet\n  *0-discovery.2*\n' +
        "- **stated** — the admin view is in after all, read-only\n  *2-build.1*, supersedes `0-discovery.1`",
    )
  })
})

describe("identified and standing", () => {
  it("numbers each entry among its step's, from one, over the whole list", () => {
    expect(identified(accumulatedList).map((d) => d.id)).toEqual([
      "0-discovery.1",
      "0-discovery.2",
      "2-build.1",
    ])
  })

  it("folds by id only, so a name that is a document or is not on the list folds nothing", () => {
    const stale: Recorded = {
      text: "not so",
      source: "assumed",
      at: "1-b",
      supersedes: ["0-discovery", "9-nowhere.1"],
    }
    expect(standing(identified([scope, stale])).map((d) => d.id)).toEqual([
      "0-discovery.1",
      "1-b.1",
    ])
  })
})

describe("accumulated", () => {
  const first = [scope, responsive]

  it("adds what a later attempt filed that the list does not hold, in the order filed", () => {
    // A re-run after a failing check files its whole list again: the two it
    // restates are already there, and the one it adds goes on the end.
    const again: Recorded = {
      text: "no tablet layout at all",
      source: "assumed",
      at: "0-discovery",
    }
    expect(accumulated(first, [responsive, again, scope])).toEqual([scope, responsive, again])
  })

  it("keeps what an earlier attempt filed and the later one does not restate", () => {
    // Last-attempt-wins deleted a live constraint on a trak in the store; the union
    // does not.
    expect(accumulated(first, [scope])).toBe(first)
  })

  it("matches on the whole entry, not the text", () => {
    // A restatement that changed its mind about who decided it, or what it
    // replaces, is a second entry: only an exact repeat is the same one.
    const stated: Recorded = { ...responsive, source: "stated" }
    const replacing: Recorded = { ...responsive, supersedes: ["0-discovery.1"] }
    expect(accumulated(first, [stated, replacing])).toEqual([...first, stated, replacing])
  })

  it("does not fold across steps", () => {
    // Two steps agreeing verbatim is two steps agreeing; only a position's own
    // attempts are one filing.
    const echoed: Recorded = { ...scope, at: "3-review" }
    expect(accumulated(first, [echoed])).toEqual([...first, echoed])
  })
})

describe("the kind on an entry", () => {
  const decode = Schema.decodeUnknownSync(Decided)

  it("decodes an entry that carries none, which is every one filed before it existed", () => {
    expect(decode({ text: "x", source: "stated" }).kind).toBeUndefined()
  })

  it("takes the four and refuses anything else, so a near-miss is re-prompted", () => {
    const kinds = ["out_of_scope", "unplanned_work", "constraint", "ruled_out"] as const
    expect(kinds.map((kind) => decode({ text: "x", source: "stated", kind }).kind)).toEqual([
      ...kinds,
    ])
    // `deferred` is the one an agent reaches for: the contract folds it into
    // `out_of_scope`, and a word it does not name must fail loudly.
    expect(() => decode({ text: "x", source: "stated", kind: "deferred" })).toThrow(/kind/)
  })

  it("answers *is this work nobody has planned* on one of them, and absent is not it", () => {
    // Absent reads as no rather than as the cautious yes: routing it would spend a
    // planning turn on every stored entry, which is the whole of what this stops.
    expect(isUnplanned({ text: "x", source: "stated", kind: "unplanned_work" })).toBe(true)
    expect(isUnplanned({ text: "x", source: "stated", kind: "constraint" })).toBe(false)
    expect(isUnplanned({ text: "x", source: "stated" })).toBe(false)
  })

  it("is not on the accumulated shape at all, because it is spent once it has routed", () => {
    // Excess keys are dropped rather than refused, so what this pins is the shape:
    // by the time a later step reads this list the composer has planned the work.
    const stamped = Schema.decodeUnknownSync(Recorded)({
      text: "x",
      source: "stated",
      at: "1-build",
      kind: "unplanned_work",
    })
    expect(stamped).not.toHaveProperty("kind")
  })
})

describe("what an entry supersedes", () => {
  const decode = Schema.decodeUnknownSync(Decided)

  it("is a list of names beside any kind, so replacing a document can still wake the composer", () => {
    const both = decode({
      text: "x",
      source: "assumed",
      kind: "unplanned_work",
      supersedes: ["1-a", "1-a.2"],
    })
    expect(supersededBy(both)).toEqual(["1-a", "1-a.2"])
    expect(isUnplanned(both)).toBe(true)
    expect(supersededBy(decode({ text: "x", source: "stated", kind: "constraint" }))).toEqual([])
  })

  it("still takes the kind it used to be, with the one document beside it", () => {
    // Every envelope filed before the field existed wrote this shape, and the
    // examples an agent has seen still show it: refusing it would cost a turn.
    const legacy = decode({ text: "x", source: "assumed", kind: "supersedes", document: "1-a" })
    expect(supersededBy(legacy)).toEqual(["1-a"])
    expect(isUnplanned(legacy)).toBe(false)
  })

  it("refuses the kind naming nothing, and an empty list, since either replaces nothing", () => {
    expect(() => decode({ text: "x", source: "assumed", kind: "supersedes" })).toThrow(
      /names nothing/,
    )
    expect(() => decode({ text: "x", source: "assumed", supersedes: [] })).toThrow(/supersedes/)
  })

  it("stamps onto the accumulated shape as the one list, whatever shape it arrived in", () => {
    const stale: Decided = { text: "x", source: "assumed", kind: "supersedes", document: "1-a" }
    expect(recorded(stale, "2-b", supersededBy(stale))).toEqual({
      text: "x",
      source: "assumed",
      at: "2-b",
      supersedes: ["1-a"],
    })
    expect(recorded({ text: "y", source: "stated", kind: "constraint" }, "2-b", [])).toEqual({
      text: "y",
      source: "stated",
      at: "2-b",
    })
  })

  it("reads a stored entry that named its document the old way as the same list", () => {
    // `TrakCreated` on every child spawned before the field existed holds this
    // shape, and the note it carries has to keep landing on the file.
    const stored = Schema.decodeUnknownSync(Recorded)({
      text: "x",
      source: "assumed",
      at: "2-b",
      document: "1-a",
    })
    expect(stored).toEqual({ text: "x", source: "assumed", at: "2-b", supersedes: ["1-a"] })
    expect(Schema.encodeSync(Recorded)(stored)).toEqual(stored)
  })

  it("comes back as an entry that supersedes when a stamped entry is written out again", () => {
    // What a child's decisions become on the event that lands them: `Recorded` is
    // assignable to `Decided` as it stands, and that assignment would carry `at`
    // onto the wire as an excess key.
    expect(decidedOf({ text: "x", source: "assumed", at: "2-b", supersedes: ["1-a"] })).toEqual({
      text: "x",
      source: "assumed",
      supersedes: ["1-a"],
    })
    expect(decidedOf({ text: "y", source: "stated", at: "2-b" })).toEqual({
      text: "y",
      source: "stated",
    })
  })
})

describe("supersededText", () => {
  it("is one blockquote per entry, naming the entry that filed it, and nothing when there are none", () => {
    expect(supersededText([])).toBe("")
    expect(
      supersededText(
        identified([
          {
            text: "the parser lives under src/parse\n",
            source: "assumed",
            at: "2-build",
            supersedes: ["1-a"],
          },
          { text: "and it has no lexer", source: "stated", at: "3-review", supersedes: ["1-a"] },
        ]),
      ),
    ).toBe(
      "> **Superseded by `2-build.1`** — the parser lives under src/parse\n\n" +
        "> **Superseded by `3-review.1`** — and it has no lexer",
    )
  })
})
