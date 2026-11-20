/**
 * Tier 2: the sentence above the finished card and the presses below it, **asserted
 * together**.
 *
 * That pairing is the whole of what this file exists for, and it is why neither existing
 * test caught the failure it was written after. `finished.test.ts` covers the words with no
 * card on screen; `FinishedActs.test.tsx` covers the presses with the offers handed in as
 * props; neither knows about the other. So a change that moved the press onto one answer
 * and left the words on another passed both, and the trak page read *The checkout is held
 * until you merge it or say you are done* with no Merge button under it on every reload of
 * a finished trak that has a pull request.
 *
 * One case per answer `standingOf` can give, on a `Finished` trak — which is the one state
 * where a local merge is on offer at all, so it is the only state where the two can
 * disagree.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import {
  makeAgentStep,
  makeComposeEntry,
  makeComposerReturned,
  makeDeploy,
  makeDetail,
  makePlan,
  makePullRequest,
  makePullRequestSummary,
  makeWorkCommitted,
  makeWorktree,
} from "../../../fixtures"
import type { DeployDto, PullRequestDto, TrakDetailDto, WaitingDto } from "../../../api/types"
import FinishedView from "./FinishedView"
import { pullMergeOf, type Forge } from "../pull-request/pullRequest"
import type { Deploy } from "../deploy/useDeploy"
import type { Finishing } from "./useFinishing"

afterEach(cleanup)

const NOOP = { isPending: false, disabled: false, said: undefined }

/** Nothing asked about the deploy, which is every pane but the ones in the last table. */
const NO_DEPLOY: Deploy = { answer: undefined, checking: false, fetching: false }

const finishing = (forge: Forge, over: Partial<Finishing> = {}): Finishing => ({
  merge: { merge: () => {}, forget: () => {}, files: [], ...NOOP },
  pullMerging: { merge: () => {}, ...NOOP },
  commitAndMerge: { commit: () => {}, ...NOOP },
  skipping: { skip: () => {}, ...NOOP },
  autoMerge: { set: () => {}, ...NOOP },
  archiving: { archive: () => {}, ...NOOP },
  changes: { what: "", write: () => {}, send: () => {}, ...NOOP },
  preview: { branch: "trak/a", into: "main" },
  forge,
  pull: pullMergeOf(forge, undefined),
  methodPick: { pick: () => {}, picking: undefined, said: undefined },
  deploy: NO_DEPLOY,
  ...over,
})

const cold = (over: Partial<Forge>): Forge => ({
  pull: undefined,
  row: undefined,
  at: undefined,
  confirmed: false,
  fetching: false,
  ...over,
})

/**
 * `moved` defaults to a commit on the branch, which every case in the table below is about
 * — a trak whose work is on its branch is the only kind that has a local merge to withhold.
 *
 * Without one the pane is the other kind of ending altogether, and the case at the foot is
 * the one that pairs those three: no `gh` process is spent on a branch nobody pushed to, so
 * nothing is ever in hand, and a card drawn off *nothing in hand* would say it was checking
 * for as long as the drawer stayed open.
 */
const draw = (forge: Forge, moved = true): void => {
  render(
    <FinishedView
      phone={false}
      onOpenPull={undefined}
      trak={makeDetail({
        state: { _tag: "Finished" },
        worktree: makeWorktree(),
        log: moved ? [makeWorkCommitted({ step: 1, sha: "abc1234" })] : [makeWorkCommitted()],
      })}
      finishing={finishing(forge)}
      agents={[]}
    />,
  )
}

/** The press `FinishedActs` draws for a local merge, by the name a reader sees. */
const merges = (): boolean => screen.queryByRole("button", { name: /^Merge into/ }) !== null

const said = (pattern: RegExp): boolean => screen.queryByText(pattern) !== null

