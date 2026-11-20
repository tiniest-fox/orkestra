/**
 * Tier 1: what the ending says about itself, with no React and no network.
 *
 * Every number here is a count over a log the server sent, so the assertions worth having
 * are the ones where counting naively is wrong: a re-runnable commit reporting the same sha
 * twice, an approval that took work a check disagreed with, and a log written before events
 * were stamped with a time.
 */

import { GENERIC_AGENT } from "../../../format/engineAgent"
import { describe, expect, it } from "vitest"
import type { EventDto, PlanDto } from "../../../api/types"
import {
  makeAgentReturned,
  makeAgentStep,
  makeCheckFailed,
  makeChecksCancelled,
  makeChecksPassed,
  makeComposeEntry,
  makeComposerReturned,
  makeHumanActed,
  makePlan,
  makeTrakCreated,
  makeWorkCommitted,
} from "../../../fixtures"
import {
  arrowEnd as arrowEndOf,
  branchMoved,
  destination,
  doorWords,
  ending,
  endingCell,
  endingTitle,
  endingWords as endingWordsOf,
  handedUp,
} from "./finished"
import type { EndStateDto } from "../controls"

/**
 * A branch something was committed to, which is what every case below is about unless it
 * says otherwise. The one fact `endingWords` and `arrowEnd` take beyond the state is fixed
 * here rather than at forty call sites, and the cases about a branch that never moved call
 * the real functions.
 */
const endingWords = (
  state: EndStateDto,
  pull: Parameters<typeof endingWordsOf>[1],
): ReturnType<typeof endingWordsOf> => endingWordsOf(state, pull, true)

/** The same, and narrowed: a trak with commits always has a right-hand side to draw, so a
 *  case reaching for one that is missing is this file's bug rather than an assertion. */
const arrowEnd = (
  state: EndStateDto,
  into: Parameters<typeof arrowEndOf>[1],
): NonNullable<ReturnType<typeof arrowEndOf>> => {
  const end = arrowEndOf(state, into, true)
  if (end === undefined) throw new Error(`no right-hand side at ${state._tag}`)
  return end
}

const plan: PlanDto = makePlan({
  steps: [
    makeComposeEntry(),
    makeAgentStep({ agent: "planner", instruction: "sketch the routes" }),
    makeAgentStep({ agent: "builder", instruction: "build the drawer" }),
  ],
})

const MINUTE = 60_000

const log: readonly EventDto[] = [
  makeTrakCreated({ description: "add a client", at: 1_000_000 }),
  makeWorkCommitted({ step: 1, sha: "abc1234", at: 1_000_000 + MINUTE }),
  makeHumanActed({ step: 1, at: 1_000_000 + 2 * MINUTE }),
  makeWorkCommitted({ step: 2, sha: "def5678", at: 1_000_000 + 3 * MINUTE }),
  makeHumanActed({ step: 2, at: 1_000_000 + 26 * MINUTE }),
]

describe("ending", () => {
  it("counts the steps, the stops and the commits off the plan and the log", () => {
    const e = ending(log, plan, "trak/auto-commit")

    expect(e.branch).toBe("trak/auto-commit")
    // The composer's own entry is not a step: the count beside *stopped for you* is about
    // the work rather than about the planning.
    expect(e.steps).toBe(2)
    expect(e.gates).toBe(2)
    expect(e.commits).toBe(2)
    expect(e.elapsed).toBe("26m")
  })

  /**
   * `Vcs.commitWork` is re-runnable and reads its answer off the branch, so two entries in
   * a row that changed nothing report the same tip. Counting the events would say *3
   * commits* about a branch with two — and this is the one number on the card a person
   * might go and check.
   */
  it("counts commits by distinct sha, not by event", () => {
    const repeated: readonly EventDto[] = [
      ...log,
      makeWorkCommitted({ step: 2, sha: "def5678", at: 1_000_000 + 27 * MINUTE }),
      // No sha at all: nothing has been committed on the branch yet, which is not a commit.
      makeWorkCommitted({ at: 1_000_000 + 28 * MINUTE }),
    ]
    expect(ending(repeated, plan, "b").commits).toBe(2)
  })

  /**
   * A log written before `Store.append` stamped a time. *A time the engine did not measure
   * is not one to invent* — so this reports nothing rather than a zero, and never a
   * duration measured from 1970.
   */
  it("says nothing about duration when the log has no times in it", () => {
    const unstamped: readonly EventDto[] = [
      makeTrakCreated({ description: "add a client" }),
      makeWorkCommitted({ step: 1, sha: "abc1234" }),
    ]
    expect(ending(unstamped, plan, "b").elapsed).toBeUndefined()
    // And with exactly one stamp there is no span either — a subtraction needs two.
    expect(ending([makeWorkCommitted({ at: 1_000 })], plan, "b").elapsed).toBeUndefined()
  })

  it("says under a minute rather than 0m, and spells hours out", () => {
    const over = (ms: number): string | undefined =>
      ending(
        [makeTrakCreated({ description: "x", at: 0 }), makeWorkCommitted({ at: ms })],
        plan,
        "b",
      ).elapsed

    expect(over(40_000)).toBe("under a minute")
    expect(over(26 * MINUTE)).toBe("26m")
    expect(over(108 * MINUTE)).toBe("1h48m")
  })
})

