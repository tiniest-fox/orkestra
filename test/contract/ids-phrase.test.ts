// What the live `Ids` layer promises beyond handing back a string: the name it
// gives is one nothing holds.
//
// Here rather than in a shared contract file because it is not the port's promise
// — `FixedIds` counts and is not wrong for it — and it builds Layers, which is
// what keeps it out of a test beside the source.
//
// **The draw is scripted throughout.** Two random draws collide about once in
// fifteen million, so a test that waited for one would assert nothing and pass.
// `phraseIds` takes the draw for exactly this, and for nothing the engine uses.

import { seedLog } from "../support/seed.js"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { NoVcsLayer } from "../../src/vcs/adapters/none.js"
import { Vcs, type VcsShape } from "../../src/vcs/ports/vcs.js"
import { GitFailed } from "../../src/vcs/types/errors.js"
import { phraseIds, PhraseIdsLayer } from "../../src/workflow/adapters/ids-phrase.js"
import { MemoryStoreLayer } from "../../src/workflow/adapters/store-memory.js"
import { Events } from "../../src/workflow/domain/event.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { Ids } from "../../src/workflow/ports/ids.js"
import { Store, type StoreShape } from "../../src/workflow/ports/store.js"
import { StoreFailed } from "../../src/workflow/ports/store-errors.js"

/** Each name in turn, then the last one over and over — a draw that has run dry. */
const draws = (names: readonly string[]): (() => string) => {
  let at = 0
  return () => {
    const name = names[Math.min(at, names.length - 1)]
    at += 1
    if (name === undefined) throw new Error("scripted with no names at all")
    return name
  }
}

/**
 * Every method of these two fakes that naming must never reach.
 *
 * It throws rather than answering: a fake that quietly obliged would let the mint
 * grow a second dependency with nothing to notice it by, and what is being pinned
 * here is that naming a trak asks two questions and no others.
 */
const notAsked = (): never => {
  throw new Error("naming a trak reads the store's list and asks git for a branch, and no more")
}

/** A `Vcs` that answers the one question naming asks. */
const gitHolding = (answer: (trakId: string) => Effect.Effect<boolean, GitFailed>) =>
  Layer.succeed(Vcs, {
    createWorktree: notAsked,
    commitWork: notAsked,
    removeWorktree: notAsked,
    removalFor: notAsked,
    removeCheckout: notAsked,
    deleteBranch: notAsked,
    forgetTrak: notAsked,
    fetchWork: notAsked,
    carryTarget: notAsked,
    carryOut: notAsked,
    carryIn: notAsked,
    leftBehind: notAsked,
    hasCheckout: notAsked,
    remakeCheckout: notAsked,
    hasBranch: answer,
    branchTip: notAsked,
    branchFromOrigin: notAsked,
    merge: notAsked,
    wouldConflict: notAsked,
    contains: notAsked,
    createGoalBranch: notAsked,
    pushGoal: notAsked,
    removeGoalCheckout: notAsked,
    hostBranch: notAsked,
    defaultBranch: notAsked,
    originTip: notAsked,
    dirty: notAsked,
    workingTree: notAsked,
    headTree: notAsked,
    publishProofs: notAsked,
    readProofs: notAsked,
    ensureIgnored: notAsked,
    changes: notAsked,
    hostStatus: notAsked,
    fetch: notAsked,
    pull: notAsked,
    reconcile: notAsked,
    stashAnd: notAsked,
    push: notAsked,
    projectFiles: notAsked,
    grepProject: notAsked,
    moveOntoBase: notAsked,
  } satisfies VcsShape)

/** A store that cannot say what it holds — the lookup failing, not answering "no". */
const storeThatCannotAnswer = Layer.succeed(Store, {
  append: notAsked,
  versions: notAsked,
  events: notAsked,
  list: () => Effect.fail(new StoreFailed({ reason: "the database directory is not readable" })),
  appendTranscript: notAsked,
  transcript: notAsked,
  saveView: notAsked,
  view: notAsked,
  remove: notAsked,
} satisfies StoreShape)

const freeGit = gitHolding(() => Effect.succeed(false))

