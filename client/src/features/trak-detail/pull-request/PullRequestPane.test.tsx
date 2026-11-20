/**
 * What the pull-request half draws, at each state it has to hold.
 *
 * Rendered bare rather than through a route: the forge's answer is the whole input, and the
 * ticks are a callback out. `pullRequest.test.ts` decides the words each section says;
 * this decides what is on screen, what is shut, and what is deliberately absent.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  makePullRequest,
  makePullRequestCheck,
  makePullRequestComment,
  makeReview,
  makeReviewThread,
} from "../../../fixtures"
import type { PullRequestCommentDto, PullRequestDto } from "../../../api/types"
import type { Picked } from "./picks/reentryBody"
import { pickAll, togglePick } from "./picks/reentryBody"
import type { Forge } from "./pullRequest"
import PullRequestPane from "./PullRequestPane"

afterEach(cleanup)

/**
 * An answer confirmed this session — the state nearly every case below is about, since a
 * card's words are the same whether or not anybody has confirmed it and only its tone moves.
 */
const forge = (pull: PullRequestDto | undefined, over: Partial<Forge> = {}): Forge => ({
  pull,
  row: over.row,
  // Whichever of the two is drawn is what the synced line is about, which is the rule the
  // hook composes by — a builder that stamped one regardless would draw a line on a card
  // that has nothing in hand.
  at: pull === undefined ? over.row?.at : NOW,
  confirmed: pull !== undefined,
  fetching: false,
  ...over,
})

/** Measured against the clock the pane reads, since what it renders is a distance from it
 *  rather than a date — a frozen stamp would drift into *3 hours ago* as the file ages. */
const NOW = Date.now()

const draw = (
  pull: PullRequestDto | undefined,
  picked: readonly Picked[] = [],
  phone = false,
): Picked[] => {
  const ticked: Picked[] = []
  render(
    <PullRequestPane
      forge={forge(pull)}
      picked={picked}
      onToggle={(item) => {
        ticked.push(item)
      }}
      onToggleAll={(items) => {
        ticked.push(...items)
      }}
      phone={phone}
      onOpen={undefined}
    />,
  )
  return ticked
}

/**
 * The pane wired to its own picked list, which is what `FinishedView` does.
 *
 * `draw` above hands a fixed list and reports the ticks out, which is enough for what one
 * tick carries. Anything about *which* rows a tick lands on needs the list to move, because
 * the collisions this guards against show up as a second row drawing ticked.
 */
const Live = ({ pull }: { readonly pull: PullRequestDto }): ReactNode => {
  const [picked, setPicked] = useState<readonly Picked[]>([])
  return (
    <PullRequestPane
      forge={forge(pull)}
      picked={picked}
      onToggle={(item) => {
        setPicked((held) => togglePick(held, item))
      }}
      onToggleAll={(items) => {
        setPicked((held) => pickAll(held, items))
      }}
      phone={false}
      onOpen={undefined}
    />
  )
}

const checked = (name: string | RegExp): readonly boolean[] =>
  screen.getAllByRole<HTMLInputElement>("checkbox", { name }).map((box) => box.checked)

/** Tick the nth of several rows a fixture deliberately named alike. */
const tickAt = (name: string | RegExp, at: number): void => {
  const box = screen.getAllByRole("checkbox", { name })[at]
  if (box === undefined) throw new Error(`no checkbox named ${String(name)} at ${String(at)}`)
  fireEvent.click(box)
}

/** One conversation, opened by `alice` — so the label its tick wears is hers. */
const aliceSaid = (body: string) =>
  makeReviewThread({ comments: [makePullRequestComment({ who: "alice", body })] })

/** A conversation nobody has said anything in — the one thing on the pane with no permalink
 *  of its own, so it is what the fallback key is about. */
const emptyThread = () => makeReviewThread({ comments: [] })

describe("what draws nothing at all", () => {
  /**
   * A forge that could not be asked says *nothing to say* rather than showing an error, and
   * it is the same silence as a branch with no pull request — which is what leaves the local
   * Merge press behaving exactly as it does on any other trak.
   */
  it.each([
    ["no pull request", { _tag: "NoPullRequest" } as const],
    ["a forge that could not be asked", { _tag: "ForgeUnavailable", why: "no gh" } as const],
  ])("draws no block for %s", (_name, pull) => {
    const { container } = render(
      <PullRequestPane
        forge={forge(pull)}
        picked={[]}
        onToggle={() => {}}
        onToggleAll={() => {}}
        phone={false}
        onOpen={undefined}
      />,
    )
    expect(container.textContent).toBe("")
  })

  /**
   * **An answer still on its way is not one of those two, and it used to be.** Drawing
   * nothing there meant the card appeared under the reader a moment later and the merge
   * press re-parented beneath it, on every load of a finished trak. A line in the head's
   * place is the same claim without the jump.
   */
  it("says it is still looking while nothing at all is known", () => {
    render(
      <PullRequestPane
        forge={forge(undefined)}
        picked={[]}
        onToggle={() => {}}
        onToggleAll={() => {}}
        phone={false}
        onOpen={undefined}
      />,
    )
    expect(screen.getByText("Checking GitHub for a pull request…")).toBeInTheDocument()
  })
})