/**
 * `overrode`, through `ending` because that is its only exit.
 *
 * Its own block rather than more of the one above: every case here is a *log shape* — an
 * order of events the engine can actually write — where a rule that matched a `CheckFailed`
 * to an `Approve` by step alone says the wrong thing.
 */
describe("ending: the checks a person took the work in spite of", () => {
  /**
   * The ending is the last surface that can say a check was overridden — the `checks` gate
   * is gone the moment somebody approves, so nothing else on screen records it.
   */
  it("names the checks that were failing when the work was taken", () => {
    const overrode: readonly EventDto[] = [
      makeCheckFailed({ step: 1, name: "pnpm verify", output: "2 warnings" }),
      makeHumanActed({ step: 1, action: { _tag: "Approve" } }),
    ]
    expect(ending(overrode, plan, "b").overrode).toEqual(["pnpm verify"])
  })

  /**
   * **The engine's ordinary recovery, and the case a set of approved steps gets wrong.**
   * `decide` re-runs the agent on a first failure, the re-run passes, and the step parks at
   * its *approval* gate where a person says yes — so the log holds a `CheckFailed` and an
   * `Approve` at the same step with nothing overridden between them. Nobody took failing
   * work; `CHECK_FAILURE_LIMIT` exists to make this the common path, and calling it an
   * override says *you took this work with pnpm verify still failing* about a green step.
   */
  it("says nothing when the agent fixed the check and the pass came before the approval", () => {
    const fixed: readonly EventDto[] = [
      makeCheckFailed({ step: 1, name: "pnpm verify", output: "2 warnings" }),
      makeChecksPassed({ step: 1, ran: ["pnpm verify"] }),
      makeHumanActed({ step: 1, action: { _tag: "Approve" } }),
    ]
    expect(ending(fixed, plan, "b").overrode).toEqual([])
  })

  /** A failing check the step went back and fixed is not an override — nobody took it. */
  it("says nothing about a check that failed at a step nobody approved", () => {
    const fixed: readonly EventDto[] = [
      makeCheckFailed({ step: 1, name: "pnpm verify", output: "2 warnings" }),
      makeHumanActed({ step: 1, action: { _tag: "Replan", reason: "smaller" } }),
      makeChecksPassed({ step: 1, ran: ["pnpm verify"] }),
    ]
    expect(ending(fixed, plan, "b").overrode).toEqual([])
  })

  /**
   * A step that failed, was fixed and taken, then went round again on a later re-entry and
   * was taken failing. The second run is the override and the first is not, which no rule
   * over the whole log can tell apart without walking it in order.
   */
  it("reads each run of a step on its own, not the step as a whole", () => {
    const twice: readonly EventDto[] = [
      makeCheckFailed({ step: 1, name: "pnpm verify", output: "2 warnings" }),
      makeChecksPassed({ step: 1, ran: ["pnpm verify"] }),
      makeHumanActed({ step: 1, action: { _tag: "Approve" } }),
      makeCheckFailed({ step: 1, name: "pnpm lint", output: "1 warning" }),
      makeHumanActed({ step: 1, action: { _tag: "Approve" } }),
    ]
    expect(ending(twice, plan, "b").overrode).toEqual(["pnpm lint"])
  })

  /**
   * The plan gate is `HumanActed{step: 0}` — the composer has no step of its own — and on a
   * child trak the plan's first entry *is* step 0. Matching by step index alone reports the
   * child's own failing check as taken by an approval given before the step ever ran.
   */
  it("does not read the plan approval as taking a step-0 check that came after it", () => {
    const child: readonly EventDto[] = [
      makeHumanActed({ step: 0, action: { _tag: "Approve" } }),
      makeCheckFailed({ step: 0, name: "pnpm verify", output: "2 warnings" }),
    ]
    expect(ending(child, plan, "b").overrode).toEqual([])
  })

  /**
   * **Only the last failure at a step can still be failing.** Checks are fail-fast, so a
   * different name on the next run means the agent got past the first one — and that is
   * precisely the log that reaches a `checks` gate, because `replay.ts` only calls a failure
   * *repeated* when it matches the run immediately before, so the escalating path to
   * `CHECK_FAILURE_LIMIT` is the one whose names alternate. Naming both says *you took this
   * work with pnpm verify still failing* about a check that demonstrably passed.
   */
  it("names only the check that was failing last, not every one the step tripped", () => {
    const escalated: readonly EventDto[] = [
      makeCheckFailed({ step: 1, name: "pnpm verify", output: "2 warnings" }),
      makeCheckFailed({ step: 1, name: "pnpm lint", output: "1 warning" }),
      makeHumanActed({ step: 1, action: { _tag: "Approve" } }),
    ]
    expect(ending(escalated, plan, "b").overrode).toEqual(["pnpm lint"])
  })

  /**
   * **`Chat` is half of what a `checks` gate offers, and it resolves nothing.** A chat
   * re-enters the step; a prose reply is not a conversation turn — the step has a filed
   * artifact — so `reenter` hands back the *same* checks gate with `Approve` on offer, and
   * no check has re-run in between. Clearing on every `HumanActed` forgets the failure
   * permanently, and the approval that follows reads as an ordinary one.
   */
  it("still names a check taken after a chat at the gate, which re-runs nothing", () => {
    const chatted: readonly EventDto[] = [
      makeCheckFailed({ step: 1, name: "pnpm verify", output: "2 warnings" }),
      makeHumanActed({ step: 1, action: { _tag: "Chat", message: "why is it failing?" } }),
      makeAgentReturned({
        step: 1,
        sessionId: "s1",
        output: { type: "message", text: "the lint rule is new" },
      }),
      makeHumanActed({ step: 1, action: { _tag: "Approve" } }),
    ]
    expect(ending(chatted, plan, "b").overrode).toEqual(["pnpm verify"])
  })

  /** The same check taken failing at two different steps is one name, not two. */
  it("does not repeat a name taken at more than one step", () => {
    const twice: readonly EventDto[] = [
      makeCheckFailed({ step: 1, name: "pnpm verify", output: "2 warnings" }),
      makeHumanActed({ step: 1, action: { _tag: "Approve" } }),
      makeCheckFailed({ step: 2, name: "pnpm verify", output: "2 warnings" }),
      makeHumanActed({ step: 2, action: { _tag: "Approve" } }),
    ]
    expect(ending(twice, plan, "b").overrode).toEqual(["pnpm verify"])
  })
})

