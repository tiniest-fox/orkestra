import { describe, expect, it } from "vitest"
import { Either, Schema } from "effect"
import { noUsage } from "../../agent/types/usage.js"
import { Event, Events, stamped, versioned } from "./event.js"
import { replayHistory } from "./replay.js"
import { TrakId, UserId } from "./trak.js"

const decode = Schema.decodeUnknownEither(Event)
const encode = Schema.encodeEither(Event)

const AT = 1_700_000_000_000

describe("the persisted event", () => {
  it("reads a line written before there were times or costs", () => {
    // The whole reason both fields are optional. A trak that ran before the engine
    // had a clock still replays, and the record says nothing about how long it took
    // rather than saying zero.
    expect(decode({ _tag: "WorkCommitted" })).toStrictEqual(
      Either.right(Events.workCommitted(undefined)),
    )
    expect(Either.isRight(decode({ _tag: "WorktreeFailed", reason: "no space left" }))).toBe(true)
  })

  it("reads a child born before it carried its parent's artifacts", () => {
    // A shape added to `TrakCreated` is a shape every stored trak has to keep
    // round-tripping, and the children already in a database were born without
    // this one.
    const old = {
      _tag: "TrakCreated",
      description: "review it for security",
      plan: { type: "proposal", title: "Security", steps: [{ agent: "review", instruction: "x" }] },
    }
    expect(Either.isRight(decode(old))).toBe(true)
  })

  it("reads a child born before it was told what it was split from", () => {
    // Every child already in a database was born without the partition, and one that
    // does not decode is one nobody can pick up again. Absent means *nobody split
    // this*, which is also what an ordinary trak's log says.
    const old = {
      _tag: "TrakCreated",
      description: "review it for security",
      parent: { id: "t1", step: 2, child: 1, depth: 1 },
      plan: { type: "proposal", title: "Security", steps: [{ agent: "review", instruction: "x" }] },
    }
    expect(Either.isRight(decode(old))).toBe(true)
  })

  it("reads a trak created before anyone could say how much of it to stand at", () => {
    // Every stored trak stopped at every gate, so absent has to keep decoding — and
    // `replayHistory` is where it becomes `manual`. A decode that required the field
    // would take the whole database with it.
    const old = { _tag: "TrakCreated", description: "add a --json flag" }
    expect(Either.isRight(decode(old))).toBe(true)
    expect(Events.trakCreated("add a --json flag")).toMatchObject({ mode: "manual" })
  })

  it("reads a trak created before it could belong to anyone, and replays it to nobody's", () => {
    // Every trak before host users existed was born with no owner, and absent is the same
    // answer a press with no user still gives — so neither writes the key at all.
    const old = { _tag: "TrakCreated", description: "add a --json flag" }
    expect(Either.isRight(decode(old))).toBe(true)
    expect(Events.trakCreated("add a --json flag")).not.toHaveProperty("owner")
    const id = TrakId.make("t1")
    expect(replayHistory(id, [Schema.decodeUnknownSync(Event)(old)]).owner).toBeUndefined()
    const owned = Events.trakCreated("add it", undefined, "manual", false, UserId.make("gh:1"))
    expect(replayHistory(id, [owned]).owner).toBe("gh:1")
    // An owner is an id, and an empty one is no id.
    expect(Either.isLeft(decode({ ...old, owner: "" }))).toBe(true)
  })

  it("replays an OwnerChanged to the new owner, and moves nothing", () => {
    const id = TrakId.make("t1")
    const [alice, bob] = [UserId.make("gh:1"), UserId.make("gh:2")]
    const born = replayHistory(id, [
      Events.trakCreated("add it", undefined, "manual", false, alice),
    ])
    const taken = replayHistory(id, [
      Events.trakCreated("add it", undefined, "manual", false, alice),
      Events.ownerChanged(alice, bob),
    ])
    expect(taken.owner).toBe(bob)
    expect(taken.state).toEqual(born.state)
    expect(Events.ownerChanged(undefined, bob)).not.toHaveProperty("from")
  })

  it("reads a turn that filed before anything asked what it ran into", () => {
    // The other half of *required at the turn, tolerated on the log*. `StepOutputFor`
    // and `ComposerOutputFor` re-prompt a live agent that omits `ambiguity`; the stored
    // schemas stay permissive because `decodeEvent` reads every trak in the database
    // through them, and a required key here would stop all of them replaying — this
    // trak included. Absent reads as the lowest rung, via `ambiguityOf`.
    const filed = {
      _tag: "AgentReturned",
      step: 1,
      sessionId: "00000000-0000-4000-8000-000000000001",
      output: { type: "artifact", sections: { Summary: "built it" } },
    }
    expect(Either.isRight(decode(filed))).toBe(true)
    const planned = {
      _tag: "ComposerReturned",
      sessionId: "00000000-0000-4000-8000-000000000002",
      output: {
        type: "proposal",
        title: "Add a --json flag",
        steps: [{ agent: "build", instruction: "do it" }],
      },
    }
    expect(Either.isRight(decode(planned))).toBe(true)
  })

  it("stamps without disturbing anything else, and survives the round trip", () => {
    const e = Events.turnFailed(2, undefined, "connection closed mid-response")
    expect(stamped(e, AT)).toStrictEqual({ ...e, at: AT })
    expect(Either.flatMap(encode(stamped(e, AT)), decode)).toStrictEqual(
      Either.right(stamped(e, AT)),
    )
  })

  it("leaves both fields off entirely rather than present and undefined", () => {
    // `exactOptionalPropertyTypes` makes absent and undefined different values, and
    // the log is where the difference shows: a key written as `null` is a line no
    // future decode can tell from a real reading.
    const unmetered = Events.turnFailed(0, undefined, "usage limit reached")
    expect("usage" in unmetered).toBe(false)
    expect("at" in unmetered).toBe(false)
    expect(Events.turnFailed(0, undefined, "x", noUsage)).toMatchObject({ usage: noUsage })
  })

  it("names the engine on the three turn events, keeps the first, and leaves the rest alone", () => {
    // The turn events decoded above were written before this field, which is why it
    // is optional; this is the other half — what the append adds from now on.
    const failed = Events.turnFailed(2, undefined, "connection closed mid-response")
    expect(versioned(failed, "1.2.0")).toStrictEqual({ ...failed, engineVersion: "1.2.0" })
    expect(versioned(versioned(failed, "1.2.0"), "1.3.0")).toMatchObject({ engineVersion: "1.2.0" })
    expect(Either.flatMap(encode(versioned(failed, "1.2.0")), decode)).toStrictEqual(
      Either.right(versioned(failed, "1.2.0")),
    )
    const committed = Events.workCommitted(undefined)
    expect(versioned(committed, "1.2.0")).toBe(committed)
  })
})