describe("the sentence and the press are one answer", () => {
  /**
   * The card drawn from the traks list's coarse answer — every reload of a finished trak
   * with a pull request, for the length of a `gh` call. It is the case the pairing broke on.
   */
  it("names no merge on a card built from the list's answer, where none is offered", () => {
    draw(cold({ row: { pull: makePullRequestSummary({ state: "open" }), at: 1 } }))
    expect(merges()).toBe(false)
    expect(said(/until you merge it/)).toBe(false)
    expect(said(/goes in on GitHub/)).toBe(true)
  })

  /** A remembered `merged`: the head of the card says Merged, so the paragraph above it
   *  must not say the work is still sitting on a branch. */
  it("says the work went in where the answer it remembers says merged", () => {
    draw(cold({ row: { pull: makePullRequestSummary({ state: "merged" }), at: 1 } }))
    expect(merges()).toBe(false)
    expect(said(/The work is in — it went in on GitHub\./)).toBe(true)
  })

  /** Nothing has come back. The press is withheld, so nothing may name one — and nothing
   *  may assert a pull request nobody has found either. */
  it("claims nothing about the checkout while it is still checking", () => {
    draw(cold({}))
    expect(merges()).toBe(false)
    expect(said(/The checkout is held/)).toBe(false)
    expect(said(/Checking GitHub for a pull request…/)).toBe(true)
  })

  /** The forge answered and there is none — the words a trak has always had, and the one
   *  case where naming the press is naming something on screen. */
  it("names the merge exactly where the merge is drawn", () => {
    const none: PullRequestDto = { _tag: "NoPullRequest" }
    draw(cold({ pull: none, confirmed: true, at: 1 }))
    expect(merges()).toBe(true)
    expect(said(/until you merge it/)).toBe(true)
  })

  /** *We could not ask* behaves as *there is none* here, deliberately: withholding the
   *  local merge whenever `gh` is missing would take it from everyone who uses no forge. */
  it("treats a forge it could not reach as no pull request, words and press together", () => {
    const why: PullRequestDto = { _tag: "ForgeUnavailable", why: "no gh" }
    draw(cold({ pull: why, confirmed: true, at: 1 }))
    expect(merges()).toBe(true)
    expect(said(/until you merge it/)).toBe(true)
  })

  /** And the whole answer, which is the case that always worked — here so the four are
   *  one table rather than three plus the one that was broken. */
  it("reads the whole answer the same way it reads the coarse one", () => {
    draw(cold({ pull: makePullRequest({ state: "open" }), confirmed: true, at: 1 }))
    expect(merges()).toBe(false)
    expect(said(/goes in on GitHub/)).toBe(true)
  })

  /**
   * The one case where nothing in hand is not *still checking*. `finishingLive` withholds
   * both of the pane's outside questions for a branch with no commits, so this forge stays
   * empty for as long as the drawer is open — and a card read off that emptiness would sit
   * under a strip saying it was checking GitHub, forever, on a pane waiting for nothing.
   */
  it("draws no card and claims no check on a branch nothing was committed to", () => {
    draw(cold({}), false)
    expect(said(/Checking GitHub for a pull request…/)).toBe(false)
    expect(said(/The work is complete\. Nothing to merge\./)).toBe(true)
    expect(merges()).toBe(false)
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeNull()
  })
})

/**
 * A trak resting on an unmet condition: the same ending with one block under the card,
 * and Archive no longer the loud press. The post-merge case throughout, because it is the
 * one the wait exists for and the one where the ending would otherwise read as done.
 */
const held: WaitingDto = { step: 2, name: "pr-merged", stopped: false }

const drawHeld = (waiting: WaitingDto | undefined, nextAsk: number | undefined): void => {
  render(
    <FinishedView
      phone={false}
      onOpenPull={undefined}
      trak={makeDetail({
        state: { _tag: "Finished" },
        worktree: makeWorktree(),
        plan: makePlan({
          steps: [
            makeComposeEntry(),
            makeAgentStep({ agent: "builder", instruction: "build the drawer" }),
            makeAgentStep({ agent: "asana", instruction: "move the task to Done" }),
          ],
        }),
        log: [makeWorkCommitted({ step: 1, sha: "abc1234" })],
        ...(waiting === undefined ? {} : { waiting }),
        ...(nextAsk === undefined ? {} : { nextAsk }),
      })}
      finishing={finishing(
        cold({ row: { pull: makePullRequestSummary({ state: "merged" }), at: 1 } }),
      )}
      agents={[]}
    />,
  )
}