describe("a card nobody has confirmed this session", () => {
  const summary = {
    number: 412,
    title: "Remember what GitHub said",
    url: "https://github.com/o/r/pull/412",
    state: "open",
    isDraft: false,
    merging: "clean",
    decision: "changesRequested",
    checks: "failed",
  } as const

  /**
   * The state a reload lands in when the traks list's cheap answer is all there is: the
   * head is real, all three verdicts are said, and the rows of two of them are still coming.
   */
  it("draws the head and three verdicts from the traks list's answer alone", () => {
    render(
      <PullRequestPane
        forge={forge(undefined, { row: { pull: summary, at: NOW - 34 * 60_000 } })}
        picked={[]}
        onToggle={() => {}}
        onToggleAll={() => {}}
        phone={false}
        onOpen={undefined}
      />,
    )
    expect(screen.getByRole("heading", { name: /Remember what GitHub said/ })).toBeInTheDocument()
    // The coarse word, not the count the whole answer would give — and not *No checks have
    // run*, which is what an empty list of checks would have said about a failing branch.
    expect(screen.getByText("Some checks are failing")).toBeInTheDocument()
    expect(screen.getByText("Changes requested")).toBeInTheDocument()
    // Merging is complete the moment the card appears: it reads three fields this answer
    // already carries, so nothing about it changes when the detail lands.
    expect(screen.getByText("No conflicts, and up to date with its base")).toBeInTheDocument()
    expect(screen.getByText("From an earlier answer, 34 minutes ago")).toBeInTheDocument()
  })

  /** A remembered answer says there is no pull request, which rules one out — no card, and
   *  the local Merge press left alone. That is what `cardOf` answers `none` for. */
  it("draws nothing where what it remembers is that there is no pull request", () => {
    const { container } = render(
      <PullRequestPane
        forge={forge(undefined, { row: { pull: undefined, at: NOW } })}
        picked={[]}
        onToggle={() => {}}
        onToggleAll={() => {}}
        phone={false}
        onOpen={undefined}
      />,
    )
    expect(container.textContent).toBe("")
  })

  /** Every word is the same as a confirmed card's — what is withheld is the colour, and the
   *  line under the title is what says so out loud. */
  it("keeps a remembered card's words and says when it was last synced", () => {
    render(
      <PullRequestPane
        forge={{
          pull: makePullRequest({ title: "An hour-old card" }),
          row: undefined,
          at: NOW - 20 * 60_000,
          confirmed: false,
          fetching: true,
        }}
        picked={[]}
        onToggle={() => {}}
        onToggleAll={() => {}}
        phone={false}
        onOpen={undefined}
      />,
    )
    expect(screen.getByText("Synced 20 minutes ago · rechecking")).toBeInTheDocument()
  })
})

describe("the three sections", () => {
  /** Each owns its own state and its own words. Nothing on this pane adds them up, which is
   *  what this case is asserting the absence of. */
  it("each says its own thing, and nothing says one thing about the three", () => {
    draw(
      makePullRequest({
        merging: "conflicting",
        decision: "changesRequested",
        checks: [
          makePullRequestCheck(),
          makePullRequestCheck({ name: "build", verdict: "passed" }),
        ],
        reviews: [makeReview({ threads: [makeReviewThread()] })],
      }),
    )

    expect(screen.getByText("1 failing of 2")).toBeDefined()
    expect(screen.getByText("Changes requested · 1 unanswered")).toBeDefined()
    expect(screen.getByText("GitHub sees conflicts to resolve")).toBeDefined()
    // Three labels in the card's left column, and no fourth thing standing over them —
    // shortest first, so the one row with no ceiling is the last thing before the presses.
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual([
      "Merging",
      "Checks",
      "Review",
    ])
  })
})