// The same derivation over the two presses a person makes on a check. A skipped run
// resolves nothing, so each shape is what *follows* it at that step — and the one with
// nothing following is the unattended acceptance.
describe("ending: a failure skipped past, and a run a person ended", () => {
  const failed = makeCheckFailed({ step: 1, name: "verify", output: "2 warnings" })
  const skipped = makeChecksPassed({ step: 1, ran: [], skipped: ["verify"] })
  const approved = makeHumanActed({ step: 1, action: { _tag: "Approve" } })

  /**
   * On `smart` and `auto` the skipped pass is the acceptance and nothing follows at the
   * step, so the failure still outstanding at the end of the log is the override.
   */
  it("names a failing check whose re-run was skipped and nothing followed", () => {
    expect(ending([failed, skipped], plan, "b").overrode).toEqual(["verify"])
  })

  it("names it once where the approval gate on manual takes it", () => {
    expect(ending([failed, skipped, approved], plan, "b").overrode).toEqual(["verify"])
  })

  /** The gate a skip parks at on `manual` offers Replan too, and that is not a taking. */
  it("names nothing where the step was sent back to the composer after the skip", () => {
    const replanned: readonly EventDto[] = [
      failed,
      skipped,
      makeHumanActed({ step: 1, action: { _tag: "Replan", reason: "smaller" } }),
    ]
    expect(ending(replanned, plan, "b").overrode).toEqual([])
  })

  /** A chat that files again reaches a re-run — the switch is spent — and its pass clears. */
  it("names nothing where a later run at that step actually passed", () => {
    const fixed: readonly EventDto[] = [
      failed,
      skipped,
      makeHumanActed({ step: 1, action: { _tag: "Chat", message: "tighten it" } }),
      makeChecksPassed({ step: 1, ran: ["verify"] }),
      approved,
    ]
    expect(ending(fixed, plan, "b").overrode).toEqual([])
  })

  /**
   * A step re-entered after a failure can ask before it files again. Its answers move
   * nothing past the check, so the failure has to still be there for the skipped run that
   * follows — clearing on any press but a chat was only ever safe because a re-run followed.
   */
  it("keeps the failure across answered questions, for the skipped run to carry", () => {
    const answered: readonly EventDto[] = [
      failed,
      makeHumanActed({ step: 1, action: { _tag: "AnswerQuestions", answers: ["yes"] } }),
      skipped,
      approved,
    ]
    expect(ending(answered, plan, "b").overrode).toEqual(["verify"])
  })

  /** A re-run that fails again after a skip is a new failure, read on its own from there. */
  it("reads a failure after the skip as the one the step then stands on", () => {
    const again: readonly EventDto[] = [
      failed,
      skipped,
      makeHumanActed({ step: 1, action: { _tag: "Chat", message: "try again" } }),
      makeCheckFailed({ step: 1, name: "no-secrets", output: "a token" }),
      approved,
    ]
    expect(ending(again, plan, "b").overrode).toEqual(["no-secrets"])
  })

  /**
   * A check that never failed said nothing about the work, so skipping it names nothing
   * here — the step's own card says its checks did not run. The same for a run a person
   * ended before it said anything.
   */
  it("says nothing about a skipped or ended run that had no failure before it", () => {
    expect(ending([skipped, approved], plan, "b").overrode).toEqual([])
    const cancelled: readonly EventDto[] = [
      makeChecksCancelled({ step: 1, name: "verify" }),
      approved,
    ]
    expect(ending(cancelled, plan, "b").overrode).toEqual([])
  })

  /**
   * A run a person ended is `Chat`'s case: it resolves nothing, so the failure before it is
   * carried to the approval that takes it — and cleared by a re-run that passes after it.
   */
  it("carries a failure across a run a person ended, until something resolves it", () => {
    const cancelled = makeChecksCancelled({ step: 1, name: "verify" })
    expect(ending([failed, cancelled, approved], plan, "b").overrode).toEqual(["verify"])
    const fixed: readonly EventDto[] = [
      failed,
      cancelled,
      makeHumanActed({ step: 1, action: { _tag: "Chat", message: "try again" } }),
      makeChecksPassed({ step: 1, ran: ["verify"] }),
      approved,
    ]
    expect(ending(fixed, plan, "b").overrode).toEqual([])
  })
})