describe("the pull request's merge press", () => {
  it("draws it disabled where GitHub blocks it, and live on GitHub's word with a check failing", () => {
    draw(
      cold({
        pull: makePullRequest({
          mergeMethod: "squash",
          mergeVerdict: { _tag: "Blocked", holds: [{ cause: "rule" }] },
        }),
      }),
    )
    expect(screen.getByRole("button", { name: "Squash and merge" })).toHaveProperty(
      "disabled",
      true,
    )
    expect(merges()).toBe(false)
    cleanup()

    draw(cold({ pull: makePullRequest({ rollup: "failed", mergeMethod: "squash" }) }))
    expect(screen.getByRole("button", { name: "Squash and merge" })).toHaveProperty(
      "disabled",
      false,
    )
  })

  /** The coarse card names no method, so the cell holds the ghost until the pane's own read. */
  it("holds the ghost on a card built from the list's answer", () => {
    draw(cold({ row: { pull: makePullRequestSummary({ state: "open" }), at: 1 } }))
    expect(screen.getByRole("button", { name: "Checking GitHub…" })).toBeDefined()
  })

  it("gives way to the loud Archive once the forge says merged", () => {
    draw(cold({ pull: makePullRequest({ state: "merged", mergeMethod: "squash" }) }))
    expect(screen.queryByRole("button", { name: "Squash and merge" })).toBeNull()
    expect(screen.getByRole("button", { name: "Archive" })).toBeDefined()
  })
})