describe("checks", () => {
  const MIXED = makePullRequest({
    checks: [
      makePullRequestCheck({ name: "verify" }),
      makePullRequestCheck({ name: "build", verdict: "passed", url: undefined }),
      makePullRequestCheck({ name: "e2e", verdict: "running", url: undefined }),
      makePullRequestCheck({ name: "lint", verdict: "skipped", url: undefined }),
      makePullRequestCheck({ name: "codeql", verdict: "unknown", url: undefined }),
    ],
  })

  /** Its name, when it failed and a link out — and never the transcript, which would cost a
   *  second call to the forge per failing check. */
  it("shows a failing check's name, when it failed and a link — and no output", () => {
    vi.setSystemTime(new Date(61_000))
    draw(makePullRequest({ checks: [makePullRequestCheck({ at: 1_000 })] }))

    expect(screen.getByText("verify")).toBeDefined()
    expect(screen.getByText("1m 0s ago")).toBeDefined()
    // The link is a glyph rather than words on a card this small, so its accessible name is
    // the whole of what says where it goes.
    expect(
      screen.getByRole("link", { name: "Open the verify run on GitHub" }).getAttribute("href"),
    ).toBe("https://github.com/o/r/actions/runs/9")
    vi.useRealTimers()
  })

  /**
   * The section's own verdict is the press that opens the grid of everything that is not
   * failing, so the rest wait behind the words the section already says about itself.
   */
  it("folds everything that is not failing behind the section's own verdict", () => {
    draw(MIXED)

    const fold = screen.getByRole("button", { name: "1 failing of 5" })
    expect(fold.getAttribute("aria-expanded")).toBe("false")
    expect(screen.getByText("verify")).toBeDefined()
    expect(screen.queryByText("codeql")).toBeNull()
  })

  /**
   * With nothing failing the counted verdicts are the verdict, said once. *All passing*
   * would be asserting something the wire never said — the forge's rollup mixes skipped,
   * queued and unrecognised nodes in with the green ones — and the same count printed as a
   * verdict and again as a fold summary an inch under it is what this replaces.
   */
  it("is one line when nothing is failing: the counted verdicts, printed once, as the press", () => {
    draw(makePullRequest({ checks: MIXED.checks.filter((check) => check.verdict !== "failed") }))

    const counted = "1 running · 1 passed · 1 skipped · 1 not known"
    expect(screen.getByRole("button", { name: counted }).getAttribute("aria-expanded")).toBe(
      "false",
    )
    expect(screen.getAllByText(counted)).toHaveLength(1)
    expect(screen.queryByText(/all passing/i)).toBeNull()
    expect(screen.queryByText("build")).toBeNull()
  })

  it("draws all five verdicts as themselves once the grid is open", () => {
    draw(MIXED)
    fireEvent.click(screen.getByRole("button", { name: "1 failing of 5" }))

    for (const word of ["failed", "running", "passed", "skipped", "not known"]) {
      expect(screen.getAllByText(word).length).toBeGreaterThan(0)
    }
    // Skipped and not known recede; a check that ran keeps the ordinary ink.
    expect(screen.getByText("lint")).toHaveClass("text-fg-subtle")
    expect(screen.getByText("codeql")).toHaveClass("text-fg-subtle")
    expect(screen.getByText("build")).toHaveClass("text-fg-muted")
  })

  it("ticks a failing check with its name, when it failed and its link", () => {
    vi.setSystemTime(new Date(61_000))
    // The id is passed in rather than taken from the builder's counter, because a key is
    // what this case is about and a generated one would be asserting the builder.
    const ticked = draw(
      makePullRequest({ checks: [makePullRequestCheck({ id: "run:9", at: 1_000 })] }),
    )
    fireEvent.click(screen.getByRole("checkbox", { name: "verify — failing" }))

    expect(ticked[0]).toMatchObject({
      key: "check:run:9",
      said: "The verify check is failing on pull request #41.",
      quote: undefined,
    })
    vi.useRealTimers()
  })

  it("says a list was cut rather than showing a short one silently", () => {
    draw(makePullRequest({ checks: [makePullRequestCheck()], truncated: ["checks"] }))
    expect(screen.getByText(/Only the first page was read/)).toBeDefined()
  })
})

const botThread = (body: string) =>
  makeReviewThread({ comments: [makePullRequestComment({ who: "claude[bot]", body })] })