describe("endingWords", () => {
  it("says something different at each of the three endings", () => {
    const leads = (["Finished", "Merged", "Closed"] as const).map(
      (tag) =>
        endingWords(tag === "Merged" ? { _tag: tag, sha: "abc" } : { _tag: tag }, "none").lead,
    )
    expect(new Set(leads).size).toBe(3)
  })

  /** A merge git refused is a finished trak whose last hop was declined: the sentence
   *  stays, the refusal is a plate under it, and the presses stay too. */
  it("keeps the finished words at a merge git refused, with nothing in their place", () => {
    const refused = endingWords({ _tag: "Failed", kind: "merge", error: "exited 2" }, "none")
    expect(refused).toEqual(endingWords({ _tag: "Finished" }, "none"))
    expect(refused.instead).toBeUndefined()
  })

  /** A merge in flight is not a merge that happened: the pane must not report a result it
   *  does not have yet, so it keeps the `Finished` words and drops the presses. */
  it("keeps the finished words while a merge or a close is running", () => {
    expect(endingWords({ _tag: "Merging" }, "none").lead).toBe(
      endingWords({ _tag: "Finished" }, "none").lead,
    )
    expect(endingWords({ _tag: "Merging" }, "none").instead).toBe("Merging it now.")
    expect(endingWords({ _tag: "Closing" }, "none").instead).toBe("Archiving it now.")
  })

  /** The tail of a merge, where the sha is already on the state: the merge is a fact and
   *  the only thing in flight is the worktree going away. */
  it("says the work is in once a close is clearing up after a merge", () => {
    const words = endingWords({ _tag: "Closing", merged: "9f31c07" }, "none")
    expect(words.lead).not.toBe(endingWords({ _tag: "Finished" }, "none").lead)
    expect(words.instead).toBe("Clearing the checkout up.")
    // The checkout is not held any more — it is being taken away.
    expect(words.under).toBeUndefined()
  })

  /** Never an empty space where buttons were — and nothing said where there are still some.
   *  Which is now the three endings a person can act at, `Merged` having joined them. */
  it("has something to say at exactly the states that offer no press", () => {
    expect(endingWords({ _tag: "Merging" }, "none").instead).toBeDefined()
    expect(endingWords({ _tag: "Finished" }, "none").instead).toBeUndefined()
    expect(endingWords({ _tag: "Closed" }, "none").instead).toBeUndefined()
    expect(endingWords({ _tag: "Merged", sha: "abc" }, "none").instead).toBeUndefined()
  })

  /**
   * The sentence that went with the rule. *Nothing left to do here. More work on this is a
   * new trak* was true of this surface until the box became reachable at `Merged`, and what
   * stands in its place is what `Closed` already said: the merge did not take the branch
   * away, so re-entering makes a checkout from it again.
   */
  it("no longer tells a merged trak that more work on it is a new trak", () => {
    const words = endingWords({ _tag: "Merged", sha: "abc" }, "none")

    expect(words.under).toBe(endingWords({ _tag: "Closed" }, "none").under)
    expect([words.lead, words.under, words.instead].join(" ")).not.toMatch(/a new trak/)
  })

  /**
   * **A trak whose branch has a pull request is never offered a local merge**, so naming
   * one in the line under the lead points at a button that is not on screen. `FinishedView`
   * is where the press is composed away, and this is the sentence that has to agree with it.
   */
  it("stops naming a merge you cannot press once there is a pull request", () => {
    for (const state of ["open", "merged", "closed"] as const) {
      expect(endingWords({ _tag: "Finished" }, state).under).not.toMatch(/merge/i)
    }
    expect(endingWords({ _tag: "Finished" }, "none").under).toMatch(/merge/i)
  })

  /** An open one is going somewhere and a closed one is not, so only the first names the
   *  forge as the thing being waited on. */
  it("names GitHub as what is being waited on only while the pull request is open", () => {
    expect(endingWords({ _tag: "Finished" }, "open").under).toMatch(/GitHub/)
    expect(endingWords({ _tag: "Finished" }, "closed").under).not.toMatch(/GitHub/)
  })

  /** The pane must not report the work as pending above a section saying it is merged. */
  it("says the work is in once the pull request is merged on the forge", () => {
    const words = endingWords({ _tag: "Finished" }, "merged")
    expect(words.lead).toBe("The work is in — it went in on GitHub.")
    expect(words.lead).not.toBe(endingWords({ _tag: "Finished" }, "open").lead)
  })

  /**
   * **`Closed` is the case that looks like it should move and does not.** Re-entry is
   * genuinely offered there — `changesOffered` is true at `Closed` — and what it makes a
   * checkout from is the branch, which a pull request pointing at it does not change.
   */
  it("says the same thing at a closed trak whether or not there is a pull request", () => {
    expect(endingWords({ _tag: "Closed" }, "merged")).toEqual(
      endingWords({ _tag: "Closed" }, "none"),
    )
    expect(endingWords({ _tag: "Closed" }, "none").under).toMatch(/fresh checkout/)
  })

  /**
   * **Nothing is known, so nothing is claimed about the checkout.** The local Merge press is
   * withheld while the forge is still being asked, so *until you merge it* would promise a
   * button that is not there — and *until this goes in on GitHub* would assert a pull request
   * nobody has found. The line appears a moment later, when one of them can be true.
   */
  it("says nothing about the checkout while nothing has come back", () => {
    expect(endingWords({ _tag: "Finished" }, "unknown").under).toBeUndefined()
    // The lead is unchanged: the plan running out and the work being on a branch are facts
    // about this trak, and only the *merged* variant needs the forge to have spoken.
    expect(endingWords({ _tag: "Finished" }, "unknown").lead).toBe(
      endingWords({ _tag: "Finished" }, "none").lead,
    )
    // And it is still a state with presses, so nothing stands in for them.
    expect(endingWords({ _tag: "Finished" }, "unknown").instead).toBeUndefined()
  })

  describe("a trak that kept nothing on its branch", () => {
    /** Leads with the work being complete rather than with the absence: an investigation
     *  that answered a question and a check that found nothing are not failed merges. */
    it("says the work is complete, and names the merge only to rule it out", () => {
      // `none` is the standing such a trak has without a `gh` process being spent: a branch
      // nobody pushed to cannot have a pull request, so `FinishedView` says so rather than
      // letting an unasked question read as *still checking*.
      const words = endingWordsOf({ _tag: "Finished" }, "none", false)
      expect(words.lead).toBe("The work is complete. Nothing to merge.")
      expect(words.under).toBe("Archiving takes the checkout and the branch — here and on GitHub.")
      // Still no `instead`: Close and More work on it are both on offer, so there is no
      // empty space where the presses were for a sentence to answer.
      expect(words.instead).toBeUndefined()
    })

    /** The four states after it are untouched — once a person has decided, *nothing
     *  landed* has stopped being the useful fact. */
    it("changes nothing at the four states past the decision", () => {
      const ends: readonly EndStateDto[] = [
        { _tag: "Merging" },
        { _tag: "Closing" },
        { _tag: "Closing", merged: "9f31c07" },
        { _tag: "Merged", sha: "9f31c07" },
        { _tag: "Closed" },
      ]
      for (const state of ends)
        expect(endingWordsOf(state, "none", false)).toEqual(endingWords(state, "none"))
    })
  })
})