describe("a step held behind a condition", () => {
  it("names the condition, its state and the next ask under an unchanged ending", () => {
    drawHeld(held, Date.now() + 221_000)

    const block = screen.getByRole("region", { name: "Waiting on a condition" })
    expect(within(block).getByText("pr-merged")).toBeDefined()
    expect(within(block).getByText("is not met yet")).toBeDefined()
    expect(within(block).getByText("next ask")).toBeDefined()
    expect(within(block).getByText(/^3m \d\ds$/)).toBeDefined()
    expect(within(block).getByText("holds step 2 of 2")).toBeDefined()
    expect(within(block).getByText("move the task to Done")).toBeDefined()
    // The ending above it is the one a merged trak has always had.
    expect(said(/The work is in — it went in on GitHub\./)).toBe(true)
  })

  it("demotes Archive behind the overflow, where a merged trak promotes it", () => {
    drawHeld(held, Date.now() + 221_000)
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull()
    expect(screen.getByRole("button", { name: "More endings" })).toBeDefined()
  })

  /** Between a restart and the first sweep the daemon has no next ask to report, so no
   *  countdown is drawn — not an empty corner block, and not a number made up. */
  it("draws no countdown where nothing is scheduled", () => {
    drawHeld(held, undefined)
    const block = screen.getByRole("region", { name: "Waiting on a condition" })
    expect(within(block).queryByText("next ask")).toBeNull()
    expect(within(block).getByText("is not met yet")).toBeDefined()
  })

  it("says a stopped condition gave up, in the bad tone, and what that costs", () => {
    drawHeld({ ...held, stopped: true }, undefined)
    const block = screen.getByRole("region", { name: "Waiting on a condition" })
    const stop = within(block).getByText("gave up — will not be asked again")
    expect(stop).toHaveClass("text-tone-bad")
    expect(within(block).getByText("step 2 of 2 will not run")).toBeDefined()
    expect(within(block).getByText("archiving drops it")).toBeDefined()
    expect(within(block).queryByText("next ask")).toBeNull()
  })

  it("draws no block at all on a trak holding nothing", () => {
    drawHeld(undefined, undefined)
    expect(screen.queryByRole("region", { name: "Waiting on a condition" })).toBeNull()
    expect(screen.getByRole("button", { name: "Archive" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Skip the wait" })).toBeNull()
  })

  /**
   * The press belongs to the wait: it is in the block, drawn on every kind of wait, and it
   * is the only way out of one that has given up. It is the finished pane's one press that
   * spends, so it is wired as the endings are — refused while disabled, and its refusal
   * read back where it was pressed.
   */
  it("offers to skip the wait in the block, on a live wait and on one that gave up", () => {
    drawHeld(held, Date.now() + 221_000)
    const block = screen.getByRole("region", { name: "Waiting on a condition" })
    expect(within(block).getByRole("button", { name: "Skip the wait" })).toBeDefined()
    cleanup()

    drawHeld({ ...held, stopped: true }, undefined)
    const dead = screen.getByRole("region", { name: "Waiting on a condition" })
    expect(within(dead).getByRole("button", { name: "Skip the wait" })).toBeDefined()
  })

  it("presses the skip through the hook, and reads its refusal back in the block", () => {
    const pressed = vi.fn<() => void>()
    render(
      <FinishedView
        phone={false}
        onOpenPull={undefined}
        trak={makeDetail({
          state: { _tag: "Finished" },
          worktree: makeWorktree(),
          log: [makeWorkCommitted({ step: 1, sha: "abc1234" })],
          waiting: held,
        })}
        finishing={{
          ...finishing(cold({ row: { pull: makePullRequestSummary({ state: "merged" }), at: 1 } })),
          skipping: {
            skip: pressed,
            isPending: false,
            disabled: false,
            said: "Nothing is holding that trak, so there is no wait to skip.",
          },
        }}
        agents={[]}
      />,
    )
    const block = screen.getByRole("region", { name: "Waiting on a condition" })
    fireEvent.click(within(block).getByRole("button", { name: "Skip the wait" }))
    expect(pressed).toHaveBeenCalledOnce()
    expect(within(block).getByRole("alert").textContent).toMatch(/no wait to skip/)
  })
})

/**
 * A trak resting on a clock: the block keeps its shape and changes its words — the instant
 * where the script name goes, a phrase about when the step runs, a corner labelled for a
 * start — and an instant behind us drops the corner and says so in the head line.
 */
describe("a step held on a clock", () => {
  const drawClock = (until: number): void => {
    render(
      <FinishedView
        phone={false}
        onOpenPull={undefined}
        trak={makeDetail({
          state: { _tag: "Finished" },
          worktree: makeWorktree(),
          plan: makePlan({
            steps: [
              makeComposeEntry(),
              makeAgentStep({ agent: "builder", instruction: "build the drawer" }),
              makeAgentStep({ agent: "verify-nightly", instruction: "check last night's run" }),
            ],
          }),
          log: [makeWorkCommitted({ step: 1, sha: "abc1234" })],
          waiting: { step: 2, name: "wait_until", stopped: false, until },
          nextAsk: until,
        })}
        finishing={finishing(
          cold({ row: { pull: makePullRequestSummary({ state: "merged" }), at: 1 } }),
        )}
        agents={[]}
      />,
    )
  }

  it("draws the instant, when the step runs, and a countdown to the start", () => {
    drawClock(Date.now() + 2 * 3600_000 + 221_000)

    const block = screen.getByRole("region", { name: "Waiting on a time" })
    expect(within(block).getByText("is when the step runs")).toBeDefined()
    expect(within(block).getByText("starts in")).toBeDefined()
    expect(within(block).getByText(/^2h \d\dm$/)).toBeDefined()
    expect(within(block).getByText("holds step 2 of 2")).toBeDefined()
    expect(within(block).getByRole("button", { name: "Skip the wait" })).toBeDefined()
    // None of a condition's words: nothing is asked of a clock.
    expect(within(block).queryByText("next ask")).toBeNull()
    expect(within(block).queryByText("wait_until")).toBeNull()
    expect(within(block).queryByText(/met/)).toBeNull()
  })

  it("drops the countdown once the instant has passed and says so in the head line", () => {
    drawClock(Date.now() - 3 * 60_000)

    const block = screen.getByRole("region", { name: "Waiting on a time" })
    expect(within(block).getByText("has passed — the step runs on the next sweep")).toBeDefined()
    expect(within(block).queryByText("starts in")).toBeNull()
    expect(within(block).getByRole("button", { name: "Skip the wait" })).toBeDefined()
  })
})

/** A plan with two steps behind the deploy: the held one and one more. */
const deployPlan = makePlan({
  steps: [
    makeComposeEntry(),
    makeAgentStep({ agent: "builder", instruction: "build the drawer" }),
    makeAgentStep({ agent: "verify-prod", instruction: "check the answers page" }),
    makeAgentStep({ agent: "announce", instruction: "post what shipped" }),
  ],
})
const onDeploy: WaitingDto = { step: 2, name: "deployed", stopped: false }
/** An answer in hand, and no fetch out over it. */
const heard = (answer: DeployDto): Deploy => ({ answer, checking: false, fetching: false })

const drawDeploy = (
  over: Parameters<typeof makeDetail>[0],
  deploy: Deploy,
  forge: Forge = cold({ row: { pull: makePullRequestSummary({ state: "merged" }), at: 1 } }),
): void => {
  render(
    <FinishedView
      phone={false}
      onOpenPull={undefined}
      trak={makeDetail({
        state: { _tag: "Finished" },
        worktree: makeWorktree(),
        plan: deployPlan,
        log: [makeWorkCommitted({ step: 1, sha: "abc1234" })],
        ...over,
      })}
      finishing={finishing(forge, { deploy })}
      agents={[]}
    />,
  )
}

const deployBlock = (): HTMLElement => screen.getByRole("region", { name: "Deploy" })

/**
 * The deploy block: one block above the ending card wherever there is a merge commit to
 * ask about, leading with the answer and holding the steps that wait on it.
 */
describe("the deploy block", () => {
  it("leads with the answer and the version, then the rows, then the steps it holds", () => {
    drawDeploy(
      { landed: { sha: "8c41d0e" }, waiting: onDeploy, nextAsk: Date.now() + 74_000 },
      heard(
        makeDeploy({
          url: "https://dashboard.render.com/web/srv-1/deploys/dep-2",
          text: "fetched 3 deploys",
          at: Date.now() - 60_000,
        }),
      ),
    )
    const deploy = deployBlock()
    expect(within(deploy).getByText("Not live yet")).toBeDefined()
    expect(within(deploy).getByText("v2026.09.10-3")).toBeDefined()
    expect(within(deploy).getByText("building, 6m in")).toBeDefined()
    expect(
      within(deploy).getByRole("link", { name: /dashboard\.render\.com\/web\/srv-1/ }),
    ).toHaveAttribute("href", "https://dashboard.render.com/web/srv-1/deploys/dep-2")
    expect(within(deploy).getByText("1 minute ago")).toBeDefined()
    expect(within(deploy).getByText("fetched 3 deploys")).toBeDefined()
    expect(within(deploy).getByText("next ask")).toBeDefined()
    // The press is the held card's, drawn here because this block stands in for it.
    expect(within(deploy).getByRole("button", { name: "Skip the wait" })).toBeDefined()
    expect(within(deploy).getByText(/^1m \d\ds$/)).toBeDefined()
    // The held step and the one behind it, as the proposal card numbers them, and no
    // status word on either — the section head says what they are to the deploy.
    const steps = within(deploy).getByRole("region", { name: "Waiting on this deploy" })
    expect(within(steps).getByText("deployed")).toBeDefined()
    expect(within(steps).getAllByRole("listitem")).toHaveLength(2)
    expect(within(steps).getByText("check the answers page")).toBeDefined()
    expect(within(steps).getByText("post what shipped")).toBeDefined()
    expect(within(steps).queryByText("held")).toBeNull()
    // And one block, not two: the held card is not drawn under the ending.
    expect(screen.queryByRole("region", { name: "Waiting on a condition" })).toBeNull()
  })

  it("hides the leftover output behind its own press, and never where it is the whole answer", () => {
    drawDeploy(
      { landed: { sha: "8c41d0e" } },
      heard(makeDeploy({ answer: "live", text: "fetched 3 deploys" })),
    )
    fireEvent.click(within(deployBlock()).getByRole("button", { name: "hide output" }))
    expect(within(deployBlock()).queryByText("fetched 3 deploys")).toBeNull()
    fireEvent.click(within(deployBlock()).getByRole("button", { name: "show output" }))
    expect(within(deployBlock()).getByText("fetched 3 deploys")).toBeDefined()
    cleanup()

    drawDeploy(
      { landed: { sha: "8c41d0e" } },
      heard({ answer: "live", text: "8c41d0e is live on production", at: 1 }),
    )
    expect(within(deployBlock()).getByText("8c41d0e is live on production")).toBeDefined()
    expect(within(deployBlock()).queryByRole("button", { name: /output/ })).toBeNull()
  })

  it("says Gave up in the bad tone, and what the stop costs, on a deploy that gave up", () => {
    drawDeploy(
      { landed: { sha: "8c41d0e" }, waiting: { ...onDeploy, stopped: true } },
      heard(makeDeploy({ answer: "gave-up", detail: "health check timed out" })),
    )
    expect(within(deployBlock()).getByText("Gave up")).toHaveClass("text-tone-bad")
    expect(within(deployBlock()).getByText("health check timed out")).toBeDefined()
    expect(
      within(deployBlock()).getByText("deployed · stopped asking · archiving drops them"),
    ).toBeDefined()
    expect(within(deployBlock()).queryByText("next ask")).toBeNull()
  })

  /**
   * The sweep drops a stopped wait, but the page's own route goes on running the script,
   * so once the release lands the wire carries a stopped wait beside a `live` answer —
   * `test/e2e/deploy.test.ts` pins the pair. Nothing will start the held step, so the
   * head leads with the stop rather than with a green *Live*, as the list row does.
   */
  it("does not lead with Live once the wait has stopped asking, even where the deploy is live", () => {
    drawDeploy(
      { landed: { sha: "8c41d0e" }, waiting: { ...onDeploy, stopped: true } },
      heard(
        makeDeploy({ answer: "live", url: "https://app.example/", detail: "4 of 4 on 8c41d0e" }),
      ),
    )
    expect(within(deployBlock()).queryByText("Live")).toBeNull()
    expect(within(deployBlock()).getByText("Gave up")).toHaveClass("text-tone-bad")
    // The deploy's own facts are still there under it: the stop beats the word, not the rows.
    expect(within(deployBlock()).getByText("4 of 4 on 8c41d0e")).toBeDefined()
    expect(within(deployBlock()).getByRole("link", { name: /app\.example/ })).toBeDefined()
    expect(within(deployBlock()).queryByText("next ask")).toBeNull()
    expect(within(deployBlock()).getByRole("button", { name: "Skip the wait" })).toBeDefined()
  })

  /** A Merged trak has no steps waiting and no countdown: the block is the deploy alone. */
  it("is the deploy's record alone on a trak whose checkout has gone", () => {
    drawDeploy(
      { state: { _tag: "Merged", sha: "8c41d0e" } },
      heard(makeDeploy({ answer: "live", detail: "4 of 4 instances on 8c41d0e" })),
      cold({}),
    )
    expect(within(deployBlock()).getByText("Live")).toHaveClass("text-tone-good")
    expect(within(deployBlock()).getByText("4 of 4 instances on 8c41d0e")).toBeDefined()
    expect(screen.queryByRole("region", { name: "Waiting on this deploy" })).toBeNull()
    expect(within(deployBlock()).queryByText("next ask")).toBeNull()
    expect(within(deployBlock()).queryByRole("button", { name: "Skip the wait" })).toBeNull()
  })
})

/**
 * What the block replaces and what it takes away: the held card while the wait is the
 * deploy's, and the local Merge press once the branch has landed.
 */
describe("the deploy, the held card and the press", () => {
  /** The pull request card's loading line, in the block's head, before the route answers. */
  it("holds the head's space with the checking line before the first answer", () => {
    drawDeploy(
      { landed: { sha: "8c41d0e" } },
      { answer: undefined, checking: true, fetching: true },
    )
    expect(
      within(deployBlock()).getByText("Asking deploy.sh about the merge commit…"),
    ).toBeDefined()
    expect(within(deployBlock()).queryByText("Not live yet")).toBeNull()
  })

  /** The wait is the deploy's, and the branch has not merged: the block stands with its
   *  steps and its countdown, saying only what is true of a deploy nobody has asked about. */
  it("draws the block with no rows while the wait is the deploy's and nothing has run", () => {
    drawDeploy({ waiting: onDeploy, nextAsk: Date.now() + 74_000 }, NO_DEPLOY)
    expect(within(deployBlock()).getByText("Not live yet")).toBeDefined()
    expect(within(deployBlock()).queryByText("Last asked")).toBeNull()
    expect(within(deployBlock()).getByText("next ask")).toBeDefined()
    expect(within(deployBlock()).getByText("check the answers page")).toBeDefined()
    expect(screen.queryByRole("region", { name: "Waiting on a condition" })).toBeNull()
  })

  it("draws nothing for a trak with no deploy, and keeps the held card for any other wait", () => {
    drawDeploy(
      { landed: { sha: "8c41d0e" }, waiting: { ...onDeploy, name: "smoke-passed" } },
      heard({ answer: "none" }),
    )
    expect(screen.queryByRole("region", { name: "Deploy" })).toBeNull()
    expect(screen.getByRole("region", { name: "Waiting on a condition" })).toBeDefined()
  })

  /**
   * The one press a landing takes away. The forge has not answered here — a merge made from
   * this machine while the wait was pending is exactly the case the forge knows nothing
   * about — so every other reading of this pane would offer the local Merge.
   */
  it("offers no local Merge once the branch has landed, whatever the forge says", () => {
    drawDeploy(
      { landed: { sha: "8c41d0e" } },
      heard({ answer: "none" }),
      cold({ pull: { _tag: "NoPullRequest" }, confirmed: true, at: 1 }),
    )
    expect(merges()).toBe(false)
    cleanup()
    drawDeploy({}, NO_DEPLOY, cold({ pull: { _tag: "NoPullRequest" }, confirmed: true, at: 1 }))
    expect(merges()).toBe(true)
  })
})

/**
 * A child's message to its parent, printed whole at the foot — and absent, not empty, on
 * every trak whose composer handed nothing up.
 */
describe("what the composer handed up", () => {
  const drawEnded = (handUp: string | undefined): void => {
    render(
      <FinishedView
        phone={false}
        onOpenPull={undefined}
        trak={makeDetail({
          state: { _tag: "Merged", sha: "9f31c07" },
          worktree: makeWorktree(),
          log: [
            makeWorkCommitted({ step: 1, sha: "abc1234" }),
            makeComposerReturned({ output: { type: "finished", reason: "done", handUp } }),
          ],
        })}
        finishing={finishing(cold({}))}
        agents={[]}
      />,
    )
  }

  it("prints the hand-up whole, under its own heading", () => {
    drawEnded("The icons need building before the header can be laid out.")
    const block = screen.getByRole("region", { name: "Work for the parent" })
    expect(block.textContent).toContain(
      "The icons need building before the header can be laid out.",
    )
  })

  it("draws nothing where there is none", () => {
    drawEnded(undefined)
    expect(screen.queryByRole("region", { name: "Work for the parent" })).toBeNull()
  })
})

/**
 * A merge that did not go in, on the pane: the card and its Merge press are kept, the
 * refusal is a plate between the sentence and the card, and the press through a dirty
 * parent is on the plate. `mergeRefusal.test.ts` covers which words; this covers that
 * they land on this pane, together with the presses, and that the band does not repeat
 * them.
 */
describe("a merge that did not go in", () => {
  const none: PullRequestDto = { _tag: "NoPullRequest" }
  const answered = cold({ pull: none, confirmed: true, at: 1 })
  const child = { branch: "trak/a", parentId: "blank-white-booby" }
  const SAID = [
    "merge: git merge --no-ff trak/a exited 2: error: Your local changes to the following files would be overwritten by merge:",
    "\tshared.md",
    "Aborting",
  ].join("\n")

  const drawRefused = (
    over: Partial<Finishing>,
    state: TrakDetailDto["state"] = { _tag: "Finished" },
  ) => {
    render(
      <FinishedView
        phone={false}
        onOpenPull={undefined}
        trak={makeDetail({
          state,
          worktree: makeWorktree(),
          log: [makeWorkCommitted({ step: 1, sha: "abc1234" })],
        })}
        finishing={finishing(answered, over)}
        agents={[]}
      />,
    )
  }

  it("keeps the card and the Merge press at a merge git refused, with git's words above", () => {
    drawRefused({ preview: child }, { _tag: "Failed", kind: "merge", error: SAID })

    expect(screen.getByText("the merge was refused")).toBeDefined()
    expect(screen.getByText(/Your local changes to the following files/)).toBeDefined()
    expect(screen.getByText(/The plan ran out and the work is on its branch/)).toBeDefined()
    expect(screen.getByRole("button", { name: "Merge into its parent" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Commit blank-white-booby and merge" })).toBeDefined()
    // The refusal is between the sentence and the card, not in the band under it.
    const shown = document.body.textContent
    expect(shown.indexOf("the merge was refused")).toBeLessThan(shown.indexOf("1 commit"))
  })

  it("plates a child's dirty refusal with its files once, and not again in the band", () => {
    const commit = vi.fn<() => void>()
    drawRefused({
      preview: child,
      merge: {
        merge: () => {},
        forget: () => {},
        files: ["src/a.ts", "docs/b.md"],
        ...NOOP,
        said: "dirty",
      },
      commitAndMerge: { commit, ...NOOP },
    })

    expect(screen.getAllByText(/a\.ts/)).toHaveLength(1)
    expect(screen.queryByText("dirty")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Commit blank-white-booby and merge" }))
    expect(commit).toHaveBeenCalledOnce()
  })

  /** The host repository keeps its refusal at the press: nothing commits a person's own tree. */
  it("leaves a dirty host checkout's refusal in the band, with no commit press", () => {
    drawRefused({
      merge: { merge: () => {}, forget: () => {}, files: ["src/a.ts"], ...NOOP, said: "dirty" },
    })

    expect(screen.getByText("dirty")).toBeDefined()
    expect(screen.queryByText("the merge was refused")).toBeNull()
    expect(screen.queryByRole("button", { name: /^Commit / })).toBeNull()
  })

  /**
   * The commit press's declined exit: the Merge press has forgotten its files by then
   * (`useCommitAndMerge`), so what the pane is handed is the failure alone, and it draws
   * git's newer words rather than a list of files that were just committed. A conflict is
   * not this exit — it recomposes, and `useCommitAndMerge` records why.
   */
  it("draws git's second refusal after the commit press, not the file list it cleared", () => {
    const declined =
      "check checkout branch: /w/blank-white-booby is on main, not trak/blank-white-booby: whatever was committed there is not on the trak's branch, so nothing here can tell work from an empty branch. The checkout is kept — move or merge the commits onto trak/blank-white-booby and retry."
    drawRefused({ preview: child }, { _tag: "Failed", kind: "merge", error: declined })

    expect(screen.getByText(/is on main, not trak\/blank-white-booby/)).toBeDefined()
    expect(screen.queryByText(/uncommitted work there/)).toBeNull()
    expect(screen.getByRole("button", { name: "Commit blank-white-booby and merge" })).toBeDefined()
  })

  it("draws no commit press for a failed merge at the top, whose tree is a person's own", () => {
    drawRefused({}, { _tag: "Failed", kind: "merge", error: SAID })

    expect(screen.getByText("the merge was refused")).toBeDefined()
    expect(screen.getByRole("button", { name: "Merge into main" })).toBeDefined()
    expect(screen.queryByRole("button", { name: /^Commit / })).toBeNull()
  })
})