describe("review, one card per reviewer", () => {
  /** The forge makes each inline comment posted on its own a review — a bot commenting line by
   *  line is one person, not a card per comment. */
  it("draws one card for a reviewer who left several reviews", () => {
    render(
      <PullRequestPane
        forge={forge(
          makePullRequest({
            reviews: [
              makeReview({ id: "r1", who: "claude[bot]", at: 1, threads: [botThread("first")] }),
              makeReview({ id: "r2", who: "claude[bot]", at: 2, threads: [botThread("second")] }),
            ],
          }),
        )}
        picked={[]}
        onToggle={() => {}}
        onToggleAll={() => {}}
        phone={false}
        onOpen={undefined}
      />,
    )
    expect(
      screen.getAllByRole("link", { name: "Open claude[bot]'s review on GitHub" }),
    ).toHaveLength(1)
    expect(
      screen.getByRole("checkbox", { name: "Everything from claude[bot] — 2 to answer" }),
    ).toBeDefined()
  })
})

describe("review", () => {
  const TWO = makePullRequest({
    decision: "changesRequested",
    reviews: [
      makeReview({
        who: "first-reviewer",
        threads: [makeReviewThread({ comments: [makePullRequestComment({ body: "one" })] })],
      }),
      makeReview({
        who: "second-reviewer",
        verdict: "commented",
        threads: [
          makeReviewThread({ line: 88, comments: [makePullRequestComment({ body: "two" })] }),
        ],
      }),
    ],
    conversation: [makePullRequestComment({ who: "third-person", body: "three" })],
  })

  /** Whose review a comment belongs to is what gives it its weight — one pile makes three
   *  people asking for three things read as one person asking for three. */
  it("puts each comment under the review that made it, and conversation in its own group", () => {
    const { container } = render(
      <PullRequestPane
        forge={forge(TWO)}
        picked={[]}
        onToggle={() => {}}
        onToggleAll={() => {}}
        phone={false}
        onOpen={undefined}
      />,
    )

    const text = container.textContent
    expect(text.indexOf("first-reviewer")).toBeLessThan(text.indexOf("one"))
    expect(text.indexOf("one")).toBeLessThan(text.indexOf("second-reviewer"))
    expect(text.indexOf("second-reviewer")).toBeLessThan(text.indexOf("two"))
    expect(screen.getByRole("heading", { name: "On the pull request" })).toBeDefined()
    expect(text.indexOf("On the pull request")).toBeLessThan(text.indexOf("three"))
  })

  /**
   * Shut on arrival, behind a real disclosure carrying its count — not a grey line saying
   * *hidden*, and not open.
   *
   * **And read-only once it is open.** Resolved means somebody closed the argument, so what
   * the fold holds is the same line as any other conversation with no checkbox on it: a
   * tick would invite sending back work already answered, and the one case that gives up is
   * a trip to the forge rather than a press.
   */
  it("shuts settled conversations behind a counted disclosure, and opens them read-only", () => {
    draw(
      makePullRequest({
        reviews: [
          makeReview({
            threads: [
              makeReviewThread({
                path: "src/one.ts",
                line: 12,
                resolved: true,
                comments: [makePullRequestComment({ who: "alice", body: "settled" })],
              }),
              makeReviewThread({
                resolved: true,
                line: 90,
                comments: [makePullRequestComment({ body: "also settled" })],
              }),
            ],
          }),
        ],
      }),
    )

    const fold = screen.getByRole("button", { name: "2 resolved" })
    expect(fold.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("src/one.ts:12")).toBeNull()

    fireEvent.click(fold)
    expect(screen.getByText("src/one.ts:12")).toBeDefined()
    expect(screen.getByText("alice")).toBeDefined()
    // The words, and not a tick — shut or open.
    expect(screen.getByText("settled")).toBeDefined()
    expect(screen.queryAllByRole("checkbox")).toEqual([])
    fireEvent.click(screen.getByText("src/one.ts:12"))
    expect(screen.queryAllByRole("checkbox")).toEqual([])
    // Named apart from the one on the row below it: two glyph links with one name is two
    // links a reader cannot tell apart, and the fold is where they collect.
    expect(
      screen.getByRole("link", { name: "alice on src/one.ts:12, resolved — open on GitHub" }),
    ).toBeDefined()
  })

  it("ticks a whole conversation rather than one reply in it", () => {
    const ticked = draw(
      makePullRequest({
        reviews: [
          makeReview({
            who: "reviewer",
            threads: [
              makeReviewThread({
                comments: [
                  makePullRequestComment({ who: "opener", body: "why?" }),
                  makePullRequestComment({ who: "replier", body: "because" }),
                ],
              }),
            ],
          }),
        ],
      }),
    )
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "opener on client/src/features/trak-detail/controls.ts:41",
      }),
    )

    expect(ticked[0]?.quote).toBe("why?\n\nbecause")
  })
})