/**
 * The words each door puts in the box, and the one field that is not a word: `agent` is
 * what reaches `POST /reenter`, so the two cannot come apart on screen — a box that says
 * *Ask generic* and sends nothing would look right and plan the answer instead.
 */
/** The composer's finished answer, with or without a message for the parent. */
const finished = (handUp: string | undefined): EventDto =>
  makeComposerReturned({ output: { type: "finished", reason: "done", handUp } })

describe("handedUp", () => {
  it("reads the hand-up off the composer's finished answer", () => {
    expect(handedUp([makeTrakCreated(), finished("the icons need building first")])).toBe(
      "the icons need building first",
    )
  })

  it("says nothing where the composer handed nothing up, or never finished", () => {
    expect(handedUp([makeTrakCreated(), finished(undefined)])).toBeUndefined()
    expect(handedUp([makeTrakCreated(), makeComposerReturned()])).toBeUndefined()
  })

  it("takes the last finished answer, which is the one the engine lands on the parent", () => {
    expect(handedUp([finished("first time"), finished(undefined)])).toBeUndefined()
    expect(handedUp([finished(undefined), finished("second time")])).toBe("second time")
  })
})

describe("doorWords", () => {
  it("names nobody at the plan door, which is what sends it to the composer", () => {
    const words = doorWords("plan")

    expect(words.agent).toBeUndefined()
    expect(words.label).toBe("What should change?")
    expect(words.send).toBe("Send it back")
    expect(words.foot).toMatch(/composer/)
  })

  it("names the one agent the route accepts at the ask door", () => {
    const words = doorWords("ask")

    expect(words.agent).toBe(GENERIC_AGENT)
    expect(words.send).toBe(`Ask ${GENERIC_AGENT}`)
    expect(words.label).toBe("What do you want to ask?")
  })

  /** Every string differs, which is the whole of what a door is: nothing else about the box
   *  changes, so a string shared between them is one the reader cannot tell apart. */
  it("changes every word it has, including the hint in the empty field", () => {
    const planDoor = doorWords("plan")
    const askDoor = doorWords("ask")

    for (const key of ["label", "foot", "send", "placeholder"] as const) {
      expect(askDoor[key]).not.toBe(planDoor[key])
    }
  })
})

