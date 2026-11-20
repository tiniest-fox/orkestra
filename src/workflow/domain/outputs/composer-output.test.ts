// The composer names one registry by hand, and a name it invented is caught here
// — at decode, where `elicit` re-prompts with the reason — rather than at spawn,
// where the proposal has already been committed and the trak is stranded.

import { Either, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { Ambiguity } from "./ambiguity.js"
import { type AfterMerge, ComposerOutputFor, noMerge } from "./composer-output.js"
import { isConversational, type Step, waitUntilOf } from "./proposal.js"

const AGENTS = new Set(["build", "review"])

const step = (agent: string): Record<string, unknown> => ({ agent, instruction: "do it" })

/** A spawn of one-step pieces, each written as the list of steps it is. */
const spawn = (...agents: readonly string[]): Record<string, unknown> => ({
  type: "spawn",
  instruction: "do these at once",
  children: agents.map((agent) => ({ steps: [{ agent, instruction: `do ${agent}` }] })),
})

/** The same, written the way a log from before a piece could hold a plan wrote it. */
const bareSpawn = (...agents: readonly string[]): Record<string, unknown> => ({
  type: "spawn",
  instruction: "do these at once",
  children: agents.map((agent) => ({ agent, instruction: `do ${agent}` })),
})

/** One piece, several steps — a piece that does its work and then reviews it. */
const piecesOf = (...agents: readonly string[]): Record<string, unknown> => ({
  type: "spawn",
  instruction: "do it and check it",
  children: [{ steps: agents.map((agent) => ({ agent, instruction: `do ${agent}` })) }],
})

/**
 * The decoded proposal, or the failure's message — so no assertion is conditional.
 *
 * `spawning` is the depth ceiling, and defaults to what a trak a human asked for
 * gets: a root may spawn, and only a child may not.
 */
const decode = (
  steps: readonly Record<string, unknown>[],
  spawning = true,
  after: AfterMerge = noMerge,
): unknown =>
  Either.match(
    Schema.decodeUnknownEither(ComposerOutputFor(AGENTS, spawning, !spawning, false, after))({
      type: "proposal",
      title: "Rate-limit the public API",
      ambiguity: "none",
      steps,
    }),
    { onLeft: (e) => e.message, onRight: (p) => p },
  )

/**
 * The single decoded step of a one-step proposal, typed.
 *
 * Throws rather than returning a message, unlike `decode`: every caller here is
 * asserting on a plan that decodes, so a failure is the test's own bug.
 */
const only = (s: Record<string, unknown>): Step => {
  const out = Schema.decodeUnknownSync(ComposerOutputFor(AGENTS, true, false, false, noMerge))({
    type: "proposal",
    title: "Rate-limit the public API",
    ambiguity: "none",
    steps: [s],
  })
  if (out.type !== "proposal") throw new Error(`decoded a ${out.type}, not a proposal`)
  return out.steps[0]
}

describe("the agent a step names", () => {
  it("accepts one the project declares", () => {
    expect(decode([step("build")])).toMatchObject({ type: "proposal" })
  })

  it("accepts the same agent twice — a plan that runs breakdown twice is ordinary", () => {
    expect(decode([step("review"), step("build"), step("review")])).toMatchObject({
      type: "proposal",
    })
  })

  it("refuses an invented name, and says what is available", () => {
    const reason = decode([step("build"), step("bulid")])
    expect(reason).toContain("unknown agent(s): bulid")
    expect(reason).toContain("Available: build, review")
    // Only the invented one is named — listing the valid one back would read as
    // a complaint about it.
    expect(reason).not.toContain("unknown agent(s): build,")
  })

  it("refuses `generic`, which the engine ships and no project's fleet holds", () => {
    // The set handed in is built from `.orkestra/agents/` alone, and the engine's own
    // agent is deliberately outside it — so this is what stops the composer placing a
    // role-less agent that may write. Adding `generic` to the set is the silent
    // mistake: nothing else would refuse the plan.
    expect(decode([step("generic")])).toContain("unknown agent(s): generic")
  })

  it("names a repeated mistake once, so a four-step plan re-prompts with one name", () => {
    const reason = decode([step("bulid"), step("bulid")])
    expect(reason).toContain("unknown agent(s): bulid.")
  })

  it("checks the agents inside a spawn too — they are committed by the same plan", () => {
    // The whole argument for narrowing here rather than at spawn time, applied
    // one level down: a name resolved when the child trak is created escapes
    // after the proposal is committed, and strands the parent.
    expect(decode([spawn("review", "bulid")])).toContain("unknown agent(s): bulid")
  })

  it("checks a piece's later steps, which approving the plan commits just as hard", () => {
    // A piece of two is two turns bought at one gate. A name only resolved when
    // the second came round would strand the child a gate in, with its first
    // step's work already done and merged nowhere.
    expect(decode([piecesOf("build", "reveiw")])).toContain("unknown agent(s): reveiw")
  })

  it("refuses a step naming a model — that field is New Chat's, and the composer is never told of it", () => {
    // The schema carries `model` so the door's pick survives the log, which means a
    // composer that wrote one would decode. Refused rather than dropped: dropped, the
    // plan would run on a model other than the one it says, with nothing reporting it.
    const reason = decode([step("build"), { ...step("review"), model: "haiku" }])
    expect(reason).toContain("`model` is not a field a plan entry takes")
    expect(decode([step("build"), step("review")])).toMatchObject({ type: "proposal" })
  })

  it("refuses a model on a step of a piece, which a spawn's own entry does not show", () => {
    const modelled = {
      type: "spawn",
      instruction: "do it and check it",
      children: [{ steps: [{ agent: "build", instruction: "do build", model: "haiku" }] }],
    }
    expect(decode([modelled])).toContain("`model` is not a field a plan entry takes")
  })
})

describe("a piece of a spawn", () => {
  it("takes a list of steps, which is how a piece reviews its own work", () => {
    expect(decode([piecesOf("build", "review")])).toMatchObject({
      steps: [
        {
          type: "spawn",
          children: [{ steps: [{ agent: "build" }, { agent: "review" }] }],
        },
      ],
    })
  })

  it("still reads the bare pair, so a log written before this replays unchanged", () => {
    // Decode-only. Nothing writes this arm now, and every fan-out already on disk
    // is written in it.
    expect(decode([bareSpawn("review", "build")])).toMatchObject({
      steps: [{ type: "spawn", children: [{ agent: "review" }, { agent: "build" }] }],
    })
  })

  it("refuses a piece with no steps at all — a piece that runs nothing is not a piece", () => {
    expect(
      decode([{ type: "spawn", instruction: "do these at once", children: [{ steps: [] }] }]),
    ).toContain("steps")
  })
})

describe("the depth ceiling", () => {
  it("accepts a spawn on a trak a human asked for", () => {
    expect(decode([spawn("review", "review")])).toMatchObject({ type: "proposal" })
  })

  it("refuses one on a trak that was itself spawned, and says what to do instead", () => {
    // Refused at decode so `elicit` re-prompts with the reason. A dumb constant,
    // deliberately: the real cost of this tier is human attention.
    expect(decode([spawn("review")], false)).toContain("may not spawn again")
  })

  it("still accepts ordinary steps on a child", () => {
    expect(decode([step("build"), step("review")], false)).toMatchObject({ type: "proposal" })
  })
})

describe("a compose entry — the composer scheduling its own next turn", () => {
  const stop = { type: "compose", instruction: "one service or two, once the discovery lands" }

  it("accepts one as the last entry, which is what a plan that stops short looks like", () => {
    expect(decode([step("build"), stop])).toMatchObject({
      steps: [{ agent: "build" }, { type: "compose", instruction: stop.instruction }],
    })
  })

  it("refuses one before the end — it says where you stop, so nothing follows it", () => {
    expect(decode([stop, step("build")])).toContain("a compose may only be the last entry")
  })

  it("refuses a plan that is nothing else, which would propose turns and never work", () => {
    expect(decode([stop])).toContain("a plan of nothing but a compose does no work")
  })

  it("names no agent, so the registry has nothing to object to", () => {
    // The one entry kind that commits to no agent. Left out of `agentsNamed` it would
    // have been read as a step, and `undefined` reported as an unknown agent name.
    expect(decode([step("build"), stop])).not.toContain("unknown agent")
  })
})

describe("`ambiguity`, what the compose run says it ran into", () => {
  /** The whole envelope, so this block can leave the field out — `decode` never can. */
  const proposed = (fields: Record<string, unknown>): unknown =>
    Either.match(
      Schema.decodeUnknownEither(ComposerOutputFor(AGENTS, true, false, false, noMerge))({
        type: "proposal",
        title: "Rate-limit the public API",
        steps: [step("build")],
        ...fields,
      }),
      { onLeft: (e) => e.message, onRight: (p) => p },
    )

  it("is required of a live turn, and the re-prompt names every rung", () => {
    // Required here and optional on `Proposal` itself, which is the split: a stored
    // log has to keep decoding, and this is where `elicit` can hand the reason back.
    const why = proposed({})
    expect(why).toContain(`no "ambiguity"`)
    for (const rung of Ambiguity.literals) expect(why).toContain(`"${rung}"`)
  })

  it("carries each rung it defines onto the proposal verbatim", () => {
    // Read off the schema, so a rung added without a decode path fails here.
    for (const rung of Ambiguity.literals)
      expect(proposed({ ambiguity: rung })).toMatchObject({ ambiguity: rung })
  })

  it("refuses a rung nobody defined, rather than dropping it as if nothing was said", () => {
    // Dropped, it would reach the gate as absent — which reads as the lowest rung, so
    // a typo would buy the passage the composer was trying to spend.
    expect(proposed({ ambiguity: "quite a bit" })).toContain("ambiguity")
  })

  it("is asked of the run and never of a step, which the composer has not done", () => {
    // A rung per entry would be the composer rating work nobody has started. Written
    // onto a step it is dropped at decode rather than reaching the plan.
    expect(only({ ...step("build"), ambiguity: "a_lot" })).not.toHaveProperty("ambiguity")
  })
})

describe("`conversational`, the one optional part of a step", () => {
  it("is absent from an ordinary plan, and `isConversational` reads that as no", () => {
    // Absent, not defaulted: a log written before the field existed replays
    // unchanged, and there is one function that turns absent into an answer.
    expect(only(step("build"))).toMatchObject({ agent: "build", instruction: "do it" })
    expect(isConversational(only(step("build")))).toBe(false)
  })

  it("is carried through when a plan asks for it", () => {
    expect(isConversational(only({ ...step("build"), conversational: true }))).toBe(true)
  })

  it("refuses anything that is not a boolean, rather than reading it as truthy", () => {
    // "yes" is what a model reaches for, and truthiness would take it silently.
    expect(decode([{ ...step("build"), conversational: "yes" }])).toContain("conversational")
  })
})

describe("`wait_until`, the time a step waits for", () => {
  it("is absent from an ordinary plan, and `waitUntilOf` reads that as none", () => {
    expect(waitUntilOf(only(step("build")))).toBeUndefined()
  })

  it("carries either spelling through verbatim — the engine resolves it, not the decode", () => {
    expect(waitUntilOf(only({ ...step("build"), wait_until: "2026-09-16T06" }))).toBe(
      "2026-09-16T06",
    )
    expect(waitUntilOf(only({ ...step("build"), wait_until: "PT90M" }))).toBe("PT90M")
  })

  it("refuses an instant below the hour, and says what it takes instead", () => {
    const reason = decode([{ ...step("build"), wait_until: "2026-09-16T06:30" }])
    expect(reason).toContain("wait_until")
    expect(reason).toContain("nothing finer")
  })

  it("refuses a time in words — the composer is told the clock, not asked to describe it", () => {
    expect(decode([{ ...step("build"), wait_until: "tomorrow morning" }])).toContain("wait_until")
  })
})

describe("a title is not optional", () => {
  it("refuses a proposal without one — nothing else names the work in a listing", () => {
    const out = Schema.decodeUnknownEither(ComposerOutputFor(AGENTS, true, false, false, noMerge))({
      type: "proposal",
      steps: [step("build")],
    })
    expect(Either.isLeft(out)).toBe(true)
  })
})

describe("what `finished` may hand up", () => {
  /** The decoded answer, or the failure's message. `child` is whether the trak has a parent. */
  const finish = (fields: Record<string, unknown>, child: boolean): unknown =>
    Either.match(
      Schema.decodeUnknownEither(ComposerOutputFor(AGENTS, !child, child, false, noMerge))({
        type: "finished",
        reason: "this piece is done",
        ...fields,
      }),
      { onLeft: (e) => e.message, onRight: (p) => p },
    )

  it("carries a hand-up on a child, which is the one trak with a parent to read it", () => {
    expect(finish({ handUp: "the schema needs cutting first" }, true)).toEqual({
      type: "finished",
      reason: "this piece is done",
      handUp: "the schema needs cutting first",
    })
  })

  it("refuses one on a trak with no parent, so the composer is re-prompted rather than heard by nobody", () => {
    expect(finish({ handUp: "the schema needs cutting first" }, false)).toContain("handUp")
  })

  it("passes a plain `finished` on either", () => {
    expect(finish({}, false)).toEqual({ type: "finished", reason: "this piece is done" })
    expect(finish({}, true)).toEqual({ type: "finished", reason: "this piece is done" })
  })
})

describe("what either answer may hand off", () => {
  /** A finish with a hand-off. `child` is whether the trak has a parent. */
  const finish = (fields: Record<string, unknown>, child: boolean): unknown =>
    Either.match(
      Schema.decodeUnknownEither(ComposerOutputFor(AGENTS, !child, child, false, noMerge))({
        type: "finished",
        reason: "the branch is in, and what is left belongs on main",
        ...fields,
      }),
      { onLeft: (e) => e.message, onRight: (p) => p },
    )
  /** A plan with a hand-off beside it, on the same terms. */
  const plan = (fields: Record<string, unknown>, child: boolean): unknown =>
    Either.match(
      Schema.decodeUnknownEither(ComposerOutputFor(AGENTS, !child, child, false, noMerge))({
        type: "proposal",
        title: "Rate-limit the public API",
        ambiguity: "none",
        steps: [step("build")],
        ...fields,
      }),
      { onLeft: (e) => e.message, onRight: (p) => p },
    )
  const off = ["Fix the deploy hook, which fires against the wrong host once this is live"]

  it("carries one on a trak with no parent, on the finish and on the plan alike", () => {
    expect(finish({ handOff: off }, false)).toMatchObject({ type: "finished", handOff: off })
    expect(plan({ handOff: off }, false)).toMatchObject({ type: "proposal", handOff: off })
  })

  it("carries several, each a trak of its own", () => {
    const three = [...off, "Give the condition waits a backoff", "Cache `origin/HEAD`"]
    expect(finish({ handOff: three }, false)).toMatchObject({ handOff: three })
  })

  it("refuses one on a child, whose branch goes back to its parent, and names the hand-up instead", () => {
    // A child's composer is never told the field exists, so one it wrote is a guess
    // — re-prompted with the answer that reaches the parent rather than dropped.
    expect(finish({ handOff: off }, true)).toContain("handUp")
    expect(plan({ handOff: off }, true)).toContain("handUp")
  })

  it("refuses an empty list — a key with nothing in it is left off", () => {
    expect(finish({ handOff: [] }, false)).toContain("handOff")
  })

  it("passes a plan with none through unchanged", () => {
    expect(plan({}, false)).not.toHaveProperty("handOff")
  })
})

describe("what a finish may propose as a goal", () => {
  /** A finish with `fields`, on a trak with a parent, in a goal, or neither. */
  const finish = (fields: Record<string, unknown>, on: "top" | "child" | "inGoal"): unknown =>
    Either.match(
      Schema.decodeUnknownEither(
        ComposerOutputFor(AGENTS, on !== "child", on === "child", on === "inGoal", noMerge),
      )({ type: "finished", reason: "the approach is settled", ...fields }),
      { onLeft: (e) => e.message, onRight: (p) => p },
    )
  const goal = "Rebuild the importer around streaming.\n\nSettled: one pass, no temp files."

  it("carries one on a top-level trak outside any goal", () => {
    expect(finish({ goal }, "top")).toEqual({
      type: "finished",
      reason: "the approach is settled",
      goal,
    })
  })

  it("refuses one on a child, naming the hand-up that reaches its parent", () => {
    expect(finish({ goal }, "child")).toContain("handUp")
  })

  it("refuses one on a goal's trak, naming the hand-off that reaches the goal's composer", () => {
    expect(finish({ goal }, "inGoal")).toContain("handOff")
  })

  it("refuses an empty one — a key with nothing in it is left off", () => {
    expect(typeof finish({ goal: "  " }, "top")).toBe("string")
  })

  it("passes a finish with none on a goal's trak", () => {
    expect(finish({}, "inGoal")).toEqual({ type: "finished", reason: "the approach is settled" })
  })
})

/**
 * `build` writes and `review` waits on the branch merging — the fleet a project with
 * a post-merge check has. The trak's own half, `landed`, is what each case varies.
 */
const merging = (landed: boolean): AfterMerge => ({
  landed,
  writes: new Set(["build"]),
  waits: new Set(["review"]),
  deploys: false,
})

describe("nothing writes to a branch after it has merged", () => {
  it("refuses a write agent anywhere in the plan once the trak has landed", () => {
    expect(decode([step("review"), step("build")], true, merging(true))).toContain(
      "`build` writes, and this trak's branch has merged",
    )
    expect(decode([spawn("build")], true, merging(true))).toContain("`build` writes")
  })

  it("accepts read-only work on a landed trak", () => {
    expect(decode([step("review")], true, merging(true))).toMatchObject({ type: "proposal" })
  })

  it("refuses a write agent placed after one that waits on the merge, before any merge", () => {
    // The plan is approved now and the step runs after the branch is in: refused at
    // decode, where the composer is told, rather than at the step, where the plan
    // has already been approved.
    expect(decode([step("build"), step("review"), step("build")], true, merging(false))).toContain(
      "`build` at step 3 writes, and it comes after `review`",
    )
    // A spawn is one position: a wait in any piece holds every position after it.
    expect(decode([spawn("review"), step("build")], true, merging(false))).toContain(
      "comes after `review`",
    )
    // And the steps inside one piece hold to the order they run in.
    expect(decode([piecesOf("review", "build")], true, merging(false))).toContain(
      "comes after `review`",
    )
  })

  it("refuses an agent that both waits and writes — the turn after the wait is the write", () => {
    const self: AfterMerge = {
      landed: false,
      writes: new Set(["build"]),
      waits: new Set(["build"]),
      deploys: false,
    }
    expect(decode([step("build")], true, self)).toContain("`build` at step 1 writes, and it waits")
  })

  it("accepts a write agent before the wait, and pieces that run beside one", () => {
    expect(decode([step("build"), step("review")], true, merging(false))).toMatchObject({
      type: "proposal",
    })
    // Two pieces of one spawn run at once, and neither is after the other.
    expect(decode([spawn("review", "build")], true, merging(false))).toMatchObject({
      type: "proposal",
    })
  })

  it("is not asked of a project where nothing waits", () => {
    expect(decode([step("review"), step("build")])).toMatchObject({ type: "proposal" })
  })
})

describe("`wait_for`, a step's own wait on the branch", () => {
  const deploying: AfterMerge = { ...merging(false), deploys: true }

  it("decodes `merged`, and `deployed` where the project has a deploy script", () => {
    expect(decode([step("build"), { ...step("review"), wait_for: "merged" }])).toMatchObject({
      type: "proposal",
    })
    expect(decode([{ ...step("review"), wait_for: "deployed" }], true, deploying)).toMatchObject({
      type: "proposal",
    })
  })

  it("refuses `deployed` on a project with no deploy script, and a value it does not know", () => {
    expect(decode([{ ...step("review"), wait_for: "deployed" }])).toContain("deploy script")
    expect(decode([{ ...step("review"), wait_for: "released" }])).toContain("wait_for")
  })

  it("refuses a writer at or after the step that waits, naming both steps", () => {
    const after = { ...merging(false), waits: new Set<string>() }
    expect(
      decode(
        [step("review"), { ...step("review"), wait_for: "merged" }, step("build")],
        true,
        after,
      ),
    ).toContain(
      "`build` at step 3 writes, and it comes after `review` at step 2, which waits for `merged`",
    )
    expect(decode([{ ...step("build"), wait_for: "merged" }], true, after)).toContain(
      "`build` at step 1 writes, and it waits on the branch merging",
    )
    // A writer before the wait is the ordinary order.
    expect(
      decode([step("build"), { ...step("review"), wait_for: "merged" }], true, after),
    ).toMatchObject({ type: "proposal" })
  })

  it("refuses one on a step of a spawn's piece", () => {
    const waitingPiece = {
      type: "spawn",
      instruction: "do these at once",
      children: [{ steps: [{ agent: "review", instruction: "check it", wait_for: "merged" }] }],
    }
    expect(decode([waitingPiece, step("review")])).toContain("not a step of a spawn's piece")
  })
})
