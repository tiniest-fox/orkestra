/**
 * Tier 2: a trak at its end — the finished position, its pull request, merge and archive,
 * and a trak that failed, restarted or was stopped while ending.
 */

import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import type { PullRequestDto } from "@orkestra/shared/dto/forge"
import type { TrakDetailDto } from "@orkestra/shared/dto/trak"
import {
  makeAgentReturned,
  makeAgentStep,
  makeCheckFailed,
  makeChecksPassed,
  makeEffectFailed,
  makeEffectsRan,
  makeComposeEntry,
  makeComposerReturned,
  makeDetail,
  makeHumanActed,
  makePlan,
  makeProposal,
  makeRestarted,
  makeSession,
  makeNote,
  makeSpawned,
  makeText,
  makeTool,
  makeTrakCreated,
  makePullRequest,
  makePullRequestCheck,
  makeTurnFailed,
  makeWorkCommitted,
} from "../../fixtures"
import { failureWords } from "../../format/failure"
import {
  server,
  ID,
  TITLE,
  BUILT,
  renderDetail,
  answers,
  loaded,
  press,
  goTo,
  emptyList,
  held,
  C1,
  piece,
  firstPiece,
  secondPiece,
  spawner,
  answersFor,
  finished,
  previews,
} from "./TrakDetailPage.support"

const merges = (respond: () => Response | Promise<Response>) =>
  http.post(`*/api/traks/${ID}/merge`, respond)

/** What the forge answers, overriding the default *no pull request* this file boots with. */
const pulls = (body: PullRequestDto) =>
  http.get(`*/api/traks/${ID}/pull-request`, () => HttpResponse.json(body))