describe("endingTitle", () => {
  it("names the ending rather than the state, so a merge in flight reads as a merge", () => {
    expect(endingTitle({ _tag: "Finished" })).toBe("Finished")
    expect(endingTitle({ _tag: "Merging" })).toBe("Merged")
    expect(endingTitle({ _tag: "Closing" })).toBe("Closed")
  })

  /** `Closing` is both endings, so which one it is comes off `merged` — the same fact
   *  `arrowEnd` reads to draw the commit on the card beside this title. */
  it("reads a close after a merge as the merge it is finishing", () => {
    expect(endingTitle({ _tag: "Closing", merged: "9f31c07" })).toBe("Merged")
  })
})

describe("destination", () => {
  it("names the branch the host is on", () => {
    expect(destination({ branch: "trak/x", into: "main" })?.name).toBe("main")
  })

  /** A child's parent is an id, not a branch name — so it is named by what it is. */
  it("says a child goes to its parent, without naming it", () => {
    const child = destination({ branch: "trak/x-3-1", parentId: "11111111" })
    expect(child?.name).toBe("its parent")
    expect(child?.note).toBe("a child merges into its parent")
  })

  it("names a goal trak's goal branch, wherever the host stands", () => {
    const onGoal = destination({ branch: "trak/x", into: "main", goalBranch: "goal/ship" })
    expect(onGoal?.name).toBe("goal/ship")
    expect(onGoal?.note).toBe("the branch its goal lands on")
  })

  it("says there is nowhere to go on a detached HEAD", () => {
    expect(destination({ branch: "trak/x" })?.name).toBe("nowhere")
  })

  it("has no answer at all until the preview has one", () => {
    expect(destination(undefined)).toBeUndefined()
  })
})