/** The Review section line by line: what a shut line says, what a press opens, and what one
 *  tick in a reviewer's head reaches. */
describe("review, line by line", () => {
  /**
   * Every conversation is one line until it is pressed — who, where, the first line of
   * what they said — and opening it prints the words whole where it sits, once: the
   * preview goes when the row opens, because the comment is directly under it.
   */
  it("is one line per conversation, which opens in place and prints the words once", () => {
    draw(
      makePullRequest({
        reviews: [
          makeReview({
            threads: [
              makeReviewThread({
                path: "src/a.ts",
                line: 3,
                comments: [
                  makePullRequestComment({
                    who: "opener",
                    body: "## Why?\n\nBecause of the switch.",
                  }),
                  makePullRequestComment({ who: "replier", body: "Fair." }),
                ],
              }),
            ],
          }),
        ],
      }),
    )

    expect(screen.getByText("Why?")).toBeDefined()
    expect(screen.queryByText("Because of the switch.")).toBeNull()
    expect(screen.queryByRole("button", { name: "Close this conversation" })).toBeNull()

    fireEvent.click(screen.getByText("src/a.ts:3"))
    expect(screen.getByText("Because of the switch.")).toBeDefined()
    expect(screen.getAllByText("Why?")).toHaveLength(1)
    expect(screen.getByText("Fair.")).toBeDefined()
    expect(
      screen.getByRole("link", { name: "opener on src/a.ts:3 — open on GitHub" }),
    ).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "Close this conversation" }))
    expect(screen.queryByText("Because of the switch.")).toBeNull()
  })

  /** A reviewer's own words are a line like the rest, and a verdict rather than a
   *  conversation — so there is nothing to tick on it. */
  it("draws a reviewer's summary as a line with no tick", () => {
    draw(
      makePullRequest({
        reviews: [makeReview({ who: "alice", body: "Two things stop it going in." })],
      }),
    )
    expect(screen.getByText("their review")).toBeDefined()
    expect(screen.getByText("Two things stop it going in.")).toBeDefined()
    expect(screen.queryAllByRole("checkbox")).toEqual([])
  })

  /**
   * Select-all is a tick in the reviewer's own head, and it reaches only what already
   * carries a tick: their unanswered conversations, never a settled one. Once every one of
   * them is on, the head reads on; pressing it then takes them all off again.
   */
  it("ticks everything from one reviewer at once from their head, and unticks it", () => {
    render(
      <Live
        pull={makePullRequest({
          reviews: [
            makeReview({
              who: "alice",
              threads: [
                makeReviewThread({ line: 1, comments: [makePullRequestComment({ who: "alice" })] }),
                makeReviewThread({ line: 2, comments: [makePullRequestComment({ who: "alice" })] }),
                makeReviewThread({ line: 3, resolved: true }),
              ],
            }),
            makeReview({ who: "bob", threads: [makeReviewThread({ line: 4 })] }),
          ],
        })}
      />,
    )

    const all = "Everything from alice — 2 to answer"
    expect(checked(/^alice on /)).toEqual([false, false])
    fireEvent.click(screen.getByRole("checkbox", { name: all }))
    expect(checked(/^alice on /)).toEqual([true, true])
    expect(checked(all)).toEqual([true])
    // Bob's stays where it was, and the settled one never had a tick to reach.
    expect(checked(/^reviewer on /)).toEqual([false])
    expect(screen.queryAllByRole("checkbox")).toHaveLength(5)

    fireEvent.click(screen.getByRole("checkbox", { name: all }))
    expect(checked(/^alice on /)).toEqual([false, false])
  })
})

/**
 * The comments on the pull request, a card per person who wrote more than one. The head
 * tick is the review card's rule — all on clears them, anything else ticks them all — and
 * between the two it draws the dash rather than an empty box.
 */
/** One comment on the pull request itself, keyed on a permalink of its own. */
const issue = (who: string, at: number, body: string): PullRequestCommentDto =>
  makePullRequestComment({ who, at, body, url: `https://o/r/pull/41#issuecomment-${body}` })

/** Mara's card's head tick, re-read after every press since the row redraws it. */
const marasHead = (): HTMLInputElement =>
  screen.getByRole<HTMLInputElement>("checkbox", { name: "Everything from mara — 2 comments" })

