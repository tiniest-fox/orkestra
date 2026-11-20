// Tier-1: what a row says about a held trak, which of the wait and the forge's answer
// leads it, and what it keeps of the other.

import { describe, expect, it } from "vitest"
import { makeDeploy, makePullRequestSummary, makeTrak, makeWaiting } from "../../fixtures"
import { ASKING, pullRung, UNASKED, type Rung } from "./pullRung"
import { onDeploy, rowMark, rowWords, waitFirst } from "./waitingRow"

const merged = pullRung(makePullRequestSummary({ state: "merged" }))

/** A trak waiting on its deploy, with the sweep's last answer on the row. */
const waiting = (answer: "live" | "not-yet" | "gave-up") =>
  makeTrak({
    state: { _tag: "Finished" },
    waiting: makeWaiting({ name: "deployed" }),
    deploy: makeDeploy({ answer }),
  })

/** A finished trak held on the named wait, before any script has answered. */
const heldOn = (name: string) =>
  makeTrak({ state: { _tag: "Finished" }, waiting: makeWaiting({ name }) })

/** The same, once the daemon has stopped asking it. */
const gaveUp = (name: string) =>
  makeTrak({ state: { _tag: "Finished" }, waiting: makeWaiting({ name, stopped: true }) })

/**
 * One rung of each family the ladder produces on a pull request that has not merged — a
 * refusal, nothing in the way, the forge still working it out, and one closed for good —
 * and the merged rung, which is the one that hands the row back to the wait.
 */
const conflicts = pullRung(makePullRequestSummary({ merging: "conflicting" }))
const ready = pullRung(makePullRequestSummary())
const OUT: readonly { readonly what: string; readonly rung: Rung }[] = [
  { what: "conflicts", rung: conflicts },
  { what: "ready to merge", rung: ready },
  { what: "not worked out yet", rung: pullRung(makePullRequestSummary({ merging: "unknown" })) },
  { what: "closed without merging", rung: pullRung(makePullRequestSummary({ state: "closed" })) },
]