/**
 * The right-hand side of the card, which every state has to fill — including the three
 * where the preview has nothing to say and never will.
 */
describe("arrowEnd", () => {
  const into = { name: "main", note: "the branch this machine is on" }

  it("draws the preview's answer where a merge is still the question", () => {
    for (const state of [{ _tag: "Finished" }, { _tag: "Merging" }] as const) {
      expect(arrowEnd(state, into).name).toBe("main")
      expect(arrowEnd(state, into).unmerged).toBe(false)
    }
  })

  /**
   * The placeholder is only allowed where an answer is actually coming. `destinationAsked`
   * is what makes that true at `Merging` as well as `Finished` — gated on the press instead,
   * a reload during a `git merge` draws this and nothing ever replaces it.
   */
  it("waits, rather than guessing, while the preview has not answered", () => {
    expect(arrowEnd({ _tag: "Finished" }, undefined).name).toBe("…")
    expect(arrowEnd({ _tag: "Finished" }, undefined).note).toBe("asking where this would go")
  })

  /**
   * **The merge commit, never a branch and never the placeholder.** `Merged` carries no
   * destination — a merge goes wherever the host was standing — and nothing asks the
   * preview about a merge that already happened, so `…` there resolves on no load at all.
   */
  it("names the commit the work went in as, once it is in", () => {
    const end = arrowEnd({ _tag: "Merged", sha: "9f31c07" }, undefined)
    expect(end.name).toBe("9f31c07")
    expect(end.note).toBe("the merge commit")
    expect(end.unmerged).toBe(false)
  })

  /**
   * `Closing` is the tail of both endings — it carries the merge commit after a merge and
   * nothing after a plain close — so reading `merged` is what stops the card saying
   * *nothing was merged* about work that is already in.
   */
  it("tells the two things Closing can be apart by the commit it carries", () => {
    expect(arrowEnd({ _tag: "Closing", merged: "9f31c07" }, undefined).name).toBe("9f31c07")
    expect(arrowEnd({ _tag: "Closing" }, undefined).name).toBe("nothing was merged")
  })

  /** An arrow would promise a merge that is never going to happen. */
  it("points nowhere on a trak that was closed rather than merged", () => {
    const end = arrowEnd({ _tag: "Closed" }, into)
    expect(end.name).toBe("nothing was merged")
    expect(end.note).toBe("the branch went with the archive")
    expect(end.unmerged).toBe(true)
  })

  /**
   * **Nothing at all, which is a third answer rather than `NOTHING_MERGED` again.** *The
   * branch went with the archive and nothing was merged* is news at a trak somebody archived and a
   * restatement of `0 commits` at one that never wrote anything — so the card loses the
   * side rather than filling it, and `FinishedMove` draws the arrow with it.
   */
  it("draws no right-hand side at all where nothing was ever committed", () => {
    expect(arrowEndOf({ _tag: "Finished" }, into, false)).toBeUndefined()
    expect(arrowEndOf({ _tag: "Finished" }, undefined, false)).toBeUndefined()
    // And it is `Finished`'s alone: the four past the decision keep what they had.
    expect(arrowEndOf({ _tag: "Closed" }, into, false)).toEqual(arrowEnd({ _tag: "Closed" }, into))
    expect(arrowEndOf({ _tag: "Merged", sha: "9f31c07" }, into, false)).toEqual(
      arrowEnd({ _tag: "Merged", sha: "9f31c07" }, into),
    )
  })
})