describe("commenter groups", () => {
  const pull = makePullRequest({
    reviews: [makeReview({ who: "mara", threads: [makeReviewThread({ line: 1 })] })],
    conversation: [issue("mara", 10, "m1"), issue("sam", 20, "s1"), issue("mara", 30, "m2")],
  })

  it("cards a person with two comments, newest person first, and keeps a single as a line", () => {
    const { container } = render(<Live pull={pull} />)

    expect(marasHead()).toBeDefined()
    expect(screen.getByText("2 comments")).toBeDefined()
    // The reviewer is also a commenter, and appears in both places rather than folded in.
    expect(
      screen.getByRole("checkbox", { name: "Everything from mara — 1 to answer" }),
    ).toBeDefined()
    // Sam wrote one, so no head — and no card of its own to say "1 comments".
    expect(screen.queryByRole("checkbox", { name: /Everything from sam/ })).toBeNull()
    const text = container.textContent
    expect(text.indexOf("m1")).toBeLessThan(text.indexOf("m2"))
    expect(text.indexOf("m2")).toBeLessThan(text.indexOf("s1"))
  })

  it("ticks all of one person's comments from the head, shows a dash at some, and clears at all", () => {
    render(<Live pull={pull} />)
    fireEvent.click(marasHead())
    expect(checked(/^mara on the pull request$/)).toEqual([true, true])
    expect(marasHead().checked).toBe(true)
    expect(marasHead().indeterminate).toBe(false)
    // Sam's, and mara's review thread, stay where they were.
    expect(checked("sam on the pull request")).toEqual([false])
    expect(checked(/^reviewer on /)).toEqual([false])

    tickAt(/^mara on the pull request$/, 0)
    expect(marasHead().checked).toBe(false)
    expect(marasHead().indeterminate).toBe(true)

    fireEvent.click(marasHead())
    expect(checked(/^mara on the pull request$/)).toEqual([true, true])
    fireEvent.click(marasHead())
    expect(checked(/^mara on the pull request$/)).toEqual([false, false])
    expect(marasHead().indeterminate).toBe(false)
  })

  it("draws no head tick where nothing can be ticked, and no card where nobody wrote twice", () => {
    render(
      <PullRequestPane
        forge={forge(pull)}
        picked={[]}
        onToggle={undefined}
        onToggleAll={undefined}
        phone={false}
        onOpen={undefined}
      />,
    )
    expect(screen.queryAllByRole("checkbox")).toEqual([])
    expect(screen.getByText("2 comments")).toBeDefined()
  })
})

/** What the section says about itself in numbers and in words, and where it says it — the
 *  one count over everything under it, and the words a box says once rather than per row. */
describe("review, said once", () => {
  /** Below the breakpoint the whole section starts folded to its one line, so the trak's
   *  ending is on the first screen and the review is a press away. The count is on that one
   *  line and nowhere else: the hint under it says what the press does and repeats no
   *  number, the way the Checks band says its count once. */
  it("starts folded on a phone, and opens on the verdict", () => {
    draw(
      makePullRequest({
        decision: "changesRequested",
        reviews: [makeReview({ threads: [aliceSaid("folded away")] })],
      }),
      [],
      true,
    )

    const fold = screen.getByRole("button", { name: "Changes requested · 1 unanswered" })
    expect(fold.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("folded away")).toBeNull()
    expect(screen.getByText("Press the line above to read them")).toBeDefined()
    expect(screen.queryByText(/\bto answer\b/)).toBeNull()

    fireEvent.click(fold)
    expect(screen.getByText("folded away")).toBeDefined()
  })

  /**
   * **One count for the section, over everything under it that carries a tick.** The
   * comments on the pull request are ticked and sent back like any conversation, so a
   * verdict counting the review threads alone said *1 unanswered* over three ticks — and
   * below the breakpoint the folded row printed a second, larger number an inch under it.
   */
  it("counts the comments on the pull request in the section's own verdict", () => {
    const pull = makePullRequest({
      decision: "commented",
      reviews: [makeReview({ who: "alice", threads: [aliceSaid("on a line")] })],
      conversation: [
        makePullRequestComment({ who: "bot", url: "https://o/r/pull/41#issuecomment-1" }),
        makePullRequestComment({ who: "sam", url: "https://o/r/pull/41#issuecomment-2" }),
      ],
    })

    draw(pull)
    expect(screen.getByRole("button", { name: "Commented · 3 unanswered" })).toBeDefined()
    expect(screen.getAllByRole("checkbox", { name: /on the pull request$/ })).toHaveLength(2)

    // And the folded phone row says it once, on the verdict, rather than twice.
    cleanup()
    draw(pull, [], true)
    expect(screen.getByRole("button", { name: "Commented · 3 unanswered" })).toBeDefined()
    expect(screen.getByText("Press the line above to read them")).toBeDefined()
  })

  /**
   * A line in the box headed *On the pull request* does not print those words again as its
   * own place: at desk width it took the row's widest column and below the breakpoint a
   * whole line of its own, on a pane whose subject is how many lines a review costs.
   */
  it("does not print the box's heading back on every line inside it", () => {
    draw(
      makePullRequest({
        conversation: [makePullRequestComment({ who: "sam", body: "ship it" })],
      }),
    )

    expect(screen.getByRole("heading", { name: "On the pull request" })).toBeDefined()
    expect(screen.queryByText("on the pull request")).toBeNull()
    // The tick keeps the words: the box at the foot lists it with nothing else around it.
    expect(screen.getByRole("checkbox", { name: "sam on the pull request" })).toBeDefined()
  })
})

