// Pure tier: what the trak looks like as files, with no filesystem in sight.

import { describe, expect, it } from "vitest"
import { artifact } from "./outputs/artifact.js"
import { proposal } from "./outputs/proposal.js"
import {
  handedDecisions,
  inheritedDecisions,
  pieceOn,
  projection,
  supersedable,
  visibleArtifacts,
} from "./projection.js"
import { emptyTrak, TrakId } from "./trak.js"

const trak = { ...emptyTrak(TrakId.make("t1")), description: "Add a --json flag" }

const planned = {
  ...trak,
  plan: proposal("A JSON flag for the list command", [
    { agent: "discovery", instruction: "Plan it." },
    { agent: "build", instruction: "Do it." },
    { agent: "review", instruction: "Review it." },
  ]),
  artifacts: new Map([
    ["0-discovery", artifact({ Summary: "what we found" })],
    ["1-build", artifact({ Summary: "what changed" })],
    ["2-review", artifact({ Summary: "would not ship it" })],
  ]),
}

describe("trak.md", () => {
  it("carries the request before there is a title, and the title once there is", () => {
    // The composer's own turn reads a titleless one, correctly: it is about to
    // write that line.
    expect(projection(trak, undefined).get("trak.md")).toBe(
      "## How this work was asked for\n\nAdd a --json flag\n",
    )
    expect(projection(planned, undefined).get("trak.md")).toContain(
      "# A JSON flag for the list command",
    )
  })

  it("is there on every turn, including the first, when nothing else is", () => {
    expect([...projection(trak, 0).keys()]).toEqual(["trak.md"])
  })

  it("gains the requirements so far, in order, with the stage that recorded each", () => {
    // The request plus these IS the current intent, which is the whole reason
    // this file is more than a copy of what was typed.
    const decided = {
      ...trak,
      decisions: [
        { text: "the admin view is out of scope", source: "stated", at: "0-discovery" },
        { text: '"responsive" means phone and desktop', source: "assumed", at: "0-discovery" },
      ],
    } as const
    expect(projection(decided, undefined).get("trak.md")).toBe(
      "## How this work was asked for\n\nAdd a --json flag\n\n## Requirements\n\n" +
        "- **stated** — the admin view is out of scope\n  *0-discovery.1*\n" +
        '- **assumed** — "responsive" means phone and desktop\n  *0-discovery.2*\n',
    )
  })

  it("has no heading at all when nothing has been decided", () => {
    // Not "No decisions." — a line every turn reads and nothing acts on is where
    // boilerplate blindness starts, and its absence says the same thing.
    expect(projection(trak, undefined).get("trak.md")).not.toContain("Decisions")
  })
})

describe("the pieces a child was split from", () => {
  const halves = [
    { name: "1.0-build", instruction: "Move the engine half." },
    { name: "1.1-build", instruction: "Move the client half." },
  ] as const
  // The second of two, which is what makes the marker mean anything: every child of
  // one spawn holds the identical list, and `parent.child` is what picks the row.
  const piece = {
    ...emptyTrak(TrakId.make("t4")),
    description: "Port the routes",
    parent: { id: TrakId.make("t1"), step: 1, child: 1, depth: 1 },
    split: { instruction: "Two halves, and neither reads the other's output.", pieces: halves },
  } as const

  it("names each piece and what it was asked to do, with this trak's own marked", () => {
    expect(projection(piece, 0).get("trak.md")).toBe(
      "## How this work was asked for\n\nPort the routes\n\n## The pieces this was split into\n\n" +
        "Two halves, and neither reads the other's output.\n\n" +
        "- 1.0-build — Move the engine half.\n" +
        "- 1.1-build — Move the client half.  ← THIS PIECE\n",
    )
  })

  it("sits with the request, above the requirements", () => {
    // A child's request is the parent's whole request, so the partition is what says
    // which part of it is this trak's — read with it rather than after everything.
    const decided = {
      ...piece,
      decisions: [{ text: "per key, not per IP", source: "stated", at: "0-work" }],
    } as const
    const out = projection(decided, 0).get("trak.md") ?? ""
    expect(out.indexOf("## The pieces")).toBeGreaterThan(
      out.indexOf("## How this work was asked for"),
    )
    expect(out.indexOf("## The pieces")).toBeLessThan(out.indexOf("## Requirements"))
  })

  it("says nothing at all for a spawn of one, or for a trak nobody split", () => {
    // A roster naming nobody is where boilerplate blindness starts, and the rule in
    // the prompts is guarded on the same question.
    const alone = { ...piece, split: { ...piece.split, pieces: [halves[0]] } } as const
    expect(projection(alone, 0).get("trak.md")).not.toContain("## The pieces")
    expect(projection(trak, undefined).get("trak.md")).not.toContain("## The pieces")
  })
})