/**
 * The predicate the whole feature turns on, and the one the server sends the list its own
 * answer to. `dto.test.ts` is where the two are asserted to agree.
 */
describe("branchMoved", () => {
  it("is true of a log holding one commit and false of one holding none", () => {
    expect(branchMoved([makeTrakCreated(), makeWorkCommitted({ sha: "9f31c07" })])).toBe(true)
    expect(branchMoved([makeTrakCreated()])).toBe(false)
  })

  /**
   * **The hash, never the event.** `CommitWork` runs at every step boundary whether or not
   * anything landed, so a trak of read-only steps reaches its ending with a `WorkCommitted`
   * per step and not one sha — which is the shape this repository's own store holds and the
   * one a count of events would call *plenty of commits*.
   */
  it("reads a commit event carrying no sha as nothing committed", () => {
    const readOnly: readonly EventDto[] = [
      makeTrakCreated(),
      makeWorkCommitted({ step: 0 }),
      makeWorkCommitted({ step: 1 }),
      makeWorkCommitted({}),
    ]
    expect(branchMoved(readOnly)).toBe(false)
  })
})

/**
 * **What the band's right-hand cell holds, over every fact that decides it.** The ghost
 * stands only where the forge's answer can still change the press, and landing counts as
 * merged — the two things the round settled that the old row did not do.
 */
describe("endingCell", () => {
  const FINISHED = { merge: true, archive: true }
  const FAILED = { merge: true, archive: false }
  const REST = { merge: false, archive: false }
  const AT = { standing: "none", moved: true, landed: false, waiting: false, pull: false } as const
  const OPEN = { standing: "open", pull: true } as const

  const CASES = [
    ["Finished, forge not answered", { ...FINISHED, ...AT, standing: "unknown" }, "checking"],
    ["Finished, no pull request", { ...FINISHED, ...AT }, "merge"],
    ["Finished, pull request open", { ...FINISHED, ...AT, ...OPEN }, "mergePull"],
    [
      "Finished, pull request open, only the coarse answer",
      { ...FINISHED, ...AT, standing: "open" },
      "checking",
    ],
    [
      "Finished, pull request open, a step held",
      { ...FINISHED, ...AT, ...OPEN, waiting: true },
      "mergePull",
    ],
    [
      "Finished, pull request open, landed",
      { ...FINISHED, ...AT, ...OPEN, landed: true },
      "archive",
    ],
    ["Finished, pull request closed", { ...FINISHED, ...AT, standing: "closed" }, "menu"],
    ["Finished, pull request merged", { ...FINISHED, ...AT, standing: "merged" }, "archive"],
    ["Finished, landed", { ...FINISHED, ...AT, landed: true }, "archive"],
    [
      "Finished, landed, forge not answered",
      { ...FINISHED, ...AT, standing: "unknown", landed: true },
      "archive",
    ],
    ["Finished, nothing committed", { ...FINISHED, ...AT, moved: false }, "archive"],
    [
      "Finished, merged, a step held",
      { ...FINISHED, ...AT, standing: "merged", waiting: true },
      "menu",
    ],
    ["Finished, landed, a step held", { ...FINISHED, ...AT, landed: true, waiting: true }, "menu"],
    [
      "Finished, nothing committed, a step held",
      { ...FINISHED, ...AT, moved: false, waiting: true },
      "menu",
    ],
    ["Finished, no pull request, a step held", { ...FINISHED, ...AT, waiting: true }, "merge"],
    ["refused merge, forge not answered", { ...FAILED, ...AT, standing: "unknown" }, "checking"],
    ["refused merge, no pull request", { ...FAILED, ...AT }, "merge"],
    ["refused merge, pull request open", { ...FAILED, ...AT, ...OPEN }, "none"],
    ["Merged, Closed, Merging, Closing", { ...REST, ...AT, standing: "unknown" }, "none"],
  ] as const

  for (const [at, facts, cell] of CASES)
    it(`holds ${cell} at ${at}`, () => {
      expect(endingCell(facts)).toBe(cell)
    })
})