describe("rowWords", () => {
  it("reads exactly as before where nothing is held", () => {
    const plain = makeTrak({ state: { _tag: "Finished" } })
    expect(rowWords(plain, undefined)).toEqual({
      label: "Ready to merge",
      tone: "waiting",
      aside: undefined,
    })
    expect(rowWords(plain, merged)).toEqual({ ...merged, aside: undefined })
  })

  it("beats the forge's answer with the wait, and keeps that answer as the aside", () => {
    const held = makeTrak({ state: { _tag: "Finished" }, waiting: makeWaiting() })
    expect(rowWords(held, merged)).toEqual({
      label: "Held on a condition",
      tone: "working",
      aside: "Merged — checkout still here",
    })
    expect(rowWords(held, undefined).aside).toBeUndefined()
  })

  /** The sweep's answer, where the wire carries one: the word alone, in the answer's tone,
   *  and the forge's clause gone with the version and the time — the person chose the
   *  word by itself, and the trak's own page has the rest. */
  it("says what the deploy said on a trak waiting on it, and nothing else", () => {
    expect(rowWords(waiting("not-yet"), merged)).toEqual({
      label: "Not live yet",
      tone: "working",
      aside: undefined,
    })
    expect(rowWords(waiting("live"), merged)).toEqual({
      label: "Live",
      tone: "good",
      aside: undefined,
    })
    expect(rowWords(waiting("gave-up"), merged)).toEqual({
      label: "Failed",
      tone: "bad",
      aside: undefined,
    })
  })

  /** Before the branch has merged the script has never run and the wire carries no
   *  answer, and the row is still the deploy's: not live yet, as the trak's page says. */
  it("says Not live yet on a deploy wait the script has not answered yet", () => {
    const early = heldOn("deployed")
    expect(rowWords(early, undefined)).toEqual({
      label: "Not live yet",
      tone: "working",
      aside: undefined,
    })
    expect(rowWords({ ...early, deploy: { answer: "none" } }, undefined).label).toBe("Not live yet")
  })

  /**
   * The inversion: a wait on the branch going in cannot pass until the pull request
   * merges, so where the forge says it has not, the pull request has the row's words and
   * tone, and the wait is the clause after them.
   */
  it.each(OUT)("yields a deploy wait's row to a pull request that is $what", ({ rung }) => {
    expect(rowWords(heldOn("deployed"), rung)).toEqual({ ...rung, aside: "Not live yet" })
    expect(rowWords(heldOn("merged"), rung)).toEqual({ ...rung, aside: "Held on a condition" })
  })

  it("hands the row back to the wait once the forge says merged", () => {
    expect(rowWords(heldOn("deployed"), merged).label).toBe("Not live yet")
    expect(rowWords(heldOn("merged"), merged)).toEqual({
      label: "Held on a condition",
      tone: "working",
      aside: "Merged — checkout still here",
    })
  })

  /** A wait on a project's own script has nothing to do with the branch, so the forge's
   *  answer never takes its row, whatever it says. */
  it("keeps the wait on a project's own condition ahead of every answer", () => {
    for (const { rung } of OUT) {
      expect(rowWords(heldOn("pr-merged"), rung)).toEqual({
        label: "Held on a condition",
        tone: "working",
        aside: rung.label,
      })
    }
  })

  /** Neither nothing is a claim about the branch, so a row must not move on one — a `gh`
   *  that is not installed would otherwise file every held trak under *Could not ask*. */
  it("leaves a waiting trak where it was when the forge could not be asked or has not answered", () => {
    for (const rung of [UNASKED, ASKING]) {
      expect(rowWords(heldOn("deployed"), rung).label).toBe("Not live yet")
      expect(rowWords(heldOn("merged"), rung)).toEqual({
        label: "Held on a condition",
        tone: "working",
        aside: rung.label,
      })
    }
  })

  it("reads the wait's name, never a stale answer on a row that is not waiting", () => {
    expect(onDeploy(makeTrak({ waiting: makeWaiting({ name: "deployed" }) }))).toBe(true)
    expect(onDeploy(makeTrak({ waiting: makeWaiting(), deploy: makeDeploy() }))).toBe(false)
    expect(onDeploy(makeTrak({ deploy: makeDeploy() }))).toBe(false)
    // Words as before where the wait is a project's own script.
    expect(
      rowWords(
        makeTrak({ state: { _tag: "Finished" }, waiting: makeWaiting(), deploy: makeDeploy() }),
        undefined,
      ).label,
    ).toBe("Held on a condition")
  })

  it("is never amber, and never moving", () => {
    // `waiting` the tone means a person owes an action; nobody owes a held trak anything.
    // And the segment travels for work happening on the branch, which a wait is not.
    expect(rowWords(makeTrak({ waiting: makeWaiting() }), undefined).tone).not.toBe("waiting")
    expect(rowMark(makeTrak({ waiting: makeWaiting() }), undefined)).toEqual({
      icon: "circleDashed",
      running: false,
    })
  })
})

/**
 * A wait that has stopped asking is read before either override, so neither the deploy's
 * answer nor `waitFirst` above ever sees one. Its aside rule is still the wait's: gone on
 * the deploy, the rung's words elsewhere.
 */
describe("rowWords — a wait that has given up", () => {
  /**
   * A wait that has stopped asking will never be asked again, so nothing is going to
   * start the held step — and the page's own deploy route goes on running the script,
   * so `live` is what the row's newest answer becomes once the deploy lands.
   * `test/e2e/deploy.test.ts` pins that pair on the wire. Read off the deploy alone the
   * row would draw the deploy that is about to release the step and the one that never
   * will in the same green, so the stop is read first.
   */
  it("does not read as a deploy about to release the step once the wait has stopped", () => {
    const stopped = makeTrak({
      state: { _tag: "Finished" },
      waiting: makeWaiting({ name: "deployed", stopped: true }),
      deploy: makeDeploy({ answer: "live" }),
    })
    const words = rowWords(stopped, merged)
    expect(words.label).not.toBe("Live")
    expect(words.tone).toBe("bad")
    expect(words).toEqual({ label: "Gave up", tone: "bad", aside: undefined })
  })

  /** The same wait in the same state on a project's own script: the stop is the fact,
   *  and the rung stays as the aside, as it does under *Held on a condition*. */
  it("says Gave up on any wait that has stopped asking, keeping the rung as the aside", () => {
    const stopped = makeTrak({
      state: { _tag: "Finished" },
      waiting: makeWaiting({ stopped: true }),
    })
    expect(rowWords(stopped, merged)).toEqual({
      label: "Gave up",
      tone: "bad",
      aside: "Merged — checkout still here",
    })
    expect(rowWords(stopped, undefined).aside).toBeUndefined()
  })

  /**
   * The pair the merge of #86 and this branch had to order, and neither side had a case
   * for. `waitFirst` gives the row to the forge on a wait for the branch going in,
   * because resolving the pull request is what lets the wait pass — and a wait that has
   * given up will not pass when it does. So the stop leads, and the forge's answer is the
   * aside wherever the deploy's own rule does not drop it.
   */
  it.each(OUT)("leads a branch wait over a pull request that is $what", ({ rung }) => {
    expect(rowWords(gaveUp("deployed"), rung)).toEqual({
      label: "Gave up",
      tone: "bad",
      aside: undefined,
    })
    expect(rowWords(gaveUp("merged"), rung)).toEqual({
      label: "Gave up",
      tone: "bad",
      aside: rung.label,
    })
  })
})