describe("merging", () => {
  it.each([
    ["conflicting", "GitHub sees conflicts to resolve"],
    ["behind", "The branch is behind its base"],
    ["clean", "No conflicts, and up to date with its base"],
    ["unknown", "GitHub has not worked it out yet"],
  ] as const)("says %s in its own words", (merging, said) => {
    draw(makePullRequest({ merging }))
    expect(screen.getByText(said)).toBeDefined()
  })

  /**
   * The forge keeps answering
   * clean after a merge, so drawing mergeability there reads as *ready to merge* about work
   * that is already in.
   */
  it.each(["merged", "closed"] as const)(
    "draws no mergeability at all once the pull request is %s, even at clean",
    (state) => {
      draw(makePullRequest({ state, merging: "clean" }))

      expect(screen.queryByText("No conflicts, and up to date with its base")).toBeNull()
      expect(screen.queryByText(/GitHub sees conflicts/)).toBeNull()
      expect(screen.queryByText(/has not worked it out/)).toBeNull()
    },
  )

  it("says where a merged pull request went instead", () => {
    draw(makePullRequest({ state: "merged", merging: "clean" }))
    expect(screen.getByText("Merged on GitHub — the work is in over there")).toBeDefined()
  })

  it("offers the refusal as a tick, and nothing to tick where it is not refusing", () => {
    const ticked = draw(makePullRequest({ merging: "conflicting" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "GitHub will not merge it as it stands" }))
    expect(ticked[0]?.quote).toBe("The pull request conflicts with its base branch.")

    cleanup()
    draw(makePullRequest({ merging: "clean" }))
    expect(screen.queryByRole("checkbox")).toBeNull()
  })
})

/**
 * **Two rows that look alike are two rows.** A key that names both draws them both ticked,
 * sends one, and hands React two children under one key — and what is lost is a reviewer's
 * own words, which is the one promise this half exists to keep. A case per kind of pick.
 */