/** Mint `count` ids the way a spawn does: one command, nothing written between. */
const mintAll = (count: number) =>
  Effect.flatMap(Ids, (ids) => Effect.forEach(Array.from({ length: count }), () => ids.newTrakId))

/** Put `body` under a mint drawing `names`, over the given store and git. */
const under = <A, E>(
  names: readonly string[],
  store: Layer.Layer<Store>,
  vcs: Layer.Layer<Vcs>,
  body: Effect.Effect<A, E, Ids | Store>,
): Promise<A> =>
  Effect.runPromise(
    body.pipe(
      Effect.provide(
        Layer.mergeAll(store, phraseIds(draws(names)).pipe(Layer.provide(Layer.merge(store, vcs)))),
      ),
    ),
  )

describe("the name a trak is given", () => {
  it("is three lowercase words", async () => {
    // The real draw, so this is also the assertion that the shipped dictionaries
    // produce something git will take as a branch.
    const id = await Effect.runPromise(
      Effect.flatMap(Ids, (ids) => ids.newTrakId).pipe(
        Effect.provide(
          PhraseIdsLayer.pipe(Layer.provide(Layer.merge(MemoryStoreLayer, NoVcsLayer))),
        ),
      ),
    )
    expect(id).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/)
  })

  it("is drawn again when the store already knows the name", async () => {
    const taken = await under(
      ["witty-jade-otter", "brave-teal-lion"],
      MemoryStoreLayer,
      freeGit,
      Effect.gen(function* () {
        const store = yield* Store
        yield* seedLog(store, TrakId.make("witty-jade-otter"), [
          Events.trakCreated("the first one"),
        ])
        return yield* Effect.flatMap(Ids, (ids) => ids.newTrakId)
      }),
    )
    expect(taken).toBe("brave-teal-lion")
  })

  it("is drawn again when git holds the branch and no trak does", async () => {
    // The case the store alone cannot see, and the one that would be silent:
    // wiping a trak removes its log and leaves the branch and the recorded base
    // ref, so a name redrawn onto that branch is a new trak continuing a dead
    // one's commits and measuring its work against that trak's fork point.
    const taken = await under(
      ["witty-jade-otter", "brave-teal-lion"],
      MemoryStoreLayer,
      gitHolding((trakId) => Effect.succeed(trakId === "witty-jade-otter")),
      Effect.flatMap(Ids, (ids) => ids.newTrakId),
    )
    expect(taken).toBe("brave-teal-lion")
  })

  it("differs across a spawn's children, none of which is in the store yet", async () => {
    // `SpawnChildren` mints one id per child in a single command and writes none
    // of them until the events are appended — so four children checked against
    // the store alone would every one of them find the name free.
    const minted = await under(
      [
        "witty-jade-otter",
        "witty-jade-otter",
        "brave-teal-lion",
        "keen-olive-crab",
        "wry-red-mole",
      ],
      MemoryStoreLayer,
      freeGit,
      mintAll(4),
    )
    expect(minted).toStrictEqual([
      "witty-jade-otter",
      "brave-teal-lion",
      "keen-olive-crab",
      "wry-red-mole",
    ])
  })

  it("fails rather than taking a name the store could not answer for", async () => {
    // "I could not tell" spent as "the name is free" would put a new trak on
    // someone else's branch, which is the one direction that is not recoverable.
    const outcome = await under(
      ["witty-jade-otter"],
      storeThatCannotAnswer,
      freeGit,
      Effect.either(Effect.flatMap(Ids, (ids) => ids.newTrakId)),
    )
    expect(outcome._tag).toBe("Left")
    if (outcome._tag === "Left") expect(outcome.left._tag).toBe("StoreFailed")
  })

  it("fails rather than taking a name git could not answer for", async () => {
    const outcome = await under(
      ["witty-jade-otter"],
      MemoryStoreLayer,
      gitHolding(() =>
        Effect.fail(new GitFailed({ op: "read branch", reason: "git is not here" })),
      ),
      Effect.either(Effect.flatMap(Ids, (ids) => ids.newTrakId)),
    )
    expect(outcome._tag).toBe("Left")
    if (outcome._tag === "Left") expect(outcome.left._tag).toBe("GitFailed")
  })
})