describe("waitFirst", () => {
  it("is false with no wait, true on a wait, and false only where the branch is out and the wait needs it in", () => {
    expect(waitFirst(makeTrak({ state: { _tag: "Finished" } }), conflicts)).toBe(false)
    expect(waitFirst(heldOn("pr-merged"), conflicts)).toBe(true)
    expect(waitFirst(heldOn("deployed"), undefined)).toBe(true)
    expect(waitFirst(heldOn("deployed"), merged)).toBe(true)
    expect(waitFirst(heldOn("deployed"), UNASKED)).toBe(true)
    expect(waitFirst(heldOn("deployed"), conflicts)).toBe(false)
    expect(waitFirst(heldOn("merged"), ready)).toBe(false)
  })
})

describe("rowMark", () => {
  it("wears the dashed ring while the wait leads, and the rung's mark where the pull request does", () => {
    const ring = { icon: "circleDashed", running: false }
    expect(rowMark(heldOn("deployed"), undefined)).toEqual(ring)
    expect(rowMark(heldOn("deployed"), merged)).toEqual(ring)
    expect(rowMark(heldOn("deployed"), ASKING)).toEqual(ring)
    const checking = pullRung(makePullRequestSummary({ checks: "running" }))
    expect(rowMark(heldOn("deployed"), checking)).toEqual({ icon: "shield", running: true })
    expect(rowMark(heldOn("pr-merged"), checking)).toEqual(ring)
  })
})

describe("a row whose trak is being prepared", () => {
  it("says the preparation in place of the state's phrase while the trak is being prepared", () => {
    const trak = makeTrak({
      state: { _tag: "Preparing" },
      running: true,
      preparing: { _tag: "Creating", runner: "Runs each trak in a sandbox." },
    })
    expect(rowWords(trak, undefined)).toEqual({
      label: "Creating a sandbox from the tools template",
      tone: "working",
      aside: undefined,
    })
  })

  it("keeps the state's phrase at every other state, with the preparation after it", () => {
    const working = makeTrak({
      state: { _tag: "AgentWorking", step: 1 },
      running: true,
      preparing: { _tag: "SetupBeside" },
    })
    expect(rowWords(working, undefined)).toEqual({
      label: "Working…",
      tone: "working",
      aside: "Setup still running",
    })
    // A gate a turn reached ahead of setup still says what the person owes first.
    const gate = makeTrak({
      state: { _tag: "AwaitingProposal" },
      preparing: { _tag: "SetupBeside" },
    })
    expect(rowWords(gate, undefined)).toMatchObject({
      label: "Plan needs approval",
      aside: "Setup still running",
    })
  })

  it("puts the action at the seam after the state's phrase, ahead of any preparation", () => {
    const stopping = makeTrak({
      state: { _tag: "Stopping", step: 1 },
      running: true,
      preparing: { _tag: "SetupBeside" },
      seam: {
        action: "stop",
        phase: "waiting",
        attempt: 1,
        since: 0,
        lastError: { kind: "lost", said: "ssh: connection refused" },
      },
    })
    expect(rowWords(stopping, undefined)).toEqual({
      label: "Stopping…",
      tone: "working",
      aside: "sandbox unreachable, trying again",
    })
  })

  it("says what it always said where nothing is being prepared", () => {
    expect(rowWords(makeTrak({ state: { _tag: "Preparing" }, running: true }), undefined)).toEqual({
      label: "Preparing the worktree",
      tone: "working",
      aside: undefined,
    })
  })
})