describe("one file per artifact", () => {
  it("names each after the key the engine assigned it", () => {
    expect([...projection(planned, undefined).keys()]).toEqual([
      "trak.md",
      "0-discovery.md",
      "1-build.md",
      "2-review.md",
    ])
  })

  it("writes the document as headed markdown, the same rendering a prompt uses", () => {
    expect(projection(planned, undefined).get("1-build.md")).toBe("## Summary\n\nwhat changed\n")
  })
})

describe("a document something later supersedes", () => {
  // Filed by the build step, about the discovery document it read: the file is never
  // edited, and this is how a reader who opens it meets the claim that is true now.
  const stale = {
    ...planned,
    decisions: [
      {
        text: "the flag is on `list` only, not on every command",
        source: "assumed",
        at: "1-build",
        supersedes: ["0-discovery"],
      },
      { text: "per key, not per IP", source: "stated", at: "1-build" },
    ],
  } as const

  it("opens with the claim and the entry that filed it, above the first section", () => {
    expect(projection(stale, undefined).get("0-discovery.md")).toBe(
      "> **Superseded by `1-build.1`** — the flag is on `list` only, not on every command\n\n" +
        "## Summary\n\nwhat we found\n",
    )
  })

  it("leaves every other document as it was filed", () => {
    expect(projection(stale, undefined).get("1-build.md")).toBe("## Summary\n\nwhat changed\n")
  })

  it("still lists the entry in trak.md, naming the document, for a reader who never opens it", () => {
    expect(projection(stale, undefined).get("trak.md")).toContain(
      "- **assumed** — the flag is on `list` only, not on every command\n  *1-build.1*, supersedes `0-discovery`\n",
    )
  })

  it("annotates an inherited document under the name the step was shown it by", () => {
    const child = {
      ...emptyTrak(TrakId.make("t5")),
      plan: proposal("One piece", [{ agent: "build", instruction: "Build it." }]),
      inherited: [["0-discovery", artifact({ Summary: "what we found" })]],
      decisions: [
        {
          text: "not so",
          source: "assumed",
          at: "0-build",
          supersedes: ["from-parent/0-discovery"],
        },
      ],
    } as const
    expect(projection(child, undefined).get("from-parent/0-discovery.md")).toBe(
      "> **Superseded by `0-build.1`** — not so\n\n## Summary\n\nwhat we found\n",
    )
  })
})

describe("a parent's supersedes, as a child is born holding it", () => {
  it("names a document by the key the child files it under, a requirement by its unchanged id", () => {
    // The child holds the whole list in the parent's order, so an inherited entry's
    // id is the same on both traks — and a document key can end in a number too,
    // which is why the list and not the shape decides.
    const list = [
      { text: "per key", source: "stated", at: "2-build" },
      { text: "not so", source: "assumed", at: "2-build", supersedes: ["1-spec", "2-build.1"] },
    ] as const
    expect(inheritedDecisions(list)).toEqual([
      list[0],
      { ...list[1], supersedes: ["from-parent/1-spec", "2-build.1"] },
    ])
  })
})