describe("the finished position", () => {
  it("opens there rather than on the last step, and says where the trak is", async () => {
    server.use(emptyList, answers(finished()), previews({ into: "main" }))
    renderDetail()

    // The drawer lands on the ending, not on `build the drawer` — the last entry is a step
    // that finished, and there is nothing to do at it.
    expect(await screen.findByText("The plan ran out and the work is on its branch.")).toBeDefined()
    expect(screen.getByText("trak/auto-commit")).toBeDefined()
    expect(screen.getByText("1 commit")).toBeDefined()
    // And what it took, off the log alone.
    expect(screen.getByText("2 steps")).toBeDefined()
    expect(screen.getByText("26m")).toBeDefined()
  })

  it("is reachable by the bar's arrows, from the last plan entry and back", async () => {
    server.use(emptyList, answers(finished()), previews({ into: "main" }))
    renderDetail()

    await screen.findByText("The plan ran out and the work is on its branch.")
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }))
    expect(await screen.findByText(BUILT)).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "Next step" }))
    expect(await screen.findByText("The plan ran out and the work is on its branch.")).toBeDefined()
  })

  /**
   * `closing.md` decision 3: a host merge goes into whatever branch the daemon's machine is
   * standing on, so the destination is a fact about somebody else's checkout — shown before
   * it is honoured, and never guessed from `worktree.base`.
   */
  it("names the branch it would merge into before it is pressed", async () => {
    server.use(emptyList, answers(finished()), previews({ into: "release-2" }))
    renderDetail()

    expect(await screen.findByRole("button", { name: "Merge into release-2" })).toBeDefined()
  })

  it("says a child's work goes to its parent instead of to a branch name", async () => {
    server.use(emptyList, answers(finished()), previews({ parentId: "parent-1" }))
    renderDetail()

    expect(await screen.findByRole("button", { name: "Merge into its parent" })).toBeDefined()
    expect(screen.getByText("a child merges into its parent")).toBeDefined()
  })

  /**
   * Asked of git before anything is pressed, which is the only thing that separates this
   * from finding out afterwards — and the press is unchanged either way: it attempts the
   * merge, and the outcome is what decides.
   */
  it("says the merge will not go in, before it is pressed", async () => {
    server.use(emptyList, answers(finished()), previews({ into: "main", conflicts: true }))
    renderDetail()

    expect(await screen.findByRole("button", { name: "Resolve merge conflicts" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Merge into main" })).toBeNull()
  })

  it("names the destination where git says the merge would go in", async () => {
    // `false` is git having answered, and it must read as an ordinary merge — the label
    // is what changes on a conflict, and nothing else about this pane does.
    server.use(emptyList, answers(finished()), previews({ into: "main", conflicts: false }))
    renderDetail()

    expect(await screen.findByRole("button", { name: "Merge into main" })).toBeDefined()
  })
})

/**
 * The three endings as presses. Each is a drive the server cannot tell a deliberate click
 * from a double one on, which is the whole of what these assert — two of them spend
 * nothing and it makes no difference to the rules.
 */
describe("the endings the finished position carries", () => {
  it("sends one merge, and refuses the second click while the first is in flight", async () => {
    let sent = 0
    const flight = held()
    server.use(
      emptyList,
      answers(finished()),
      previews({ into: "main" }),
      merges(async () => {
        sent += 1
        await flight.wait
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    const button = await screen.findByRole("button", { name: "Merge into main" })
    fireEvent.click(button)

    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(true)
    })
    fireEvent.click(button)
    expect(sent).toBe(1)

    flight.release()
  })

  it("will not press anything while something already holds the trak", async () => {
    server.use(
      emptyList,
      answers(finished({ custody: { holder: { since: 1786028700000 } } })),
      previews({ into: "main" }),
    )
    renderDetail()

    const button = await screen.findByRole("button", { name: "Merge into main" })
    expect(button.hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("button", { name: "More work on it" }).hasAttribute("disabled")).toBe(
      true,
    )
  })

  /**
   * The one refusal that is only knowable after the press — `MergePreviewDto` says nothing
   * about the host's working tree. Everything the position said has to still be on screen
   * and still be true, because the way through is to go and commit and press again.
   */
  it("names the files a dirty host checkout refused over, and keeps the card", async () => {
    server.use(
      emptyList,
      answers(finished()),
      previews({ into: "main" }),
      merges(() =>
        HttpResponse.json(
          { _tag: "Dirty", files: ["src/a.ts", "src/b.ts"] },
          { status: 409, statusText: "Dirty" },
        ),
      ),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Merge into main" }))

    expect(await screen.findByRole("alert")).toBeDefined()
    expect(screen.getByText(/uncommitted work in the tree this would touch/)).toBeDefined()
    expect(screen.getByText("src/a.ts")).toBeDefined()
    expect(screen.getByText("trak/auto-commit")).toBeDefined()
  })

  /**
   * A refusal outlives the state it was earned at — `useMerge` and `useArchive` live on the
   * page, so nothing unmounts one across an ending — and it must not follow the trak.
   * *There is uncommitted work in the tree this would touch* is about a press the closed
   * pane no longer offers, and the closed pane still draws the block because it keeps
   * More work on it.
   */
  it("drops a merge refusal once the trak was closed instead", async () => {
    let state: TrakDetailDto["state"] = { _tag: "Finished" }
    server.use(
      emptyList,
      http.get(`*/api/traks/${ID}`, () => HttpResponse.json(finished({ state }))),
      previews({ into: "main" }),
      merges(() =>
        HttpResponse.json(
          { _tag: "Dirty", files: ["src/a.ts"] },
          { status: 409, statusText: "Dirty" },
        ),
      ),
      http.post(`*/api/traks/${ID}/close`, () => {
        state = { _tag: "Closed" }
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Merge into main" }))
    expect(await screen.findByRole("alert")).toBeDefined()

    // The band's ending cell holds Merge here, so the header's is the Archive to press.
    fireEvent.click(screen.getByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))
    fireEvent.click(screen.getByRole("button", { name: "Archive" }))

    await screen.findByRole("button", { name: "More work on it" })
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText(/uncommitted work in the tree this would touch/)).toBeNull()
  })
})

describe("a refusal to merge sent back", () => {
  const REFUSED = makePullRequest({
    checks: [makePullRequestCheck({ name: "verify", at: undefined })],
    merging: "conflicting",
    base: "release",
  })

  /**
   * **The refusal's base rides beside the body, never inside it**, so the engine can tell
   * the composer which ref to merge. A check ticked alone names no base.
   */
  it("sends the pull request's base where the refusal is ticked, and only there", async () => {
    const sent: unknown[] = []
    server.use(
      emptyList,
      answers(finished()),
      previews({ into: "main" }),
      pulls(REFUSED),
      http.post(`*/api/traks/${ID}/reenter`, async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("checkbox", { name: "verify — failing" }))
    fireEvent.click(await screen.findByRole("button", { name: "Send it back" }))
    await waitFor(() => {
      expect(sent).toHaveLength(1)
    })
    expect(sent[0]).not.toHaveProperty("base")

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "GitHub will not merge it as it stands" }),
    )
    fireEvent.click(await screen.findByRole("button", { name: "Send it back" }))
    await waitFor(() => {
      expect(sent).toHaveLength(2)
    })
    expect(sent[1]).toMatchObject({ base: "release" })
  })
})

/**
 * The forge's answer, composed into the finished pane.
 *
 * **Merge is withheld on the presence of a pull request and on nothing else** — the state
 * still says `Finished`, `mergeOffered` still says `true`, and the `&&` at the call site is
 * what removes the press. Composed there rather than given to `mergeOffered` as a second
 * argument, for the reason `controls.ts` records: a control that is a function of anything
 * but `TrakStateDto` is one that can be drawn at a state `decide` would settle as
 * `Failed{engine}`.
 */
describe("a branch that has a pull request", () => {
  // No `at` on the check: the elapsed line is measured against the wall clock, and
  // `pullRequest.test.ts` is where it is pinned. Here the body is asserted whole, so the one
  // line that would move under it is left off — which is also a real case, since a time the
  // forge did not stamp is not one to invent.
  const OPEN = makePullRequest({
    checks: [makePullRequestCheck({ name: "verify", at: undefined })],
    merging: "conflicting",
  })

  it.each(["open", "closed"] as const)(
    "offers no local merge while the forge reports one at %s, and draws its block",
    async (state) => {
      server.use(
        emptyList,
        answers(finished()),
        previews({ into: "main" }),
        pulls(makePullRequest({ ...OPEN, state })),
      )
      renderDetail()

      expect(await screen.findByRole("link", { name: /#41/ })).toBeDefined()
      expect(screen.queryByRole("button", { name: /^Merge into/ })).toBeNull()
      expect(screen.queryByRole("button", { name: "Merge it" })).toBeNull()
      // Archive is not promoted into the empty place while the pull request is live: it
      // stays in the dropdown, which makes the dropdown the only way such a trak is put
      // away.
      expect(screen.getByRole("button", { name: "More endings" })).toBeDefined()
      expect(screen.queryByRole("button", { name: "Archive" })).toBeNull()
      expect(screen.getByRole("button", { name: "More work on it" })).toBeDefined()
    },
  )

  it.each([
    ["there is none", { _tag: "NoPullRequest" } as const],
    ["the forge could not be asked", { _tag: "ForgeUnavailable", why: "no gh" } as const],
  ])("leaves the merge press exactly as it was where %s, and draws no block", async (_n, body) => {
    server.use(emptyList, answers(finished()), previews({ into: "main" }), pulls(body))
    renderDetail()

    expect(await screen.findByRole("button", { name: "Merge into main" })).toBeDefined()
    expect(screen.queryByRole("link", { name: /#41/ })).toBeNull()
  })

  /**
   * **One request, not three.** The body is composed on the screen — the sentence first,
   * then a block per ticked thing with its text quoted verbatim — and posted to the route
   * that has always taken one string. `reentryBody.test.ts` owns the format; this owns that
   * the pane sends it once and that the box opened on a tick rather than on a press.
   */
  it("sends everything ticked and the sentence as one re-entry", async () => {
    const sent: string[] = []
    server.use(
      emptyList,
      answers(finished()),
      previews({ into: "main" }),
      pulls(OPEN),
      http.post<never, { what: string }>(`*/api/traks/${ID}/reenter`, async ({ request }) => {
        sent.push((await request.json()).what)
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    // Nothing was pressed to open the box — a tick has to land somewhere visible.
    fireEvent.click(await screen.findByRole("checkbox", { name: "verify — failing" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "GitHub will not merge it as it stands" }))
    fireEvent.change(await screen.findByLabelText("What should change?"), {
      target: { value: "Fix the check and resolve the conflict." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send it back" }))

    await waitFor(() => {
      expect(sent).toHaveLength(1)
    })
    expect(sent[0]).toBe(
      [
        "Fix the check and resolve the conflict.",
        "",
        "The verify check is failing on pull request #41.",
        "https://github.com/o/r/actions/runs/9",
        "",
        "Pull request #41 cannot merge as it stands.",
        "> The pull request conflicts with its base branch.",
      ].join("\n"),
    )
  })

  /**
   * **Off until something is ticked or something is typed, and a tick alone is enough.**
   * What was ticked already says what is wrong with the pull request, so demanding a
   * sentence on top of it would be asking for the thing again in prose.
   */
  it("sends what was ticked with nothing typed at all", async () => {
    const sent: string[] = []
    server.use(
      emptyList,
      answers(finished()),
      previews({ into: "main" }),
      pulls(OPEN),
      http.post<never, { what: string }>(`*/api/traks/${ID}/reenter`, async ({ request }) => {
        sent.push((await request.json()).what)
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    // Nothing ticked and nothing typed: the box is not even open, and the press that opens
    // it is not the press that sends.
    const tick = await screen.findByRole("checkbox", { name: "verify — failing" })
    expect(screen.queryByRole("button", { name: "Send it back" })).toBeNull()

    fireEvent.click(tick)
    fireEvent.click(await screen.findByRole("button", { name: "Send it back" }))

    await waitFor(() => {
      expect(sent).toEqual([
        "The verify check is failing on pull request #41.\nhttps://github.com/o/r/actions/runs/9",
      ])
    })
  })

  /** The line goes from the box without anybody finding the row it came from, and the tick
   *  goes with it — one list, so the two cannot disagree about what would be sent. */
  it("removes a picked thing from the box, which unticks its row", async () => {
    server.use(emptyList, answers(finished()), previews({ into: "main" }), pulls(OPEN))
    renderDetail()

    fireEvent.click(await screen.findByRole("checkbox", { name: "verify — failing" }))
    expect(await screen.findByLabelText("What should change?")).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "Remove verify — failing" }))

    const tick: HTMLInputElement = screen.getByRole("checkbox", { name: "verify — failing" })
    expect(tick.checked).toBe(false)
  })
})

/**
 * The box at the foot, once the pull-request half above it can put things in it.
 *
 * Its own describe rather than more cases in the one above: what a tick does to the pane is
 * one subject, and how the box opens and shuts is another.
 */
describe("the box at the foot of a pull-request pane", () => {
  const OPEN = makePullRequest({
    checks: [makePullRequestCheck({ name: "verify", at: undefined })],
    merging: "conflicting",
  })

  /**
   * **No press on this surface can be pressed and change nothing.** What holds the box open
   * once something is ticked is the picked list, and `Cancel` clears only the press that
   * opened it — so with picks it would be dead, and `More work on it` is disabled while the
   * box is open, leaving the row with no live way out at all.
   */
  it("draws no Cancel while anything is ticked, and shuts on the last one leaving", async () => {
    server.use(emptyList, answers(finished()), previews({ into: "main" }), pulls(OPEN))
    renderDetail()

    // Opened by the press, with nothing ticked: Cancel is there and it shuts the box.
    fireEvent.click(await screen.findByRole("button", { name: "More work on it" }))
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))
    expect(screen.queryByLabelText("What should change?")).toBeNull()

    // Opened by a tick: no Cancel, because there is nothing for it to do.
    fireEvent.click(screen.getByRole("checkbox", { name: "verify — failing" }))
    expect(await screen.findByLabelText("What should change?")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()

    // And the last picked thing leaving is what shuts it — here, from the box's own line.
    fireEvent.click(screen.getByRole("button", { name: "Remove verify — failing" }))
    expect(screen.queryByLabelText("What should change?")).toBeNull()
    expect(screen.getByRole("button", { name: "More work on it" }).hasAttribute("disabled")).toBe(
      false,
    )
  })

  /** The other route to removing it, which is the same list and must shut the box the same
   *  way — the row is where a reader ticked it, and unticking is the obvious undo. */
  it("shuts the box when the last picked thing is unticked on its own row", async () => {
    server.use(emptyList, answers(finished()), previews({ into: "main" }), pulls(OPEN))
    renderDetail()

    const tick = await screen.findByRole("checkbox", { name: "verify — failing" })
    fireEvent.click(tick)
    expect(await screen.findByLabelText("What should change?")).toBeDefined()

    fireEvent.click(screen.getByRole("checkbox", { name: "verify — failing" }))
    expect(screen.queryByLabelText("What should change?")).toBeNull()
  })

  /** A box the person opened deliberately stays open when their ticks come and go — the
   *  sentence they were part way through typing is in it, and `Cancel` is back to shut it. */
  it("keeps a box opened by the press open once its ticks are gone, with Cancel back", async () => {
    server.use(emptyList, answers(finished()), previews({ into: "main" }), pulls(OPEN))
    renderDetail()

    const tick = await screen.findByRole("checkbox", { name: "verify — failing" })
    fireEvent.click(screen.getByRole("button", { name: "More work on it" }))
    fireEvent.click(tick)
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()

    fireEvent.click(screen.getByRole("checkbox", { name: "verify — failing" }))
    expect(screen.getByLabelText("What should change?")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByLabelText("What should change?")).toBeNull()
  })
})

/** The two endings that are not the merge: sending it back, and closing it. */
describe("the other two endings", () => {
  it("asks for a sentence before it will send a trak back", async () => {
    let sent = 0
    server.use(
      emptyList,
      answers(finished()),
      previews({ into: "main" }),
      http.post(`*/api/traks/${ID}/reenter`, async ({ request }) => {
        sent += 1
        expect(await request.json()).toEqual({ what: "name the step by its instruction" })
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "More work on it" }))

    // A blank field is not submittable: the composer spawned to read nothing costs the
    // same as one spawned to read a sentence.
    const send = screen.getByRole("button", { name: "Send it back" })
    expect(send.hasAttribute("disabled")).toBe(true)
    fireEvent.click(send)
    expect(sent).toBe(0)

    fireEvent.change(screen.getByLabelText("What should change?"), {
      target: { value: "name the step by its instruction" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send it back" }))
    await waitFor(() => {
      expect(sent).toBe(1)
    })
  })

  /** The band's ending cell holds one press, and while a merge is on offer it is Merge —
   *  Archive is then the header's alone, and still confirmable there. */
  it("keeps Archive available in the header while Merge holds the band's ending", async () => {
    server.use(emptyList, answers(finished()), previews({ into: "main" }))
    renderDetail()

    await screen.findByRole("button", { name: "Merge into main" })
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull()
    expect(screen.queryByRole("button", { name: "More endings" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "More options" }))
    expect(screen.getByRole("menuitem", { name: "Archive this trak" })).toBeDefined()
  })

  /** The last surface that can say it — the `checks` gate is gone once somebody approves. */
  it("says which check was overridden when the work was taken", async () => {
    server.use(
      emptyList,
      answers(
        finished({
          log: [
            makeCheckFailed({ step: 2, name: "pnpm verify", output: "2 warnings" }),
            makeHumanActed({ step: 2, action: { _tag: "Approve" } }),
          ],
        }),
      ),
      previews({ into: "main" }),
    )
    renderDetail()

    expect(
      await screen.findByText("You took this work with pnpm verify still failing."),
    ).toBeDefined()
  })

  /**
   * The engine's ordinary recovery: the check failed, `decide` re-ran the agent, the re-run
   * passed and a person approved the *work*. Nobody took anything failing, and saying they
   * did on the one surface that can still say it is the sentence they would act on.
   */
  it("says nothing about a check the agent fixed before anyone approved the step", async () => {
    server.use(
      emptyList,
      answers(
        finished({
          log: [
            makeCheckFailed({ step: 2, name: "pnpm verify", output: "2 warnings" }),
            makeChecksPassed({ step: 2, ran: ["pnpm verify"] }),
            makeHumanActed({ step: 2, action: { _tag: "Approve" } }),
            // The commit the whole log is replaced past, kept because the headline is what
            // this asserts on and a branch nothing landed on has a headline of its own.
            makeWorkCommitted({ step: 2, sha: "abc1234" }),
          ],
        }),
      ),
      previews({ into: "main" }),
    )
    renderDetail()

    await screen.findByText("The plan ran out and the work is on its branch.")
    expect(screen.queryByText(/still failing/)).toBeNull()
  })

  /** A log written before `Store.append` stamped a time says nothing, never `0m` or 1970. */
  it("shows no duration at all for a trak whose log predates timestamps", async () => {
    server.use(
      emptyList,
      answers(
        finished({
          log: [
            makeTrakCreated({ description: "add a client" }),
            makeWorkCommitted({ step: 1, sha: "abc1234" }),
          ],
        }),
      ),
      previews({ into: "main" }),
    )
    renderDetail()

    await screen.findByText("2 steps")
    expect(screen.queryByText("0m")).toBeNull()
    expect(screen.queryByText("under a minute")).toBeNull()
  })
})

/**
 * The only place a pull request exists on this surface: nothing polls the forge and no
 * route asks it anything, so a link is a line a script printed once and the drawer is
 * where it is read.
 */
describe("what a step sent outside the checkout", () => {
  it("shows what a step's effects printed, with the time they ran", async () => {
    server.use(
      emptyList,
      answers(
        finished({
          log: [
            ...finished().log,
            makeEffectsRan({
              step: 2,
              ran: [{ name: "open-pr", output: "https://example.invalid/pull/7" }],
              at: 2_600_000,
            }),
          ],
        }),
      ),
      previews({ into: "main" }),
    )
    renderDetail()
    await press("Previous step")

    expect(await screen.findByText("https://example.invalid/pull/7")).toBeDefined()
    expect(screen.getByText(`acted at ${new Date(2_600_000).toISOString()}`)).toBeDefined()
  })

  it("names each effect a skip kept from running, as the note on the step", async () => {
    server.use(
      emptyList,
      answers(
        finished({
          log: [
            ...finished().log,
            makeEffectFailed({ step: 2, name: "open-pr", output: "gh: no auth" }),
            makeEffectsRan({ step: 2, ran: [], skipped: ["open-pr", "notify"], at: 2_600_000 }),
          ],
        }),
      ),
      previews({ into: "main" }),
    )
    renderDetail()
    await press("Previous step")

    expect(await screen.findByText("open-pr did not run — skipped")).toBeDefined()
    expect(screen.getByText("notify did not run — skipped")).toBeDefined()
    expect(screen.getByText(`skipped at ${new Date(2_600_000).toISOString()}`)).toBeDefined()
    // The failure the skip went past is not drawn as if it were still the step's last word.
    expect(screen.queryByText("gh: no auth")).toBeNull()
  })
})

describe("a merged pull request promotes the archive", () => {
  it("offers no local merge at merged, and the archive takes the first slot", async () => {
    // The forge has answered the only question left, so the press that ends the trak
    // comes out of the overflow and goes loud — and it still confirms before anything
    // is sent.
    server.use(
      emptyList,
      answers(finished()),
      previews({ into: "main" }),
      pulls(makePullRequest({ merging: "unknown", state: "merged" })),
    )
    renderDetail()

    expect(await screen.findByRole("link", { name: /#41/ })).toBeDefined()
    expect(screen.queryByRole("button", { name: /^Merge into/ })).toBeNull()
    expect(await screen.findByRole("button", { name: "Archive" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "More endings" })).toBeNull()
  })
})

/**
 * **What the pane says about itself once the forge is in the picture, which is two
 * sentences and both of them were wrong.** The lead and the line under it are the only
 * words on the pane that are not a section's own, so they are the only place it can
 * contradict what is drawn below them — a merge press that is not there, and work reported
 * as pending directly over a section saying it went in.
 */
describe("the lead sentence on a trak with a pull request", () => {
  const OPEN = makePullRequest({ merging: "conflicting" })

  /** No local Merge is drawn on such a trak, so the line under the lead naming one is the
   *  pane telling a reader to press something it does not offer. */
  it("stops naming a merge in the line under the lead", async () => {
    server.use(emptyList, answers(finished()), previews({ into: "main" }), pulls(OPEN))
    renderDetail()

    expect(
      await screen.findByText(
        "The checkout is held until this goes in on GitHub, or you archive it.",
      ),
    ).toBeDefined()
    expect(screen.queryByText(/held until you merge it/)).toBeNull()
  })

  it("says the work is in once the forge reports the pull request merged", async () => {
    server.use(
      emptyList,
      answers(finished()),
      previews({ into: "main" }),
      pulls(makePullRequest({ ...OPEN, state: "merged" })),
    )
    renderDetail()

    expect(await screen.findByText("The work is in — it went in on GitHub.")).toBeDefined()
    expect(screen.queryByText(/The plan ran out/)).toBeNull()
    expect(screen.getByText("Merged on GitHub — the work is in over there")).toBeDefined()
  })

  /** A trak with no forge behind it keeps the words it always had, which is the half of
   *  this that must not move. */
  it("keeps the old words where there is no pull request", async () => {
    server.use(
      emptyList,
      answers(finished()),
      previews({ into: "main" }),
      pulls({ _tag: "NoPullRequest" }),
    )
    renderDetail()

    expect(
      await screen.findByText("The checkout is held until you merge it or archive it."),
    ).toBeDefined()
  })
})

describe("a trak that has already ended", () => {
  /**
   * **The reversal, at the one place a person meets it.** A merged trak used to offer
   * nothing and say *more work on this is a new trak*; it now offers the same pair of doors
   * as every other ending. What it still does not offer is a merge — the work is in — or an
   * ending, so the overflow is not drawn with nothing in it.
   */
  it("offers both doors after a merge, and no merge or ending beside them", async () => {
    server.use(emptyList, answers(finished({ state: { _tag: "Merged", sha: "9f31c07" } })))
    renderDetail()

    expect(
      await screen.findByText("The work is in. The checkout has been taken away."),
    ).toBeDefined()
    expect(screen.getByRole("button", { name: "More work on it" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Ask about it" })).toBeDefined()
    expect(screen.queryByText(/a new trak/)).toBeNull()
    // `/^Merge into/`, not `/^Merge/`: the bar's own position button is captioned
    // `Merged` at this state, and it is a button.
    for (const name of [/^Merge into/, "More endings", "Archive"]) {
      expect(screen.queryByRole("button", { name })).toBeNull()
    }
  })

  /**
   * **No `previews` handler, and that is the assertion.** Nothing asks where a merge that
   * already happened would go — `onUnhandledRequest: "error"` fails this test if anything
   * does — so the card has to answer off the state, and the commit is what it has. Drawn
   * from the preview instead, this is the load where the destination reads `…` under a note
   * saying *asking where this would go*, forever.
   */
  it("names the commit a merged trak went in as, with nothing left to ask", async () => {
    server.use(emptyList, answers(finished({ state: { _tag: "Merged", sha: "9f31c07" } })))
    renderDetail()

    expect(await screen.findByText("9f31c07")).toBeDefined()
    expect(screen.getByText("the merge commit")).toBeDefined()
    expect(screen.queryByText("…")).toBeNull()
    expect(screen.queryByText("asking where this would go")).toBeNull()
  })

  /**
   * A reload while the `git merge` is running, which is the one ending the pane no longer
   * draws. The block takes it — same position, no card — and the branch card goes with it
   * for the duration. That is the interim the design round chose knowingly: the card is the
   * answer to *where is my work going*, and revisiting the ending row as one surface is
   * later work. `endingWords.instead` stops being reached at `Merging` and `Closing` with it.
   */
  it("covers the ending with what the engine is doing, while a merge is in flight", async () => {
    server.use(
      emptyList,
      answers(finished({ state: { _tag: "Merging" }, custody: { holder: { since: 1_000 } } })),
      previews({ into: "release-2" }),
    )
    renderDetail()

    expect(await screen.findByText("Putting the work in")).toBeDefined()
    expect(screen.getByText("git merge --no-ff")).toBeDefined()
    // The card and its words, gone for the duration rather than corrected.
    expect(screen.queryByText("release-2")).toBeNull()
    expect(screen.queryByText("The plan ran out and the work is on its branch.")).toBeNull()
    expect(screen.queryByText("Merging it now.")).toBeNull()
  })

  /** Closing merges nothing, so there is no destination to draw and the card says as much.
   *  The re-entry press is not what tells it from a merged trak — both offer that now. */
  it("keeps the re-entry press on a closed trak, and draws no destination", async () => {
    server.use(emptyList, answers(finished({ state: { _tag: "Closed" } })))
    renderDetail()

    expect(await screen.findByRole("button", { name: "More work on it" })).toBeDefined()
    expect(screen.getByText("nothing was merged")).toBeDefined()
    expect(screen.queryByRole("button", { name: /^Merge into/ })).toBeNull()
  })

  /** Its plan did not run out — a person ended it mid-flight — so the words this position
   *  says would be false there. */
  it("gives an abandoned trak no such position at all", async () => {
    server.use(
      emptyList,
      answers(finished({ state: { _tag: "Abandoned", reason: "changed my mind" } })),
    )
    renderDetail()

    await loaded()
    expect(screen.queryByText(/The plan ran out/)).toBeNull()
    expect(screen.queryByRole("button", { name: /^Merge into/ })).toBeNull()
  })
})

/**
 * What a press and a field hold on to, and the trak they hold it *for*.
 *
 * Every acting hook on this page is keyed to whichever trak owns the position on screen, and
 * the reader moves that trak with an arrow or a tile. So each of these cases is one move
 * between two live gates, asserting that nothing an acting hook was holding at the first one
 * is drawn — or, worse, sent — at the second. **Nothing on screen names the addressee**: that
 * is the settled design, and it is what makes these the assertions rather than a label.
 *
 * A turn in each piece's transcript at the step it is parked on, for `standing`'s reason —
 * the pane draws *Nothing has run here yet* at a position with none, whatever the log filed.
 */
const parkedPiece = (
  base: TrakDetailDto,
  output: Extract<TrakDetailDto["log"][number], { _tag: "AgentReturned" }>["output"],
  state: TrakDetailDto["state"],
): TrakDetailDto => ({
  ...base,
  state,
  log: [
    makeTrakCreated({ description: base.description }),
    makeAgentReturned({ step: 1, sessionId: `${base.id}-1`, output }),
  ],
  transcript: [
    makeSpawned({ pid: 901, position: 1 }),
    makeSession({ id: `${base.id}-1`, position: 1 }),
  ],
})

const chatField = (): HTMLTextAreaElement =>
  screen.getByLabelText<HTMLTextAreaElement>("Say something to the agent")

/** Every `/act`, whichever trak it names, so the id in the path is what is asserted. */
const acted = (sent: { id: string; body: unknown }[]) =>
  http.post("*/api/traks/:id/act", async ({ params, request }) => {
    sent.push({ id: String(params["id"]), body: await request.json() })
    return HttpResponse.json({ id: C1 }, { status: 202 })
  })

describe("what an acting hook holds when the position moves", () => {
  const talkingTo = (base: TrakDetailDto): TrakDetailDto =>
    parkedPiece(
      base,
      { type: "message", text: `what ${base.description} came back with` },
      { _tag: "AwaitingHuman", step: 1, kind: "conversation" },
    )

  /**
   * The bar never unmounts as the drawer steps, so the draft and the addressee are two things
   * that can come apart — and a send after they have spawns a `claude` on a trak nobody was
   * looking at, with words written for another one.
   */
  it("holds what was typed against the piece it was typed at, across a move", async () => {
    const sent: { id: string; body: unknown }[] = []
    server.use(
      emptyList,
      answers(spawner()),
      ...answersFor(talkingTo(firstPiece), talkingTo(secondPiece)),
      acted(sent),
    )
    renderDetail()

    await goTo("builder — test the band")
    fireEvent.change(await screen.findByLabelText("Say something to the agent"), {
      target: { value: "use the narrow columns" },
    })

    // Empty at the piece it was not typed at, so there is nothing for Send to spend on.
    await goTo("builder — test the columns")
    await waitFor(() => {
      expect(chatField().value).toBe("")
    })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(sent).toEqual([])

    // And still there on the way back — held against its trak rather than dropped, so a
    // reader who stepped away to check something does not lose the paragraph.
    await goTo("builder — test the band")
    await waitFor(() => {
      expect(chatField().value).toBe("use the narrow columns")
    })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => {
      expect(sent).toEqual([
        { id: C1, body: { action: "chat", message: "use the narrow columns" } },
      ])
    })
  })

  /** The same rule for the form, which is a typed draft the pane holds rather than a hook. */
  it("keeps one piece's answers out of the next piece's form", async () => {
    const asks = (base: TrakDetailDto, question: string): TrakDetailDto =>
      parkedPiece(
        base,
        { type: "questions", questions: [{ question, options: [] }] },
        { _tag: "AwaitingHuman", step: 1, kind: "answers" },
      )
    server.use(
      emptyList,
      answers(spawner()),
      ...answersFor(asks(firstPiece, "Which plate size?"), asks(secondPiece, "How many columns?")),
    )
    renderDetail()

    await goTo("builder — test the band")
    fireEvent.change(await screen.findByRole("textbox", { name: "Which plate size?" }), {
      target: { value: "24px, like the list" },
    })

    await goTo("builder — test the columns")
    const field = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "How many columns?",
    })
    expect(field.value).toBe("")
  })

  /**
   * A refusal is the engine's answer to one press on one trak. Drawn at the next position it
   * is the engine appearing to answer a press nobody made there — and the press that *is*
   * there has had nothing said about it.
   */
  it("leaves a refusal at the piece that earned it", async () => {
    const filedAt = (base: TrakDetailDto, summary: string): TrakDetailDto =>
      parkedPiece(
        base,
        { type: "artifact", sections: { Summary: summary } },
        { _tag: "AwaitingHuman", step: 1, kind: "approval" },
      )
    server.use(
      emptyList,
      answers(spawner()),
      ...answersFor(
        filedAt(firstPiece, "the band is on the list"),
        filedAt(secondPiece, "the columns are stacked"),
      ),
      http.post("*/api/traks/:id/act", () =>
        HttpResponse.json({ _tag: "Driving" }, { status: 409, statusText: "Driving" }),
      ),
    )
    renderDetail()

    await goTo("builder — test the band")
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }))
    expect(await screen.findByText("Something is already driving this.")).toBeDefined()

    await goTo("builder — test the columns")
    await screen.findByText("the columns are stacked")
    expect(screen.queryByText("Something is already driving this.")).toBeNull()
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined()
  })
})

/**
 * The other direction, and the one screen that carries two of the same ending: the header's
 * item and the pane's, both at the page's own ending row. The server cannot tell a deliberate
 * second press from a double one, so one trak's ending is one pending state and one refusal
 * whichever surface it was pressed from. The two diverge only where the position belongs to a
 * piece, which is the case the header must not close.
 */
describe("the two Archives on a finished trak's screen", () => {
  it("guards the header's Archive with the press already in flight in the pane", async () => {
    let sent = 0
    const flight = held()
    server.use(
      emptyList,
      // Landed, so the band's ending cell is Archive rather than Merge.
      answers(finished({ landed: { sha: "8c41d0e" } })),
      previews({ into: "main" }),
      http.post(`*/api/traks/${ID}/close`, async () => {
        sent += 1
        await flight.wait
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    // The pane's Archive, through its confirmation, held in flight by the server.
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }))
    const dialog = screen.getByRole("dialog", { name: "Archive this trak?" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }))
    await waitFor(() => {
      expect(sent).toBe(1)
    })

    // The header's is the same hook instance where the two act on the same trak, so its
    // own confirm arrives already disabled. The pane's panel is still open, so the
    // header's is the one inside the menu, scoped rather than guessed at.
    fireEvent.click(screen.getByRole("button", { name: "More options" }))
    const header = screen
      .getAllByRole("menu")
      .find((menu) => within(menu).queryByRole("menuitem", { name: "Archive this trak" }) !== null)
    expect(header).toBeDefined()
    if (header === undefined) return
    fireEvent.click(within(header).getByRole("menuitem", { name: "Archive this trak" }))
    const confirm = within(header).getByRole("button", { name: "Archive" })
    expect(confirm.hasAttribute("disabled")).toBe(true)
    fireEvent.click(confirm)
    expect(sent).toBe(1)

    flight.release()
  })
})

/**
 * A trak the engine wrote an ending for, and the one place it explains itself.
 *
 * The scene the request came from: `API Error: Connection closed mid-response` arriving
 * as an agent bubble *and* as a raw `ApiError(…)` row, a chip reading `provider failed`,
 * and nothing on the surface offering a way back. The pure halves are asserted in
 * `failure.test.ts` and `turns.test.ts`; what only this tier can say is where the notice
 * lands and that the press is on it.
 */
describe("a failed trak", () => {
  const DROPPED = "API Error: Connection closed mid-response. The response above may be incomplete."

  const failed = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
    makeDetail({
      id: ID,
      state: { _tag: "Failed", error: DROPPED, kind: "provider", apiKind: "interrupted" },
      plan: makePlan({
        title: TITLE,
        steps: [
          makeComposeEntry(),
          makeAgentStep({ agent: "planner", instruction: "sketch the routes" }),
          makeAgentStep({ agent: "builder", instruction: "build the drawer" }),
        ],
      }),
      log: [
        makeTrakCreated(),
        makeComposerReturned({ sessionId: "s-plan", output: makeProposal({ title: TITLE }) }),
        makeAgentReturned({ step: 1, sessionId: "s-0" }),
        makeTurnFailed({ step: 2, sessionId: "s-1", reason: DROPPED }),
      ],
      transcript: [
        makeSpawned({ pid: 100 }),
        makeSession({ id: "s-plan" }),
        makeTool({ name: "Glob", kind: "Glob", detail: "**/*.ts" }),
        makeSpawned({ pid: 200 }),
        makeSession({ id: "s-0" }),
        makeTool({ detail: "src/plan.md" }),
        makeSpawned({ pid: 300 }),
        makeSession({ id: "s-1" }),
        makeTool({ name: "Edit", kind: "Edit", detail: "src/app/dto.ts" }),
        // The two rows the notice supersedes, exactly as the engine records them.
        makeText({ text: DROPPED, position: 2 }),
        makeNote({ text: `ApiError(interrupted: ${DROPPED})`, position: 2 }),
      ],
      ...over,
    })

  it("opens on the position it stopped at, and says what happened there", async () => {
    server.use(emptyList, answers(failed()))
    renderDetail()

    await loaded()
    // The words, not the kind. `provider failed` is what the chip said about all six of
    // these, which is the whole complaint.
    expect(screen.getByText("the agent was interrupted")).toBeDefined()
    expect(screen.getByText(/The connection dropped part-way through/)).toBeDefined()
    // And it landed where the turn died — step 2's own call is on screen beneath it.
    expect(screen.getByRole("button", { name: BUILT })).toBeDefined()
  })

  it("says it once — the bubble and the raw ApiError row are gone", async () => {
    server.use(emptyList, answers(failed()))
    renderDetail()

    await loaded()
    expect(screen.queryByText(DROPPED)).toBeNull()
    expect(screen.queryByText(/^ApiError\(/)).toBeNull()
  })

  it("carries the way out on the notice, and shuts the chat bar rather than pointing at it", async () => {
    server.use(emptyList, answers(failed()))
    renderDetail()

    expect(await screen.findByRole("button", { name: "Restart" })).toBeDefined()
    expect(screen.getByText("Runs this position again, from the top.")).toBeDefined()
    // Not a pointer at the press: *restart it above* is false the moment a reader
    // scrolls up past the notice.
    expect(screen.getByPlaceholderText("Nothing is being asked here")).toBeDefined()
  })

  it("takes both the notice and the folded rows away when a reader steps off the position", async () => {
    server.use(emptyList, answers(failed()))
    renderDetail()

    await goTo("planner — sketch the routes")
    expect(screen.queryByRole("button", { name: "Restart" })).toBeNull()
    expect(screen.queryByText("the agent was interrupted")).toBeNull()
  })

  it("explains a worktree failure, which has no transcript row to carry it", async () => {
    // The kind that draws nothing at all today: no turn ran, so there is no entry an
    // explanation could have ridden on — which is why the notice is keyed on the state.
    server.use(
      emptyList,
      answers(
        makeDetail({
          id: ID,
          state: {
            _tag: "Failed",
            error: "fatal: worktree already exists",
            kind: "worktree",
          },
          plan: undefined,
          log: [makeTrakCreated()],
          transcript: [],
        }),
      ),
    )
    renderDetail()

    expect(await screen.findByText("the checkout could not be prepared")).toBeDefined()
    expect(screen.getByText("Prepares the checkout again.")).toBeDefined()
    // Above the empty shell rather than under it: it is the only thing there is to say.
    expect(screen.getByText("Nothing has run here yet")).toBeDefined()
  })
})

/** A trak stopped at step 2's effect, or — without `effecting` — at the same step otherwise. */
const stopped = (effecting: boolean): TrakDetailDto =>
  makeDetail({
    id: ID,
    state: {
      _tag: "Failed",
      error: "`open-pr` could not do what it says",
      kind: "project",
      ...(effecting ? { effecting: true as const } : {}),
    },
    plan: makePlan({
      title: TITLE,
      steps: [
        makeComposeEntry(),
        makeAgentStep({ agent: "planner", instruction: "sketch the routes" }),
        makeAgentStep({ agent: "builder", instruction: "build the drawer" }),
      ],
    }),
    log: [
      makeTrakCreated(),
      makeComposerReturned({ sessionId: "s-plan", output: makeProposal({ title: TITLE }) }),
      makeAgentReturned({ step: 1, sessionId: "s-0" }),
      makeAgentReturned({ step: 2, sessionId: "s-1" }),
      makeWorkCommitted({ step: 2 }),
      makeEffectFailed({ step: 2, name: "open-pr", output: "gh: no auth" }),
    ],
  })

describe("a trak a failed effect stopped", () => {
  it("offers a skip beside the restart, and the skip goes to its own route", async () => {
    const sent: string[] = []
    server.use(
      emptyList,
      answers(stopped(true)),
      http.post("*/api/traks/:id/skip-effects", ({ params }) => {
        sent.push(String(params["id"]))
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    expect(await screen.findByRole("button", { name: "Restart" })).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Skip" }))
    await waitFor(() => {
      expect(sent).toEqual([ID])
    })
  })

  it("offers no skip where something other than an effect stopped it", async () => {
    server.use(emptyList, answers(stopped(false)))
    renderDetail()

    expect(await screen.findByRole("button", { name: "Restart" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull()
  })
})

describe("a failure a runner verb caused", () => {
  it("leads a checkout the sandbox provider's limit refused with the runner's sentence", async () => {
    const printed =
      "sandbox provider refused POST /sandboxes (429): You used all 5 sandbox starts included in the last minute"
    server.use(
      emptyList,
      answers(
        makeDetail({
          id: ID,
          state: {
            _tag: "Failed",
            error: "create sandbox: the sandbox provider's limit was reached: …",
            kind: "worktree",
            runner: {
              kind: "limited",
              said: "The provider allows 5 sandbox starts a minute on this plan; try again in about a minute",
              file: ".orkestra/runner.sh",
              verb: "create",
              stderr: printed,
            },
          },
          plan: undefined,
          log: [makeTrakCreated()],
          transcript: [],
        }),
      ),
    )
    renderDetail()

    expect(await screen.findByText("the sandbox provider's limit was reached")).toBeDefined()
    expect(
      screen.getByText(
        "The provider allows 5 sandbox starts a minute on this plan; try again in about a minute",
      ),
    ).toBeDefined()
    expect(screen.getByText("from .orkestra/runner.sh create")).toBeDefined()
    expect(screen.queryByText("the checkout could not be prepared")).toBeNull()
    // The provider's own text is behind the press, not on the plate.
    expect(screen.queryByText(printed)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show what it printed" }))
    expect(screen.getByText(printed)).toBeDefined()
  })
})

describe("a provider failure nobody named", () => {
  it("shows the provider's own text behind a press, wrapping rather than scrolling", async () => {
    const said = "claude exited 1 before any result: Error: Invalid model name `opus-9`"
    server.use(
      emptyList,
      answers(
        makeDetail({
          id: ID,
          state: { _tag: "Failed", error: said, kind: "provider" },
          plan: undefined,
          log: [makeTrakCreated()],
          transcript: [],
        }),
      ),
    )
    renderDetail()

    expect(await screen.findByText("the agent's CLI stopped")).toBeDefined()
    expect(screen.queryByText(said)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show what it printed" }))
    const shown = screen.getByText(said)
    expect(shown.closest("pre")?.className).toContain("whitespace-pre-wrap")
  })

  it("keeps a classified failure's text off the notice, press and all", async () => {
    const said = '{"type":"error","error":{"type":"rate_limit_error"}}'
    server.use(
      emptyList,
      answers(
        makeDetail({
          id: ID,
          state: { _tag: "Failed", error: said, kind: "provider", apiKind: "rate_limit" },
          plan: undefined,
          log: [makeTrakCreated()],
          transcript: [],
        }),
      ),
    )
    renderDetail()

    expect(await screen.findByText("the API turned the agent away")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Show what it printed" })).toBeNull()
  })
})

describe("a setup that failed", () => {
  it("says setup failed, and shows what it printed behind a press", async () => {
    const printed = "ERR_PNPM_OUTDATED_LOCKFILE: Cannot install with frozen-lockfile"
    server.use(
      emptyList,
      answers(
        makeDetail({
          id: ID,
          state: {
            _tag: "Failed",
            error: `setup failed in /w:\n${printed}`,
            kind: "worktree",
            setup: printed,
          },
          plan: undefined,
          log: [makeTrakCreated()],
          transcript: [],
        }),
      ),
    )
    renderDetail()

    expect(await screen.findByText("the project's setup.sh failed")).toBeDefined()
    expect(screen.getByText("Runs setup.sh again, then the work it stopped.")).toBeDefined()
    expect(screen.queryByText("the checkout could not be prepared")).toBeNull()
    expect(screen.queryByText(printed)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show what it printed" }))
    expect(screen.getByText(printed)).toBeDefined()
  })
})

describe("a remake that left the uncommitted changes behind", () => {
  it("names the ref that keeps them, and never says nothing is lost", async () => {
    server.use(
      emptyList,
      answers(
        makeDetail({
          id: ID,
          state: {
            _tag: "Failed",
            error:
              "put back uncommitted changes: the uncommitted changes carried across the remake of t1's sandbox did not apply, and are kept at refs/orkestra/carried/t1 in /project: exited 1",
            kind: "provider",
            carried: "refs/orkestra/carried/t1",
          },
          plan: undefined,
          log: [makeTrakCreated()],
          transcript: [],
        }),
      ),
    )
    renderDetail()

    expect(await screen.findByText("the uncommitted changes did not come across")).toBeDefined()
    expect(screen.getByText("refs/orkestra/carried/t1")).toBeDefined()
    expect(
      screen.getByText("Starts again from the trak's branch, without those changes."),
    ).toBeDefined()
    expect(screen.queryByText(/nothing to lose/)).toBeNull()
  })
})

/**
 * The same interruption, a restart later — which is the shape every one of them ends up in.
 *
 * The notice above is keyed on the trak's *current* state, so the moment a restart moves it
 * off `Failed` both the sentence and the fold go with it, and the two rows the notice was
 * standing in for come back as raw transcript: the agent's error prose as a bubble and
 * `ApiError(interrupted: …)` as a plain line, in the middle of a turn that otherwise reads
 * as ordinary work. `.orkestra/.database/traks/f6d79968-4ac8-42cf-9781-fb0fbbf47227` is that
 * trak on disk — `TurnFailed{step: 1, apiKind: "interrupted"}`, a `Restarted`, an
 * `AgentReturned`, and transcript lines 183 and 185 still holding both rows.
 *
 * A failure that has been restarted past is history rather than a standing condition, so
 * what it earns is a line, not the notice's plate and press. But it earns one: the turn
 * ended for a reason, and the raw rows are the reason said badly.
 */
describe("a trak restarted past an interruption", () => {
  const DROPPED = "API Error: Connection closed mid-response. The response above may be incomplete."

  const restarted = (): TrakDetailDto =>
    makeDetail({
      id: ID,
      // Not `Failed` any more: the restart worked and the position filed.
      state: { _tag: "AwaitingHuman", step: 2, kind: "approval" },
      plan: makePlan({
        title: TITLE,
        steps: [
          makeComposeEntry(),
          makeAgentStep({ agent: "planner", instruction: "sketch the routes" }),
          makeAgentStep({ agent: "builder", instruction: "build the drawer" }),
        ],
      }),
      log: [
        makeTrakCreated(),
        makeComposerReturned({ sessionId: "s-plan", output: makeProposal({ title: TITLE }) }),
        makeAgentReturned({ step: 1, sessionId: "s-0" }),
        // `apiKind` as the engine wrote it: the provider classified this one, and it is the
        // half that says *interrupted* rather than merely *stopped*.
        makeTurnFailed({ step: 2, sessionId: "s-1", reason: DROPPED, apiKind: "interrupted" }),
        makeRestarted({ sessionId: "s-1", step: 2 }),
        makeAgentReturned({ step: 2, sessionId: "s-1" }),
      ],
      transcript: [
        makeSpawned({ pid: 100 }),
        makeSession({ id: "s-plan" }),
        makeTool({ name: "Glob", kind: "Glob", detail: "**/*.ts" }),
        makeSpawned({ pid: 200 }),
        makeSession({ id: "s-0" }),
        makeTool({ detail: "src/plan.md" }),
        // Step 2's first attempt: it worked, and then the connection dropped.
        makeSpawned({ pid: 300 }),
        makeSession({ id: "s-1" }),
        makeTool({ name: "Edit", kind: "Edit", detail: "src/app/dto.ts" }),
        makeText({ text: DROPPED, position: 2 }),
        makeNote({ text: `ApiError(interrupted: ${DROPPED})`, position: 2 }),
        // And the attempt the restart bought, resuming the same session.
        makeSpawned({ pid: 400 }),
        makeSession({ id: "s-1" }),
        makeTool({ name: "Write", kind: "Write", detail: "src/app/drive.ts" }),
      ],
    })

  it("keeps the interruption as a line rather than letting the raw rows back in", async () => {
    server.use(emptyList, answers(restarted()))
    renderDetail()

    await loaded()
    // Both attempts are on screen, so this is the position the interruption happened at.
    expect(screen.getByRole("button", { name: BUILT })).toBeDefined()

    // The provider's own prose, drawn as an agent bubble in the middle of the turn.
    expect(screen.queryByText(DROPPED)).toBeNull()
    // And the engine's note for the same event, drawn as a plain transcript line.
    expect(screen.queryByText(/^ApiError\(/)).toBeNull()
  })

  it("still says what stopped that turn, in the words the notice used", async () => {
    server.use(emptyList, answers(restarted()))
    renderDetail()

    await loaded()
    // `WhyRan` already heads the second attempt with *Restarted — the turn was cut off*,
    // which says a turn was picked back up and nothing about why. The kind is the half that
    // goes missing, and `failure.ts` already has the words for it — read off it rather than
    // spelled again here, so the line and the notice cannot drift into two vocabularies.
    // Not asserted as `/interrupted/`: the `ApiError(…)` row this is meant to replace holds
    // that word, so a loose match passes on exactly the thing that is wrong.
    expect(
      screen.getByText(
        failureWords({ _tag: "Failed", error: DROPPED, kind: "provider", apiKind: "interrupted" })
          .head,
      ),
    ).toBeDefined()
  })
})

/**
 * The two states that are an ending **and** a command in flight, and the position they rest
 * at: the ending row, which is the one row with no turns to end a chronology of.
 *
 * Killing `pnpm ui` during a `git merge` lands here. The header band used to carry the way
 * back from every position, and with the band gone and the pane drawing only the ending, the
 * notice was built and thrown away — no press anywhere in the UI, since the ending itself
 * offers none while it is running. It reaches a piece too, because a child's column keeps
 * its own ending row.
 *
 * **The notice is the block's stopped face now**, at these two states and at the five other
 * ones the engine works at: the same act in an error face, carrying the same press. So what
 * these pin is that the press survived the change of surface — the way back is the whole
 * point of the group, and it has been thrown away here once already.
 */
describe("a trak stopped while ending", () => {
  it("draws the way back in place of the ending, where a merge stopped part-way through", async () => {
    server.use(
      emptyList,
      answers(finished({ state: { _tag: "Merging" } })),
      previews({ into: "main" }),
    )
    renderDetail()

    expect(await screen.findByText("Stopped while merging")).toBeDefined()
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined()
    // The ending is not under it saying something else: one account of the position, in
    // the past tense the trak is actually in.
    expect(screen.queryByText("Merging it now.")).toBeNull()
  })

  it("does the same for one that stopped while clearing its checkout up", async () => {
    // `Closing` asks no merge preview, which is the other half of why the two are separate
    // states rather than one — and it has no press of its own here either.
    server.use(emptyList, answers(finished({ state: { _tag: "Closing" } })))
    renderDetail()

    expect(await screen.findByText("Stopped while clearing up")).toBeDefined()
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined()
    expect(screen.queryByText("Closing it now.")).toBeNull()
  })

  /** The piece's own ending row, reached from the parent — and the press names the piece. */
  it("picks a piece back up that stopped merging into its parent", async () => {
    const sent: string[] = []
    const merging = piece(C1, "wire the band", "test the band", "traks-list/TrakRow.tsx", {
      state: { _tag: "Merging" },
    })
    server.use(
      emptyList,
      answers(spawner()),
      ...answersFor(merging, secondPiece),
      http.get(`*/api/traks/${C1}/merge`, () => HttpResponse.json({ parentId: ID })),
      http.post("*/api/traks/:id/resume", ({ params }) => {
        sent.push(String(params["id"]))
        return HttpResponse.json({ id: C1 }, { status: 202 })
      }),
    )
    renderDetail()

    await goTo("Merged — Integrating work…")
    expect(screen.getByText("Stopped while merging")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Resume" }))

    // The parent is standing at the spawn and is not stopped at all, so a press keyed to
    // the page's trak would have gone to the wrong id — and to a trak that is fine.
    await waitFor(() => {
      expect(sent).toEqual([C1])
    })
  })

  it("reaches a piece that stopped closing, at its own ending row and no other", async () => {
    const closing = piece(C1, "wire the band", "test the band", "traks-list/TrakRow.tsx", {
      state: { _tag: "Closing" },
    })
    server.use(emptyList, answers(spawner()), ...answersFor(closing, secondPiece))
    renderDetail()

    // It opens at that piece's first step, which is not where it stopped.
    await loaded()
    expect(screen.queryByText("Stopped while clearing up")).toBeNull()

    await goTo("Closed — Archiving trak…")
    expect(screen.getByText("Stopped while clearing up")).toBeDefined()
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined()
  })
})

/**
 * A merge git refused is the one failure that keeps the finishing card: the drawer opens
 * on the ending, the refusal is a plate under the sentence with git's own words in it, and
 * the Merge press is the way to run it again — no Restart on a notice. The words are
 * `mergeRefusal.test.ts`'s and the pane's own layout `FinishedView.test.tsx`'s; what only
 * this tier can say is where the drawer lands and that no notice is drawn beside it.
 */
describe("a trak whose merge git refused", () => {
  const SAID = [
    "merge: git merge --no-ff trak/auto-commit exited 2: error: Your local changes to the following files would be overwritten by merge:",
    "\tsrc/a.ts",
    "Aborting",
  ].join("\n")
  const refused = finished({ state: { _tag: "Failed", kind: "merge", error: SAID } })

  it("opens on the ending with the refusal above the card and the Merge press under it", async () => {
    server.use(emptyList, answers(refused), previews({ into: "main" }))
    renderDetail()

    expect(await screen.findByText("the merge was refused")).toBeDefined()
    expect(screen.getByText(/Your local changes to the following files/)).toBeDefined()
    expect(screen.getByRole("button", { name: "Merge into main" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Restart" })).toBeNull()
  })

  /**
   * The commit press's two exits, on the page that holds both hooks. Merge is refused over
   * a dirty parent and the plate lists the files; the commit press lands, git declines the
   * merge it re-issued for a second reason, and the plate that comes back is git's newer
   * words — not the list of files that were just committed, which `useMerge` would
   * otherwise still hold.
   */
  it("shows git's second refusal after a commit-and-merge, not the files it committed", async () => {
    const declined =
      "check checkout branch: /w/blank-white-booby is on main, not trak/blank-white-booby: whatever was committed there is not on the trak's branch, so nothing here can tell work from an empty branch. The checkout is kept — move or merge the commits onto trak/blank-white-booby and retry."
    let state: TrakDetailDto["state"] = { _tag: "Finished" }
    server.use(
      emptyList,
      http.get(`*/api/traks/${ID}`, () => HttpResponse.json(finished({ state }))),
      previews({ branch: "trak/auto-commit", parentId: "blank-white-booby" }),
      merges(() =>
        HttpResponse.json(
          { _tag: "Dirty", files: ["?? shared.md"] },
          { status: 409, statusText: "Dirty" },
        ),
      ),
      http.post(`*/api/traks/${ID}/commit-and-merge`, () => {
        state = { _tag: "Failed", kind: "merge", error: declined }
        return HttpResponse.json({ id: ID }, { status: 202 })
      }),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Merge into its parent" }))
    expect(await screen.findByText(/uncommitted work there/)).toBeDefined()
    expect(screen.getByText(/shared\.md/)).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "Commit blank-white-booby and merge" }))

    expect(await screen.findByText(/is on main, not trak\/blank-white-booby/)).toBeDefined()
    expect(screen.queryByText(/uncommitted work there/)).toBeNull()
    expect(screen.getByRole("button", { name: "Merge into its parent" })).toBeDefined()
  })
})