describe("ticking one of two things that look alike", () => {
  /**
   * Two workflows each carrying a job called `test`, both pointing at one build page —
   * which is what a CI system posting several checks against one run gives, and what the
   * key was built on before `id` existed. Only `id` tells them apart, and the fixture gives
   * them nothing else that does.
   */
  it("leaves the other check unticked, where two share a name and a link alike", () => {
    render(
      <Live
        pull={makePullRequest({
          checks: [
            makePullRequestCheck({ name: "test", url: "https://example.invalid/build/1" }),
            makePullRequestCheck({ name: "test", url: "https://example.invalid/build/1" }),
          ],
        })}
      />,
    )

    // Both rows are named the same thing, because the wire gives nothing else to name them
    // by — so the tick has to be told apart by its key rather than by its label.
    expect(checked("test — failing")).toEqual([false, false])
    tickAt("test — failing", 1)
    expect(checked("test — failing")).toEqual([false, true])
  })

  it("leaves the other check unticked where the forge gave neither of them a link", () => {
    render(
      <Live
        pull={makePullRequest({
          checks: [
            makePullRequestCheck({ name: "test", url: undefined }),
            makePullRequestCheck({ name: "test", url: undefined }),
          ],
        })}
      />,
    )

    tickAt("test — failing", 0)
    expect(checked("test — failing")).toEqual([true, false])
  })

  /** One person reviewing twice and commenting on the same line in both. Keyed on the
   *  reviewer and the line, the second conversation could not be picked at all. */
  it("leaves the other conversation unticked, and sends the one that was ticked", () => {
    const [first, second] = [aliceSaid("first pass"), aliceSaid("second pass")]
    render(
      <Live
        pull={makePullRequest({
          reviews: [
            makeReview({ who: "alice", threads: [first] }),
            makeReview({ who: "alice", threads: [second] }),
          ],
        })}
      />,
    )

    const name = "alice on client/src/features/trak-detail/controls.ts:41"
    tickAt(name, 1)
    expect(checked(name)).toEqual([false, true])
    // And the words that reach the composer are the ones that were ticked.
    expect(screen.getByText("second pass")).toBeDefined()
  })

  /**
   * A conversation with no comments in it at all is the one thing on the pane with no
   * permalink to key on, so it falls back to its review's identity — which two reviews by
   * one person do not share even where their links do.
   */
  it("leaves the other empty conversation unticked, where two reviews share a link", () => {
    const link = "https://github.com/o/r/pull/41#pullrequestreview-same"
    render(
      <Live
        pull={makePullRequest({
          reviews: [
            makeReview({ who: "alice", url: link, threads: [emptyThread()] }),
            makeReview({ who: "alice", url: link, threads: [emptyThread()] }),
          ],
        })}
      />,
    )

    const name = "alice on client/src/features/trak-detail/controls.ts:41"
    tickAt(name, 0)
    expect(checked(name)).toEqual([true, false])
  })

  it("leaves the other conversation comment unticked where two say the same thing", () => {
    render(
      <Live
        pull={makePullRequest({
          conversation: [
            makePullRequestComment({ who: "alice", body: "same words" }),
            makePullRequestComment({ who: "alice", body: "same words" }),
          ],
        })}
      />,
    )

    tickAt("alice on the pull request", 0)
    expect(checked("alice on the pull request")).toEqual([true, false])
  })

  /** The merging fact is the one kind there is only ever one of, so it cannot collide with
   *  another of its own — but it must not answer to a check's or a thread's key either. */
  it("leaves every other kind unticked when the merging fact is ticked", () => {
    render(
      <Live
        pull={makePullRequest({
          merging: "conflicting",
          checks: [makePullRequestCheck({ name: "test" })],
          conversation: [makePullRequestComment({ who: "alice" })],
        })}
      />,
    )

    fireEvent.click(screen.getByRole("checkbox", { name: "GitHub will not merge it as it stands" }))
    // Merging is the first row now, so its tick is the first of the three.
    expect(checked(/./)).toEqual([true, false, false])
  })
})

/**
 * A trak whose state takes no more work has nowhere for a pick to go, so the pane is drawn
 * to be read rather than acted on. **Everything still shows** — the pull request is worth
 * reading at `Merged` — and nothing carries a box that could be pressed and change nothing.
 */
describe("a pane with nowhere to send a pick", () => {
  it("draws every row it would otherwise, and no tick on any of them", () => {
    render(
      <PullRequestPane
        forge={forge(
          makePullRequest({
            merging: "conflicting",
            checks: [makePullRequestCheck({ name: "verify" })],
            reviews: [makeReview({ threads: [aliceSaid("this reads oddly")] })],
            conversation: [makePullRequestComment({ who: "sam", body: "shipping this" })],
          }),
        )}
        picked={[]}
        onToggle={undefined}
        onToggleAll={undefined}
        phone={false}
        onOpen={undefined}
      />,
    )

    expect(screen.queryAllByRole("checkbox")).toEqual([])
    expect(screen.getByText("verify")).toBeDefined()
    expect(screen.getByText("this reads oddly")).toBeDefined()
    expect(screen.getByText("shipping this")).toBeDefined()
    expect(screen.getByText("GitHub sees conflicts to resolve")).toBeDefined()
  })
})

/**
 * **The title is a heading, and the way out is one glyph beside it.** Eighty characters of
 * underline is what made this read as a link standing where a headline should be, so the
 * whole title stopped being the hyperlink — same number of presses, and the accessible name
 * moved onto the glyph with it.
 */
describe("the header", () => {
  it("is the title as a heading, with the number and one link out beside it", () => {
    draw(makePullRequest({ isDraft: true }))

    expect(
      screen.getByRole("heading", { level: 3, name: /Show a branch's pull request/ }),
    ).toBeDefined()
    const link = screen.getByRole("link", { name: "Open pull request #41 on GitHub" })
    expect(link.getAttribute("href")).toBe("https://github.com/o/r/pull/41")
    expect(link.textContent).toBe("")
    expect(screen.getByText("#41")).toBeDefined()
    expect(screen.getByText("Draft pull request")).toBeDefined()
  })

  /** The state is the one fact that changes what every other word on the pane means, so it
   *  is said in the eyebrow once the pull request is no longer open. */
  it.each(["merged", "closed"] as const)("says %s once the pull request is not open", (state) => {
    draw(makePullRequest({ state }))
    expect(screen.getByText(state)).toBeDefined()
  })
})