describe("a child's own decisions, as its parent will record them", () => {
  // Born holding one entry; its own step 0 filed one, which landed; sent back, it
  // filed two more — the second replacing both the one beside it and the one that
  // landed, by the ids the child's own `trak.md` gave them.
  const child = {
    ...emptyTrak(TrakId.make("t6")),
    plan: proposal("One piece", [{ agent: "build", instruction: "Build it." }]),
    decisions: [
      { text: "per key", source: "stated", at: "1-work" },
      { text: "a first cut", source: "assumed", at: "0-build" },
      { text: "a second cut", source: "assumed", at: "0-build" },
      {
        text: "the cut that stands",
        source: "assumed",
        at: "0-build",
        supersedes: ["0-build.2", "0-build.1", "1-work.1"],
      },
    ],
  } as const
  const spawn = {
    ...planned,
    plan: proposal("Add a flag", [
      { agent: "discovery", instruction: "Look." },
      { agent: "work", instruction: "Do." },
      {
        type: "spawn",
        instruction: "One piece.",
        children: [{ agent: "build", instruction: "Build it." }],
      },
    ]),
    // What the parent has recorded at the piece key plays no part: the child's
    // first own entry is `2.0-build.1` whether or not it has landed yet.
    decisions: [{ text: "held already", source: "stated", at: "2.0-build" }],
  } as const

  it("numbers every own entry by its place among them, landed or not, and leaves the rest", () => {
    // Case 1: the refiled entry names the one refiled beside it — the second own
    // entry, so `.2`. Case 2: it names the one that landed already — the first, so
    // `.1`. Numbering the slice going up would give `.1` and `0-build.1` instead,
    // and the second folds whatever the parent calls by that name.
    const piece = pieceOn(spawn, { step: 2, child: 0 })
    expect(piece).toBe("2.0-build")
    expect(handedDecisions(child, 1, 2, piece)).toEqual([
      { text: "a second cut", source: "assumed" },
      {
        text: "the cut that stands",
        source: "assumed",
        supersedes: ["2.0-build.2", "2.0-build.1", "1-work.1"],
      },
    ])
    // The landing itself: everything own, from the first.
    expect(handedDecisions(child, 1, 1, piece).map((d) => d.text)).toEqual([
      "a first cut",
      "a second cut",
      "the cut that stands",
    ])
  })

  it("sends the names as written when the parent's plan no longer holds the spawn", () => {
    expect(pieceOn(planned, { step: 2, child: 0 })).toBeUndefined()
    expect(handedDecisions(child, 1, 2, undefined).at(1)).toEqual({
      text: "the cut that stands",
      source: "assumed",
      supersedes: ["0-build.2", "0-build.1", "1-work.1"],
    })
  })
})

describe("the names a supersedes may use at a position", () => {
  it("is every document the step can open, inherited ones under their listed name, and every requirement's id", () => {
    const child = {
      ...planned,
      inherited: [["0-spec", artifact({ Summary: "the spec" })]],
      decisions: [
        { text: "per key", source: "stated", at: "0-discovery" },
        {
          text: "and it holds",
          source: "stated",
          at: "0-discovery",
          supersedes: ["0-discovery.1"],
        },
      ],
    } as const
    expect(supersedable(child, 2)).toEqual([
      "from-parent/0-spec",
      "0-discovery",
      "1-build",
      "0-discovery.1",
      "0-discovery.2",
    ])
    expect(supersedable(planned, 0)).toEqual([])
  })
})

describe("what a child was born holding", () => {
  // One piece of a spawn: its own plan is one step, and the documents behind the
  // decision to split are the parent's.
  const child = {
    ...emptyTrak(TrakId.make("t2")),
    description: "Add a --json flag",
    plan: proposal("The footer components", [{ agent: "build", instruction: "Build it." }]),
    inherited: [
      ["0-discovery", artifact({ Summary: "what we found" })],
      ["1-breakdown", artifact({ Summary: "three pieces" })],
    ],
  } as const

  it("lands under its own directory, keyed as the parent filed it", () => {
    expect([...projection(child, 0).keys()]).toEqual([
      "trak.md",
      "from-parent/0-discovery.md",
      "from-parent/1-breakdown.md",
    ])
  })

  it("does not collide with a document this trak files under the same key", () => {
    // The worked example spawn was built for: four `review` lenses off a parent
    // whose own step 0 was `review`. Both are `0-review`, and at the top level one
    // would silently replace the other.
    const lens = {
      ...emptyTrak(TrakId.make("t3")),
      plan: proposal("Security", [{ agent: "review", instruction: "Security." }]),
      artifacts: new Map([["0-review", artifact({ Summary: "no injection" })]]),
      inherited: [["0-review", artifact({ Summary: "the parent's review" })]],
    } as const
    expect([...projection(lens, undefined).keys()]).toEqual([
      "trak.md",
      "from-parent/0-review.md",
      "0-review.md",
    ])
    expect(projection(lens, undefined).get("0-review.md")).toContain("no injection")
    expect(projection(lens, undefined).get("from-parent/0-review.md")).toContain(
      "the parent's review",
    )
  })

  it("is not filtered by position, unlike everything this trak filed itself", () => {
    // They were complete before this trak existed, so there is no position of its
    // own they could be before or after — the composer and every step see the set.
    expect([...projection(child, undefined).keys()]).toEqual([...projection(child, 0).keys()])
  })
})

describe("what a step at a position may see", () => {
  it("is everything filed before it, in plan order", () => {
    expect(visibleArtifacts(planned, 2).map(([k]) => k)).toEqual(["0-discovery", "1-build"])
  })

  it("leaves out what was filed after the step being re-run", () => {
    // The rejection case. `2-review` sent the work back to `1-build`, so the
    // review was written against a document that is about to be replaced —
    // harmless history in the log, and a trap in a directory an agent browses.
    expect(visibleArtifacts(planned, 1).map(([k]) => k)).toEqual(["0-discovery"])
    expect([...projection(planned, 1).keys()]).toEqual(["trak.md", "0-discovery.md"])
  })

  it("shows the composer everything, because it has no position", () => {
    expect(visibleArtifacts(planned, undefined)).toHaveLength(3)
  })

  it("skips a planned step that has not produced anything", () => {
    const gap = { ...planned, artifacts: new Map([["2-review", artifact({ Summary: "ok" })]]) }
    expect(visibleArtifacts(gap, 3).map(([k]) => k)).toEqual(["2-review"])
  })
})

describe("what a fan-out of mixed depth files", () => {
  // Three pieces, written three ways: a piece of two steps, a piece of one written
  // as a list, and a piece written as the bare pair a log from before this holds.
  const fanned = {
    ...trak,
    plan: proposal("Port the routes", [
      { agent: "discovery", instruction: "Plan it." },
      {
        type: "spawn",
        instruction: "Three parts, each checked.",
        children: [
          {
            steps: [
              { agent: "build", instruction: "Move /events." },
              { agent: "review", instruction: "Read the moved route." },
            ],
          },
          { steps: [{ agent: "build", instruction: "Move /traks." }] },
          { agent: "review", instruction: "Read the client." },
        ],
      },
    ]),
    artifacts: new Map([
      ["0-discovery", artifact({ Summary: "what we found" })],
      // As the join files them: under the piece's name, by the child's own key, in
      // the child's plan order — and the second piece's out of plan order here, to
      // show the plan and not the map is what orders them.
      ["1.2-review/0-review", artifact({ Summary: "the client piece" })],
      ["1.0-review/0-build", artifact({ Summary: "the events piece" })],
      ["1.0-review/1-review", artifact({ Summary: "the events piece, reviewed" })],
      ["1.1-build/0-build", artifact({ Summary: "the traks piece" })],
    ]),
  }

  it("names each piece after its last step, and every document it filed under that", () => {
    // `1.0-review` is the two-step piece, named for the step it ends on, and both
    // of its documents are there — the earlier one is how the later was reached.
    expect(visibleArtifacts(fanned, undefined).map(([k]) => k)).toEqual([
      "0-discovery",
      "1.0-review/0-build",
      "1.0-review/1-review",
      "1.1-build/0-build",
      "1.2-review/0-review",
    ])
  })

  it("gives the step after the fan-out a directory per piece, a one-step piece included", () => {
    // One layout whatever the piece's depth, so a reader never counts steps to
    // know where a piece's document is. The flat `1.1-build.md` is a name nothing
    // files any more.
    const files = [...projection(fanned, 2).keys()]
    expect(files).toEqual([
      "trak.md",
      "0-discovery.md",
      "1.0-review/0-build.md",
      "1.0-review/1-review.md",
      "1.1-build/0-build.md",
      "1.2-review/0-review.md",
    ])
    expect(files).not.toContain("1.1-build.md")
  })
})
