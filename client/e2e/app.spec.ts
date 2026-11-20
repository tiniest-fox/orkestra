import type { Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import type { TrakDetailDto, TrakSummaryDto } from "@orkestra/shared/dto/trak"
import { viewDocument } from "../../src/app/view-policy"

/**
 * What only a browser can answer.
 *
 * Each case here is a thing the unit tiers are structurally unable to see: the app
 * composed as it ships, the Vite proxy in the path, and a real `EventSource`.
 */

test("renders the chrome and the list, with nothing in the console", async ({ page }) => {
  const problems: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text())
  })
  page.on("pageerror", (error) => problems.push(error.message))
  // Chromium's console line for a failed load names no URL, so a failure here once could
  // not say which request it was. The response can.
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`${String(response.status())} ${response.url()}`)
  })

  await page.goto("/")

  // The wordmark is the one thing on screen at every route, so it is what a blank page
  // fails to show — which is exactly how the bug this tier was written for looked.
  // `exact` for the reason the next assertion has it, and this one learned it the hard
  // way: a failed trak's chip reads "Orkestra broke", so a substring match found the
  // wordmark three times over on a checkout that had two of them.
  await expect(page.getByText("Orkestra", { exact: true })).toBeVisible()
  // `exact`, for the same reason line 69 is: this suite runs against whatever traks this
  // checkout has, and a substring match reads a *description* as a control. A trak
  // described "re-work the new trak screen" matched this three ways over.
  await expect(page.getByRole("link", { name: "New Trak", exact: true })).toBeVisible()
  // Either rows or the empty state: which one depends on the database this checkout
  // happens to have, and asserting on that would make the suite depend on it.
  await expect(page.locator("ul li").first().or(page.getByText("No traks yet"))).toBeVisible()

  expect(problems).toEqual([])
})

test("holds the engine stream open through the dev proxy", async ({ page }) => {
  // The transport tier never opens a socket and the hook tier is handed a fake, so this
  // is the only place the real thing is exercised — including the proxy, which has to
  // pass it through unbuffered rather than batching it.
  // The path has to *end* at `/api/stream`: Vite serves the transport module itself at
  // `/src/api/stream.ts`, and a substring match took that script for the stream.
  const opened = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/api/stream") && response.status() === 200,
  )
  await page.goto("/")
  const response = await opened
  expect(response.headers()["content-type"]).toContain("text/event-stream")
  // `no-transform` is what stops anything in front of the engine buffering the stream
  // into a batch delivered on the heartbeat, which reads as an engine that has stopped.
  expect(response.headers()["cache-control"]).toContain("no-transform")
})

test("opens the new trak drawer, and will not start one with nothing typed", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("link", { name: "New Trak", exact: true }).click()

  await expect(page).toHaveURL(/\/traks\/new$/)
  const drawer = page.getByRole("complementary", { name: "New Trak" })
  await expect(drawer.getByRole("heading", { name: "New Trak" })).toBeVisible()

  // **Deliberately never enabled in this suite.** The engine here is real, so a click
  // that got through would run a composer and bill for it. Asserting it is disabled
  // while the field is empty is the strongest thing that is safe to check.
  const start = drawer.getByRole("button", { name: "Start trak" })
  await expect(start).toBeDisabled()
  await drawer.getByRole("textbox").fill("   ")
  await expect(start).toBeDisabled()
})

test("closes the drawer back to the list", async ({ page }) => {
  await page.goto("/traks/new")
  // Scoped to the drawer and exact: the drawer's Close shuts a panel, where a finished
  // row in the list behind carries `Archive`, the press that deletes a trak's footprint.
  // The list is *supposed* to stay reachable behind the drawer, so scoping is the price
  // of having no scrim rather than a defect.
  const drawer = page.getByRole("complementary", { name: "New Trak" })
  await drawer.getByRole("link", { name: "Close", exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(drawer).toBeHidden()
})

/**
 * The git strip is never under a drawer: the drawer stops at the strip's top edge, so the
 * drawer's own foot — its chat bar, its presses — is never behind the strip either. A
 * layout fact happy-dom cannot measure. The status is stubbed so the strip has something to
 * draw whatever this checkout's remote says, and no press is made.
 */
test("stops an open drawer at the git strip's top edge", async ({ page }) => {
  await page.route("**/api/git", (route) =>
    route.fulfill({
      json: {
        head: { _tag: "Branch", name: "main" },
        origin: true,
        upstream: { name: "origin/main", ahead: 0, behind: 2 },
        fetchedAt: Date.now(),
        fetching: false,
      },
    }),
  )
  await page.goto("/traks/new")
  const strip = page.getByRole("contentinfo", { name: "Project checkout" })
  const action = strip.getByRole("button", { name: "Pull" })
  await expect(action).toBeVisible()
  // The action is a full-bleed cell: the strip's whole height, flush to the window's edge
  // but for the chevron beside it.
  expect(await action.evaluate((node) => node.getBoundingClientRect().height)).toBe(31)
  const drawer = page.getByRole("complementary", { name: "New Trak" })
  const stripAt = await strip.evaluate((node) => node.getBoundingClientRect())
  const drawerAt = await drawer.evaluate((node) => node.getBoundingClientRect())
  expect(stripAt.height).toBe(32)
  expect(stripAt.bottom).toBe(page.viewportSize()?.height)
  expect(drawerAt.bottom).toBe(stripAt.top)
})

/**
 * The header's ending, which is two presses inside a panel that dismisses on focus-out.
 *
 * **The one case here that stubs the engine rather than reading it**, and both halves of
 * that are deliberate. What is being tested is a *focus* interaction — a menu item
 * unmounting under the cursor, then a danger button disabling itself mid-flight — and
 * Chromium fires a bubbling `focusout` with `relatedTarget: null` for each of them, which
 * is the event `OverflowMenu` has to tell apart from focus genuinely leaving. happy-dom
 * implements neither blur-on-removal nor blur-on-disable, and `fireEvent.click` moves no
 * focus, so `TrakDetailPage.test.tsx` passes over behaviour that does not happen there.
 * That is what puts this in the browser tier.
 *
 * Stubbing is what makes it deterministic: reaching this panel for real needs a trak with
 * an agent mid-turn and a drive holding it, which is a state this suite would have to
 * *create* — and creating one spends money, which `e2e/README.md` forbids. The abandon is
 * answered `409 AtRest` because a refusal is the case the panel has to outlive; a 202
 * would tear the drawer down and prove nothing about the second press.
 *
 * **Where focus *is* belongs here too, and only here.** The item unmounting takes focus to
 * `<body>` in Chromium and nowhere in happy-dom, so the panel taking it back onto its own press
 * — which is what leaves Escape working — is a claim no unit tier can make. The keyboard
 * open is in for the hazard that comes with it: a destructive press under focus while the
 * key that opened the panel is still down.
 *
 * **One `focusout` is dispatched by hand, and that is not a shortcut.** React delivers
 * neither self-inflicted one to `OverflowMenu`'s handler today, because both are raised
 * inside its own commit — so the real presses below exercise the panel and cannot reach
 * the predicate that keeps it open. Dispatching one at the disabled button is what puts
 * the guard itself under test; without it this case passes against the unguarded
 * component. Everything around it is a real press.
 */
const ID = "e2e0e2e0-1111-4222-8333-444444444444"

/** Long enough that the confirmation is demonstrably in its disabled state mid-flight. */
const ABANDON_MS = 1000

const working: TrakDetailDto = {
  id: ID,
  description: "check the two-press ending",
  mode: "manual",
  holding: false,
  skippingChecks: false,
  messages: [],
  returned: [],
  // The one case the header menu is for: an agent mid-turn, with the drive holding it.
  state: { _tag: "AgentWorking", step: 1 },
  plan: {
    title: "Check the two-press ending",
    steps: [
      { type: "compose" },
      { type: "agent", agent: "builder", instruction: "build it", conversational: false },
    ],
  },
  decisions: [],
  marks: [],
  nextChecks: [],
  deployScript: false,
  log: [{ _tag: "TrakCreated", description: "check the two-press ending" }],
  transcript: [],
  custody: { holder: { since: 1_786_028_700_000 } },
}

/**
 * The other home of the same confirmation: a finished trak that committed nothing, which
 * is the pane where Archive is promoted out of the `⋯` into a floated panel of its own.
 * No commit on the log is what keeps the forge and the merge preview unasked, so the pane
 * draws whole off this one fixture.
 */
const FINISHED_ID = "e2e0e2e0-1111-4222-8333-555555555555"

const finished: TrakDetailDto = {
  ...working,
  id: FINISHED_ID,
  description: "check the promoted ending",
  state: { _tag: "Finished" },
  plan: {
    title: "Check the promoted ending",
    steps: [
      { type: "compose" },
      { type: "agent", agent: "builder", instruction: "build it", conversational: false },
    ],
  },
  log: [{ _tag: "TrakCreated", description: "check the promoted ending" }],
  custody: {},
}

const ENDED_ID = "e2e0e2e0-1111-4222-8333-666666666666"

/**
 * A finished trak whose pull request merged, with a review long enough that the card runs
 * past the drawer at a desk — the case the band under the card exists for. The commit on
 * the log is what makes the forge and the merge preview ask, so both are stubbed below.
 */
const ended: TrakDetailDto = {
  ...finished,
  id: ENDED_ID,
  description: "reach Archive under a long review",
  plan: {
    title: "Reach Archive under a long review",
    steps: [
      { type: "compose" },
      { type: "agent", agent: "builder", instruction: "build it", conversational: false },
    ],
  },
  log: [
    { _tag: "TrakCreated", description: "reach Archive under a long review" },
    { _tag: "WorkCommitted", step: 1, sha: "abc1234" },
  ],
  worktree: { path: "/tmp/e2e", branch: "trak/e2e-ended", base: "main" },
}

/** The last words on the card, so a case can say the card really does run off the screen. */
const LAST_WORDS = "This is the last comment on the pull request."

/** Three open conversations for one review, each a paragraph, each on its own line. */
const threadsOf = (review: number) =>
  Array.from({ length: 3 }, (_, thread) => ({
    path: "client/src/features/trak-detail/FinishedView.tsx",
    line: 10 * review + thread,
    resolved: false,
    outdated: false,
    comments: [
      {
        who: `reviewer-${String(review)}`,
        body:
          "A paragraph long enough to wrap a few times in the drawer, so that eighteen " +
          "of these together run the card well past the bottom of the pane.",
        url: `https://github.com/o/r/pull/77#discussion_r${String(10 * review + thread)}`,
        at: 1_786_028_700_000,
      },
    ],
  }))

const longPullRequest = {
  _tag: "PullRequest",
  number: 77,
  url: "https://github.com/o/r/pull/77",
  title: "Reach Archive under a long review",
  state: "merged",
  isDraft: false,
  merging: "clean",
  rollup: "none",
  checks: [],
  reviews: Array.from({ length: 6 }, (_, review) => ({
    id: `review-${String(review)}`,
    who: `reviewer-${String(review)}`,
    verdict: "commented",
    at: 1_786_028_700_000,
    url: `https://github.com/o/r/pull/77#pullrequestreview-${String(review)}`,
    threads: threadsOf(review),
  })),
  conversation: [
    {
      who: "reviewer-0",
      body: LAST_WORDS,
      url: "https://github.com/o/r/pull/77#issuecomment-1",
      at: 1_786_028_700_000,
    },
  ],
  truncated: [],
  mergeMethods: [],
}

/**
 * One handler over every `/api/traks…` path, branching on the URL rather than three
 * registrations: Playwright runs the *last* matching route first, so overlapping globs
 * make the order the thing under test.
 *
 * `/api/stream` is deliberately not intercepted — the real `EventSource` stays connected
 * to the real engine, which is the tier's own premise.
 */
const stubbed = async (page: Page): Promise<{ readonly sent: () => number }> => {
  let sent = 0
  await page.route("**/api/traks**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith("/abandon")) {
      sent += 1
      await new Promise((resolve) => setTimeout(resolve, ABANDON_MS))
      // No `statusText`: the client reads the refusal body first and only falls back to
      // the reason phrase, and the body is what carries the sentence.
      return route.fulfill({ status: 409, json: { _tag: "AtRest" } })
    }
    if (path === `/api/traks/${ID}`) return route.fulfill({ json: working })
    if (path === `/api/traks/${FINISHED_ID}`) return route.fulfill({ json: finished })
    if (path === `/api/traks/${ENDED_ID}`) return route.fulfill({ json: ended })
    if (path === `/api/traks/${ENDED_ID}/pull-request`)
      return route.fulfill({ json: longPullRequest })
    if (path === `/api/traks/${ENDED_ID}/merge`)
      return route.fulfill({ json: { branch: "trak/e2e-ended", into: "main", conflicts: false } })
    if (path === "/api/traks") return route.fulfill({ json: { traks: [], archived: 0 } })
    return route.continue()
  })
  // Counted rather than asserted from the screen: what a keyboard press must *not* do is
  // send an abandon, and a press that did would look identical for the first frame.
  return { sent: () => sent }
}

test("keeps the ending's confirmation open across both presses, and shows the refusal", async ({
  page,
}) => {
  const abandon = await stubbed(page)
  await page.goto(`/traks/${ID}`)

  const drawer = page.getByRole("complementary", { name: "Trak" })
  await expect(drawer.getByRole("heading", { name: "Check the two-press ending" })).toBeVisible()

  const trigger = drawer.getByRole("button", { name: "More options" })
  const item = drawer.getByRole("menuitem", { name: "Archive this trak" })

  // Escape still shuts it, from the state where focus is still inside the group.
  await trigger.click()
  await expect(item).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(item).toBeHidden()

  // And so does a click on non-focusable background — a `focusout` with no `relatedTarget`
  // from a child that is still there and still enabled. This is the dismissal the guard
  // below must not have taken with it, and it is how a menu is normally shut.
  await trigger.click()
  await expect(item).toBeVisible()
  await drawer.getByRole("heading", { name: "Check the two-press ending" }).click()
  await expect(item).toBeHidden()

  // Press one. The item unmounts as `asking` flips, which is the first self-inflicted
  // `focusout`; the confirmation replacing it is what says the panel outlived it.
  await trigger.click()
  await item.click()

  const confirm = drawer.getByRole("button", { name: "Archive" })
  await expect(confirm).toBeVisible()

  // The item took focus to `<body>` with it when it went. The panel has to take it back,
  // because Escape is a handler on the group and a keystroke at the document never gets
  // there — so this assertion and the next are one thing said twice on purpose: where focus
  // is, and what that buys.
  await expect(confirm).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(confirm).toBeHidden()

  // Opened by keyboard this time, which is the hop that has to be safe: focus lands on a
  // destructive press while the key that opened the panel is still down. Enter activates a
  // button on `keydown` and the item consumed that one, so nothing is sent.
  await trigger.click()
  await item.press("Enter")
  await expect(confirm).toBeFocused()
  expect(abandon.sent()).toBe(0)

  // Press two. The button disables itself for as long as the abandon is in flight, which
  // is the second self-inflicted `focusout` — and the one dispatched by hand, because
  // React swallows the real one. Guarded, the panel stays; unguarded, it vanishes here.
  await confirm.click()
  await expect(confirm).toBeDisabled()
  // `new FocusEvent` in the page rather than `locator.dispatchEvent`: Playwright's own
  // dispatcher does not put a null `relatedTarget` on the event, and null is the whole
  // shape being reproduced.
  await confirm.evaluate((element) => {
    element.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }))
  })
  await expect(confirm).toBeVisible()

  // The panel has to still be there to say why the engine refused, because the sentence is
  // drawn inside it — that is the whole reason it may not dismiss on the press.
  await expect(drawer.getByRole("alert")).toHaveText("That trak has already come to rest.")
  await expect(confirm).toBeEnabled()

  // Not stuck open either: the trigger shuts what it opened, whatever focus is doing.
  await trigger.click()
  await expect(confirm).toBeHidden()
})

/**
 * The same panel in its promoted home, where the container is the pane's own wrapper
 * rather than `OverflowMenu`. What is asserted is the half that home has to supply
 * itself: that Escape shuts it from the press the panel put focus on. The focus claim is
 * `Confirmation`'s and is the same one the menu case above pins; the handler is the
 * wrapper's, and a wrapper without one is a `role="dialog"` Escape cannot leave.
 */
test("shuts the promoted Archive confirmation on Escape, from the press it focused", async ({
  page,
}) => {
  await stubbed(page)
  await page.goto(`/traks/${FINISHED_ID}`)

  const drawer = page.getByRole("complementary", { name: "Trak" })
  await expect(drawer.getByRole("heading", { name: "Check the promoted ending" })).toBeVisible()

  // Promoted: the press is in the row, not behind a `⋯`.
  await drawer.getByRole("button", { name: "Archive", exact: true }).click()
  const dialog = drawer.getByRole("dialog", { name: "Archive this trak?" })
  const confirm = dialog.getByRole("button", { name: "Archive" })
  await expect(confirm).toBeFocused()

  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  // And the row under it is untouched — the trigger is still there to open it again.
  await expect(drawer.getByRole("button", { name: "Archive", exact: true })).toBeVisible()
})

/**
 * The finished pane's presses under a long pull-request card. The band holding them is
 * sticky in the drawer's pane, which happy-dom cannot see and an atelier proof cannot hold —
 * so the claim that Archive is on screen whatever the card's length is measured here.
 */
test("keeps the finished pane's presses on screen under a long pull-request card", async ({
  page,
}) => {
  await stubbed(page)
  await page.goto(`/traks/${ENDED_ID}`)

  const archive = page.getByRole("button", { name: "Archive", exact: true })
  await expect(archive).toBeVisible()
  await expect(page.getByText(LAST_WORDS)).toBeAttached()

  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  if (viewport === null) return
  const inside = async (control: Locator): Promise<boolean> => {
    const box = await control.boundingBox()
    return box !== null && box.y >= 0 && box.y + box.height <= viewport.height
  }

  // The premise: the card runs past the pane, so the press would be off screen if it were
  // in the flow. Then the press, on screen anyway — and still there once the reader has
  // scrolled to the end.
  const last = await page.getByText(LAST_WORDS).boundingBox()
  expect(last).not.toBeNull()
  expect(last?.y ?? 0).toBeGreaterThan(viewport.height)
  expect(await inside(archive)).toBe(true)

  await page.getByText(LAST_WORDS).scrollIntoViewIfNeeded()
  expect(await inside(archive)).toBe(true)
})

/**
 * The request box with several things ticked. The box opens inside the pinned band, so the
 * band is bounded rather than grown per tick: past two lines the ticked list scrolls inside
 * the box. Unbounded, three ticks covered the whole pane at 375×667. So the band is the
 * same height at two ticks as at more, and a ticked row scrolled clear of it is pressable.
 */
test("keeps the card readable with several comments ticked and the box open", async ({ page }) => {
  await stubbed(page)
  await page.goto(`/traks/${ENDED_ID}`)

  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  if (viewport === null) return
  const inside = async (control: Locator): Promise<boolean> => {
    const box = await control.boundingBox()
    return box !== null && box.y >= 0 && box.y + box.height <= viewport.height
  }

  const boxes = page.getByRole("checkbox", { name: /^reviewer-/ })
  const band = page
    .getByRole("button", { name: "Archive", exact: true })
    .locator("xpath=ancestor::div[contains(@class,'sticky')][1]")
  await expect(boxes.first()).toBeVisible()
  await boxes.nth(0).check()
  await boxes.nth(1).check()
  await expect(page.getByText("What should change?")).toBeAttached()
  const two = (await band.boundingBox())?.height
  await boxes.nth(2).check()
  await boxes.nth(3).check()
  await boxes.nth(4).check()
  expect((await band.boundingBox())?.height).toBe(two)

  // The presses that have to stay reachable are in the band, wherever the pane is scrolled.
  const send = page.getByRole("button", { name: "Send it back" })
  const archive = page.getByRole("button", { name: "Archive", exact: true })
  expect(await inside(send)).toBe(true)
  expect(await inside(archive)).toBe(true)

  // And a ticked row is still a row somebody can read and untick: scrolled clear of the
  // band, the point at its centre lands on the checkbox itself.
  const first = boxes.first()
  // Halfway between the pane's top and the band's, which is the part of the pane left
  // uncovered — `scrollIntoView` centres on the whole pane, where the band is.
  const top = (await band.boundingBox())?.y ?? 0
  await first.evaluate((node: Element, bandTop: number) => {
    let pane = node.parentElement
    while (pane !== null && getComputedStyle(pane).overflowY !== "auto") pane = pane.parentElement
    if (pane === null) return
    const paneTop = pane.getBoundingClientRect().top
    pane.scrollTop += node.getBoundingClientRect().top - (paneTop + (bandTop - paneTop) / 2)
  }, top)
  const onTop = await first.evaluate((node: Element) => {
    const at = node.getBoundingClientRect()
    return document.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2) === node
  })
  expect(onTop).toBe(true)
  expect(await inside(send)).toBe(true)
  expect(await inside(archive)).toBe(true)
})

/**
 * A door pressed from the pinned band answers in the box, which opens inside the band above
 * the row — on screen however long the review is — and takes focus into its field.
 */
test("brings the field a door opens on screen, focused and under nothing", async ({ page }) => {
  await stubbed(page)
  await page.goto(`/traks/${ENDED_ID}`)
  // Not before the review has drawn: the door press exists from the first paint, and the
  // case is about the box opening on a pane that runs past the screen.
  await expect(page.getByText(LAST_WORDS)).toBeAttached()

  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  if (viewport === null) return
  const shown = async (field: Locator): Promise<boolean> => {
    const box = await field.boundingBox()
    if (box === null || box.y < 0 || box.y + box.height > viewport.height) return false
    return field.evaluate((node: Element) => {
      const at = node.getBoundingClientRect()
      return (
        document.activeElement === node &&
        document.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2) === node
      )
    })
  }

  await page.getByRole("button", { name: "More work on it" }).click()
  expect(await shown(page.getByRole("textbox", { name: "What should change?" }))).toBe(true)

  await page.getByRole("button", { name: "Ask about it" }).click()
  expect(await shown(page.getByRole("textbox", { name: "What do you want to ask?" }))).toBe(true)
})

/**
 * The header's two panels draw over the card pinned under them.
 *
 * `CardShell` pins a card's header `sticky z-10` inside the scrolling pane, and the
 * header band is `z-20` — the rank is on the band, so the panels hanging inside it (the
 * run-mode picker and the ending's `⋯`, each `z-10` inside the band) clear the card by
 * their host's rank. Before the band had one, panel and pinned header met at equal rank
 * and tree order let the card draw over the open panel's rows. happy-dom loads no stylesheet,
 * so no rank resolves anywhere below this tier — `components/README.md`'s layering
 * section carries the ladder.
 *
 * **Every press here is `trial: true`.** The actionability checks still run — a covered
 * row fails the receives-events check, which is the whole assertion — and nothing is
 * actually pressed, because a row in the picker sets a real trak's run mode.
 */
const OVERLAP_ID = "e2e0e2e0-5555-4666-8777-888888888888"

/** Enough of a document that the card outgrows the pane and its header pins. */
const LONG_SUMMARY = Array.from(
  { length: 20 },
  (_, i) => `Paragraph ${String(i + 1)}: long enough that the card is taller than the pane.`,
).join("\n\n")

const overlapped: TrakDetailDto = {
  ...working,
  id: OVERLAP_ID,
  description: "pin a card under the header",
  plan: {
    title: "Pin a card under the header",
    steps: [
      { type: "compose" },
      { type: "agent", agent: "builder", instruction: "file it", conversational: false },
    ],
  },
  log: [
    { _tag: "TrakCreated", description: "pin a card under the header" },
    {
      _tag: "AgentReturned",
      step: 1,
      sessionId: "s-pin",
      output: { type: "artifact", sections: { Summary: LONG_SUMMARY } },
    },
  ],
  transcript: [{ _tag: "Session", id: "s-pin", position: 1 }],
}

test("draws the Run Mode and More options panels over a card's pinned header", async ({ page }) => {
  await page.route("**/api/traks**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === `/api/traks/${OVERLAP_ID}`) return route.fulfill({ json: overlapped })
    if (path === "/api/traks") return route.fulfill({ json: { traks: [], archived: 0 } })
    return route.continue()
  })
  await page.goto(`/traks/${OVERLAP_ID}`)

  const drawer = page.getByRole("complementary", { name: "Trak" })
  // The pinned row, located through the fold press inside it: same vertical band.
  const pinned = drawer.getByRole("button", { name: "Filed its work" })
  await expect(pinned).toBeVisible()

  // The picker's three-row panel is the one that reaches down into the pinned row's
  // band, and this is what keeps the presses below honest: a panel that never met the
  // card would pass them over nothing. Measured, its last row lies across the pinned
  // header; the ending's one-item panel stops 20px short of the pane and gets no box
  // assertion — the rank is the band's, so the two stand or fall together.
  await drawer.getByRole("button", { name: /^Run mode/ }).click()
  const picker = drawer.getByRole("menu")
  const panelBox = await picker.boundingBox()
  const rowBox = await pinned.boundingBox()
  expect(panelBox).not.toBeNull()
  expect(rowBox).not.toBeNull()
  expect((panelBox?.y ?? 0) + (panelBox?.height ?? 0)).toBeGreaterThan(rowBox?.y ?? 0)
  // By hand rather than `.all()` in a loop, the way `phone.spec.ts` enumerates its
  // controls: the three rows are the fixture's, and naming them also asserts they drew.
  await picker.getByRole("menuitemradio", { name: /^Manual/ }).click({ trial: true })
  await picker.getByRole("menuitemradio", { name: /^Smart/ }).click({ trial: true })
  await picker.getByRole("menuitemradio", { name: /^Auto/ }).click({ trial: true })
  await page.keyboard.press("Escape")
  await expect(picker).toBeHidden()

  await drawer.getByRole("button", { name: "More options" }).click()
  const ending = drawer.getByRole("menu")
  await ending.getByRole("menuitem", { name: "Archive this trak" }).click({ trial: true })
})

/**
 * The header's actions row folds up into the title row once the header is wide enough.
 *
 * A container query on the header's own width, which happy-dom cannot evaluate — so the fold
 * is only measurable here. At 1600 the drawer is 80% of the window and the header clears
 * `@6xl`, so the run-mode readout sits beside the title; at 1024 the drawer is at its 780px
 * floor and the readout drops to its own row under the title. The viewport is set before
 * the page loads rather than resized under it.
 */
for (const [width, folded] of [
  [1600, true],
  [1024, false],
] as const) {
  test(`draws the actions ${folded ? "beside the title" : "under the title"} at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route("**/api/traks**", async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === `/api/traks/${OVERLAP_ID}`) return route.fulfill({ json: overlapped })
      if (path === "/api/traks") return route.fulfill({ json: { traks: [], archived: 0 } })
      return route.continue()
    })
    await page.goto(`/traks/${OVERLAP_ID}`)

    const drawer = page.getByRole("complementary", { name: "Trak" })
    const heading = drawer.getByRole("heading", { level: 1 })
    const press = drawer.getByRole("button", { name: /^Run mode/ })
    // Polled rather than read once: the boxes are the subject, and a read before the drawer
    // has drawn — or while it is still sliding in — returns null or a position mid-flight.
    await expect
      .poll(async () => {
        const title = await heading.boundingBox()
        const readout = await press.boundingBox()
        if (title === null || readout === null) return "not drawn"
        return readout.y < title.y + title.height ? "beside" : "under"
      })
      .toBe(folded ? "beside" : "under")
  })
}

/**
 * The open picture, and Escape after a press on it.
 *
 * **This is here for the same reason the case above is: focus on a pointer press.**
 * `Lightbox` puts Escape on its own node rather than on the document, so the view only
 * hears the key while focus is inside it — and Chromium answers a press on a picture by
 * focusing the nearest focusable ancestor, which is `<body>` unless the dialog element
 * itself takes it. That is the whole of what `tabIndex={-1}` there is for, and happy-dom
 * implements no focus-on-click at all: `Lightbox.test.tsx` and `Markdown.test.tsx` both
 * pass against the component without it.
 *
 * Stubbed for the reason the case above is stubbed: an artifact carrying a picture needs a
 * step that ran and a shot in that trak's checkout, and creating one spends money. The
 * image is answered here too — an SVG rather than a fixture file, because what the case
 * needs is a picture that *loaded*, and the press only exists once one has.
 */
const SHOT_ID = "e2e0e2e0-2222-4333-8444-555555555555"

/** Big enough to press in the middle of, and drawn so a failure is legible in a trace. */
const SHOT = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#4338ca"/></svg>`

const showing: TrakDetailDto = {
  id: SHOT_ID,
  description: "show what the drawer looks like",
  mode: "manual",
  holding: false,
  skippingChecks: false,
  messages: [],
  returned: [],
  state: { _tag: "AgentWorking", step: 1 },
  plan: {
    title: "Show what the drawer looks like",
    steps: [
      { type: "compose" },
      { type: "agent", agent: "builder", instruction: "capture the pane", conversational: false },
    ],
  },
  // `ArtifactBody` opens every section, so the picture is on screen wherever it goes.
  decisions: [],
  marks: [],
  nextChecks: [],
  deployScript: false,
  log: [
    { _tag: "TrakCreated", description: "show what the drawer looks like" },
    {
      _tag: "AgentReturned",
      step: 1,
      sessionId: "s-shot",
      output: { type: "artifact", sections: { Summary: "Here it is.\n\n![a shot](shot.svg)" } },
    },
  ],
  // A turn for the ending to hang the document off: the pane draws documents per turn, and
  // the turns are cut out of the transcript rather than out of the log.
  transcript: [
    { _tag: "Session", id: "s-shot", position: 1 },
    { _tag: "Text", text: "Here is the pane.", position: 1 },
  ],
  custody: { holder: { since: 1_786_028_700_000 } },
}

test("keeps Escape working on the open picture after a press on the picture", async ({ page }) => {
  await page.route("**/api/traks**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/image"))
      return route.fulfill({ contentType: "image/svg+xml", body: SHOT })
    if (url.pathname === `/api/traks/${SHOT_ID}`) return route.fulfill({ json: showing })
    if (url.pathname === "/api/traks") return route.fulfill({ json: { traks: [], archived: 0 } })
    return route.continue()
  })
  await page.goto(`/traks/${SHOT_ID}`)

  // Named by the alt text the agent wrote, through the button's contents.
  const press = page.getByRole("button", { name: "a shot" })
  await expect(press).toBeVisible()
  await press.click()

  const view = page.getByRole("dialog", { name: "a shot" })
  await expect(view).toBeVisible()

  // The gesture the whole case is about: pressing the thing you opened the view to look at.
  await view.getByRole("img", { name: "a shot" }).click()
  // Said twice on purpose, as above: where focus went, and what that buys. Without
  // `tabIndex={-1}` on the dialog this is `<body>` and the key below reaches nothing.
  await expect(view).toBeFocused()

  await page.keyboard.press("Escape")
  await expect(view).toBeHidden()
  // And the caller's half of it — the picture that was pressed has focus again, which is
  // what makes Escape a way back rather than a way out to the top of the page.
  await expect(press).toBeFocused()
})

/**
 * The open picture covers the window, not the pane.
 *
 * `Lightbox` is `fixed inset-0` in the tree of whatever opened it, with no portal, so it
 * resolves against the viewport only while nothing above it carries `transform`, `filter`,
 * `backdrop-filter`, `will-change` or `contain` — its header has the rule. The pane's
 * column slides beside the rail, and the first build of that slide moved it with an inline
 * `transform`: the picture then drew at the pane's own 731×620 box, and the case above
 * passed, because a dialog inside the drawer is still visible and still hears Escape.
 * happy-dom lays nothing out, so this tier is the only one that can see the difference.
 */
test("draws the open picture over the whole window rather than inside the pane", async ({
  page,
}) => {
  await page.route("**/api/traks**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/image"))
      return route.fulfill({ contentType: "image/svg+xml", body: SHOT })
    if (url.pathname === `/api/traks/${SHOT_ID}`) return route.fulfill({ json: showing })
    if (url.pathname === "/api/traks") return route.fulfill({ json: { traks: [], archived: 0 } })
    return route.continue()
  })
  await page.goto(`/traks/${SHOT_ID}`)
  await page.getByRole("button", { name: "a shot" }).click()

  const view = page.getByRole("dialog", { name: "a shot" })
  await expect(view).toBeVisible()
  const box = await view.boundingBox()
  const viewport = page.viewportSize()
  // The whole box, not `width > pane`: a containing block of any size other than the
  // viewport's is the fault, and the pane happens to be the one an ancestor's
  // `transform` would produce.
  expect(box).toEqual({ x: 0, y: 0, width: viewport?.width, height: viewport?.height })
})

/**
 * Where a wheel gesture goes, from each of the two places a drawer has a field.
 *
 * **Browser-only three times over.** happy-dom lays nothing out, so a `textarea` there has no
 * height, no `scrollHeight` and no cap to hit; it dispatches no wheel; and it implements
 * no scroll chaining, which is the whole of what these two cases are about. Nothing below
 * this tier can see any of it.
 *
 * Two rules, and they are not the same rule:
 *
 *   - **A field that fits its content hands the wheel to whatever is scrolling around
 *     it.** `Field` carried `overscroll-contain`, and Chromium latches a gesture to the
 *     scroll container under the cursor whether or not that container has anywhere to go —
 *     so every field was a dead spot, since a field is always exactly the height of what
 *     is in it. A question with several answers is a card that is mostly field, which is
 *     where it was reported.
 *   - **A gesture that starts inside the drawer never leaves it.** The first repair made
 *     the containment conditional on the field being capped, which fixed the pane and
 *     broke the chat bar: the bar is the pane's *sibling*, so an uncontained field there
 *     chained past the drawer and scrolled the trak list behind it. The boundary is
 *     `components/Drawer`'s now, and these two cases are the two positions it has to hold
 *     at.
 *
 * Stubbed for the reason the two cases above are: reaching a live answers gate needs an
 * agent that ran and asked, and running one spends money.
 */
const ASKED_ID = "e2e0e2e0-3333-4444-8555-666666666666"

/** Enough of them that the pane has somewhere to scroll to at any window this runs at. */
const QUESTIONS = Array.from({ length: 8 }, (_, i) => ({
  question: `Question ${String(i + 1)}: which way should this go?`,
  context: "Both answers are defensible and the difference shows up much later.",
  options: [],
}))

const asked: TrakDetailDto = {
  id: ASKED_ID,
  description: "ask a lot of questions at once",
  mode: "manual",
  holding: false,
  skippingChecks: false,
  messages: [],
  returned: [],
  state: { _tag: "AwaitingHuman", step: 1, kind: "answers" },
  plan: {
    title: "Ask a lot of questions at once",
    steps: [
      { type: "compose" },
      { type: "agent", agent: "builder", instruction: "ask them", conversational: false },
    ],
  },
  decisions: [],
  marks: [],
  nextChecks: [],
  deployScript: false,
  log: [
    { _tag: "TrakCreated", description: "ask a lot of questions at once" },
    {
      _tag: "AgentReturned",
      step: 1,
      sessionId: "s-ask",
      output: { type: "questions", questions: QUESTIONS },
    },
  ],
  transcript: [{ _tag: "Session", id: "s-ask", position: 1 }],
  custody: {},
}

/**
 * The list behind the drawer, long enough that the page has somewhere to go.
 *
 * **Without these the escape is unobservable and both cases pass on nothing.** The other
 * stubs here answer `/api/traks` with no rows, which leaves a document that cannot scroll —
 * so *the page did not move* would be true of a broken drawer too. `behindCanMove` is the
 * assertion that keeps that honest.
 */
const MANY: TrakSummaryDto[] = Array.from({ length: 40 }, (_, i) => ({
  id: `e2e0e2e0-4444-4555-8666-${String(i).padStart(12, "0")}`,
  description: `a trak in the list behind the drawer, number ${String(i + 1)}`,
  state: { _tag: "AwaitingHuman", step: 1, kind: "answers" },
  running: false,
  mode: "manual",
  branchMoved: false,
}))

/** The nearest ancestor that actually scrolls — the drawer's pane, without naming it. */
const paneTopOf = (field: Locator): Promise<number> =>
  field.evaluate((node: Element) => {
    for (let at = node.parentElement; at !== null; at = at.parentElement)
      if (at.scrollHeight > at.clientHeight) return at.scrollTop
    return Number.NaN
  })

/** How far the list behind the drawer has been scrolled. */
const behind = (page: Page): Promise<number> =>
  page.evaluate(() => document.scrollingElement?.scrollTop ?? Number.NaN)

/** Whether it could be scrolled at all — see `MANY`. */
const behindCanMove = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const el = document.scrollingElement
    return el !== null && el.scrollHeight > el.clientHeight
  })

/** The list and one trak, so a drawer opens over something with somewhere to scroll. */
const listed = async (page: Page): Promise<void> => {
  await page.route("**/api/traks**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === `/api/traks/${ASKED_ID}`) return route.fulfill({ json: asked })
    if (path === "/api/traks") return route.fulfill({ json: { traks: MANY, archived: 0 } })
    return route.continue()
  })
}

test("hands a wheel over an answer field to the drawer's pane, and not to the list behind", async ({
  page,
}) => {
  await listed(page)
  await page.goto(`/traks/${ASKED_ID}`)

  const field = page.getByRole("textbox", { name: QUESTIONS[0]?.question ?? "" })
  await expect(field).toBeVisible()
  // Polled, because the drawer's fetch and the list's resolve independently, and the drawer
  // can be visible before the list behind it has arrived and given the document its height.
  await expect.poll(() => behindCanMove(page)).toBe(true)

  // The claim the component makes about itself: it is exactly the height of what is in it,
  // so there is nothing for a scrollbar to show and nothing for the wheel to catch.
  expect(await field.evaluate((n: HTMLTextAreaElement) => n.scrollHeight - n.clientHeight)).toBe(0)

  // Hovered first and *then* measured, because the pane opens at the end of the log and
  // moving the cursor onto a field near its head scrolls one there. A baseline read before
  // that is the bottom of the pane rather than where the gesture starts from.
  await field.hover()
  const before = await paneTopOf(field)
  expect(before).not.toBeNaN()
  await page.mouse.wheel(0, 200)
  await expect.poll(() => paneTopOf(field)).toBeGreaterThan(before)
  expect(await behind(page)).toBe(0)

  // Past `max-h-48` the field is genuinely scrolling, so the gesture is its own — and
  // where the rest of it goes once the field is spent is the drawer's business, never the
  // page's.
  await field.fill("a line of an answer that is long enough to wrap\n".repeat(20))
  expect(
    await field.evaluate((n: HTMLTextAreaElement) => n.scrollHeight - n.clientHeight),
  ).toBeGreaterThan(0)

  await field.hover()
  await page.mouse.wheel(0, 200)
  await expect
    .poll(() => field.evaluate((n: HTMLTextAreaElement) => n.scrollTop))
    .toBeGreaterThan(0)
  expect(await behind(page)).toBe(0)
})

/**
 * The other position, and the one the conditional broke.
 *
 * Both drawers are covered because both are the same `Drawer`, but they reach it two ways:
 * the chat bar of a loaded trak is `TrakChatBar`, and New Trak's is `ChatBar` straight —
 * so a boundary that had somehow been given to one feature rather than to the component
 * would show up as one of these two failing alone.
 *
 * Neither half presses anything. Typing into a field is free; `Start trak` and `Send` are
 * not, and the case above is careful about that for the same reason.
 */
for (const { where, at, name } of [
  { where: "a loaded trak", at: `/traks/${ASKED_ID}`, name: "Say something to the agent" },
  { where: "New Trak", at: "/traks/new", name: "What do you want done?" },
])
  test(`keeps a wheel over ${where}'s chat bar off the list behind the drawer`, async ({
    page,
  }) => {
    await listed(page)
    await page.goto(at)

    const field = page.getByRole("textbox", { name })
    await expect(field).toBeVisible()
    // Polled, because New Trak's field needs no fetch and can be visible before the list
    // behind it has arrived and given the document its height.
    await expect.poll(() => behindCanMove(page)).toBe(true)

    // Uncapped, which is the state this was wrong in: the field hands the gesture on, and
    // what it hands it to has to be the drawer rather than the document.
    expect(await field.evaluate((n: HTMLTextAreaElement) => n.scrollHeight - n.clientHeight)).toBe(
      0,
    )
    await field.hover()
    await page.mouse.wheel(0, 300)
    await expect.poll(() => behind(page)).toBe(0)

    // And capped, where the field keeps the gesture until it is spent and the drawer takes
    // the rest of it.
    await field.fill("a line of a message that is long enough to wrap\n".repeat(20))
    await field.hover()
    await page.mouse.wheel(0, 300)
    await expect
      .poll(() => field.evaluate((n: HTMLTextAreaElement) => n.scrollTop))
      .toBeGreaterThan(0)
    expect(await behind(page)).toBe(0)
  })

/**
 * A field re-fits when its own width moves, not only when its value does.
 *
 * **The rule is that a field below the cap never shows a scrollbar at any width it is
 * given**, and typing is not the only way it gains a line. The drawer's width follows the
 * window outside the band where its own 780px floor holds it still, so narrowing the window
 * re-wraps every field on screen; a pane that gains a classic scrollbar takes that
 * scrollbar's width out of every field inside it. Both are
 * the same event as far as the control is concerned — its own box got narrower with the
 * same string in it — which is why one narrowing covers them and why `Field` watches the
 * node rather than the window.
 *
 * **This is the only tier that can fail.** happy-dom lays nothing out and has no
 * `ResizeObserver` at all, so `client/test-setup.ts` stubs one to a no-op — every unit
 * test draws a field whose observer never fires and never could. Deleting the observer
 * broke nothing in `verify` before this case existed.
 *
 * Three traps, all worth keeping:
 *
 *   - **The observer is asynchronous**, so the assertion polls. Read straight after
 *     `setViewportSize` it reports the pre-resize box and fails against correct code.
 *   - **The font arrives late, and a field measured before it does is measured in the
 *     fallback.** `styles.css` fetches IBM Plex Sans from Google with `display=swap`, so
 *     the first paint is `system-ui`, which is about four per cent wider. `Field` re-fits
 *     on value and on width and on nothing else, so a box fitted in the fallback keeps
 *     that height after the swap — and whether the swap lands before or after
 *     `setViewportSize` decided this case for months, at about one run in two. So
 *     `fontIn` waits for the field's own font before anything is filled, and every height
 *     below is one the shipped font produced.
 *   - **A fixture that does not re-wrap passes on nothing, and a poll on `height >
 *     height` cannot tell a re-wrap from a mis-fit.** The old paragraph took three lines
 *     at both widths in the real font, and the case passed only in the runs where the
 *     fallback measurement had left the box a line too tall. So the fixture is grown in
 *     the browser until it is one row short of spilling — `filled` — and the poll asserts
 *     the exact line count, which a box left too tall or too short fails.
 *
 * **The two are belt and braces on purpose, and neither replaces the other.** `fontIn`
 * alone leaves a paragraph hand-calibrated against one font, which the next font change
 * silently un-calibrates; `filled` alone measures in whichever font was in at fill time,
 * and the swap can still land between that and the poll.
 */

/** `max-h-48`. Past it a field is supposed to scroll, so this case stays under it. */
const CAP = 192

/**
 * Wide enough that the drawer sits at its 780px floor, then under it so it is the window.
 *
 * **`WIDE` must stay inside the band where the drawer is exactly 780** — 780 to 1100,
 * where its own floor beats the 320px the list is otherwise kept — because `filled` below
 * is calibrated for an 80px narrowing of a ~650px box. Above 1100 the drawer follows the
 * window and the box is wider, so the same 80px is a smaller fraction of it and the
 * half-row spill this case relies on is no longer certain.
 *
 * **`NARROW` must stay above the 640px phone breakpoint**, and 620 — what it was before
 * the breakpoint existed — is why. Below 640 the trak is a phone page and
 * `--spacing-field-pad` goes 8px to 11px, so the box grows six pixels from the token
 * alone — a growth that is not a re-wrap, which is exactly the fixture the poll below is
 * written to refuse. `boxOf` reads a height back through the desk's `PAD`, so below 640
 * every reading is 0.3 of a line out and the poll could never match anyway. 700 keeps the
 * drawer the width of the window, keeps the field 80px narrower than at `WIDE`, and leaves
 * `Field`'s `ResizeObserver` the only thing that can make the assertion pass.
 */
const WIDE = { width: 1000, height: 720 }
const NARROW = { width: 700, height: 720 }

/**
 * The seed `filled` grows from. No newlines: how many rows it takes is the box's width
 * and nothing else.
 */
const PARAGRAPH =
  "an answer that is long enough to wrap several times over at the width the drawer opens at, " +
  "and to wrap at least one more time than that once the window has been narrowed under the " +
  "width the drawer stops growing at, which is what makes the re-fit observable at all"

/** About half a row at either width. */
const HALF_ROW = "and half a row more, past the edge the last word crossed"

/**
 * The box's own line-height and padding, so a height can be read back as a line count.
 * `20` is `--text-base`'s line height and `8` is `--spacing-field-pad` on the desk —
 * the same two numbers `Field` builds its `minHeight` from.
 */
const LINE = 20
const PAD = 8

/** How tall the box is in lines, and how much of its content it is hiding. */
const boxOf = (field: Locator): Promise<{ readonly lines: number; readonly over: number }> =>
  field.evaluate(
    (n: HTMLTextAreaElement, { line, pad }) => ({
      lines: (n.clientHeight - 2 * pad) / line,
      over: n.scrollHeight - n.clientHeight,
    }),
    { line: LINE, pad: PAD },
  )

/** Resolves once the field's own font is the one drawing it, rather than the fallback. */
const fontIn = (field: Locator): Promise<void> =>
  field.evaluate(async (n: HTMLTextAreaElement) => {
    const font = getComputedStyle(n).font
    await document.fonts.load(font)
    if (!document.fonts.check(font)) throw new Error(`${font} did not load`)
  })

/**
 * Fill the field with a paragraph that is sure to take one more row at `NARROW` than at
 * `WIDE`, whatever font the page got.
 *
 * Narrowing by 80px on a ~650px box shortens each row by about an eighth, so the last
 * row has to be more than a quarter full at five rows for the eighth to spill into a
 * sixth — and a paragraph fixed in advance is a quarter full or not depending on the
 * font. So: grow the paragraph a word at a time until the box has gained two rows over
 * where it started, which leaves the last row all but empty, then add half a row. Five
 * rows and a half at `WIDE`, six and a quarter at `NARROW`, under `CAP` at both.
 */
const filled = async (field: Locator): Promise<void> => {
  await field.fill(PARAGRAPH)
  const start = (await boxOf(field)).lines
  // Recursive rather than a loop: each fill has to be measured before the next word is
  // decided, which is the one thing `Promise.all` cannot do.
  const grow = async (text: string, gained: number): Promise<string> => {
    if (gained >= 2) return text
    const longer = `${text} word`
    await field.fill(longer)
    const now = (await boxOf(field)).lines
    return grow(longer, now > start + gained ? gained + 1 : gained)
  }
  await field.fill(`${await grow(PARAGRAPH, 0)} ${HALF_ROW}`)
}

for (const { which, name } of [
  { which: "an answer field", name: QUESTIONS[0]?.question ?? "" },
  { which: "the chat bar", name: "Say something to the agent" },
])
  test(`re-fits ${which} when the drawer narrows under it`, async ({ page }) => {
    await page.setViewportSize(WIDE)
    await listed(page)
    await page.goto(`/traks/${ASKED_ID}`)

    const field = page.getByRole("textbox", { name })
    await expect(field).toBeVisible()
    await fontIn(field)
    await filled(field)

    const wide = await boxOf(field)
    expect(wide.over).toBe(0)
    expect(Number.isInteger(wide.lines)).toBe(true)
    // Under the cap at both widths, or the second half of this would be asserting that
    // `max-h-48` works rather than that the box was re-measured.
    expect((wide.lines + 1) * LINE + 2 * PAD).toBeLessThan(CAP)

    await page.setViewportSize(NARROW)

    // Polled, and on the pair: `over` is the rule, and the exact line count is what
    // refuses a box the observer never re-fitted, and one it fitted a line too tall.
    await expect.poll(() => boxOf(field)).toEqual({ over: 0, lines: wide.lines + 1 })
  })

/**
 * The drawer's width, measured at one window in each band of its rule.
 *
 * `Drawer` is `clamp(780px, 80vw, calc(100vw - 320px))` under `max-w-full`: its own 780px
 * floor, 80% of the window, and 320px kept for the list — the floor winning where the two
 * cannot both hold. The cases above only ever open it at 1000px and 700px, where the old
 * `max-w-[780px]` and this rule give the same box, so a revert to the fixed cap passed
 * every one of them. The 1280 and 1800 rows are what refuse it. `phone.spec.ts` holds the
 * fourth band, below 640, where the drawer is the page.
 *
 * The whole box against the viewport, the way the open picture is measured, rather than
 * the width alone: a drawer of the right width that no longer sits on the right edge, or
 * no longer runs from the top to the git strip's 32px at the foot, is a different fault
 * with the same width.
 */
for (const { band, window, width } of [
  { band: "its own floor", window: 1000, width: 780 },
  { band: "the list's floor", window: 1280, width: 960 },
  { band: "the proportion", window: 1800, width: 1440 },
])
  test(`the drawer is ${String(width)}px wide at ${String(window)}px, where ${band} sets it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: window, height: 720 })
    await listed(page)
    await page.goto(`/traks/${ASKED_ID}`)

    const drawer = page.getByRole("complementary", { name: "Trak" })
    await expect(drawer.getByRole("textbox", { name: "Say something to the agent" })).toBeVisible()
    expect(await drawer.boundingBox()).toEqual({ x: window - width, y: 0, width, height: 720 - 32 })
  })

/**
 * Every box that scrolls inside the drawer, run to its end and wheeled past.
 *
 * **This is the case that lets the two inner containments go.** `DrawerPane` and `Rail`
 * each declared `overscroll-contain` and each explained itself as the reason the trak list
 * stays still when a reader runs off the end of it. Neither was: `components/Drawer`
 * refuses the chain from every position inside it, so both were a second copy of a
 * boundary — and a second copy is a thing that can disagree with the first, which is
 * exactly what had happened, in the comments.
 *
 * **Written over whatever scrolls rather than over those two by name**, because that is
 * the rule the drawer carries alone: not *the pane and the rail are contained* but *no
 * gesture leaves the drawer, wherever inside it starts*. A scroller added to a drawer
 * later is covered without anyone remembering to come back here.
 *
 * The fixture is awkward on purpose — a plan long enough to overflow the rail and a
 * transcript long enough to overflow the pane, which is a shape neither of the wheel cases
 * above produces.
 */
const DEEP_ID = "e2e0e2e0-5555-4666-8777-888888888888"

const deep: TrakDetailDto = {
  id: DEEP_ID,
  description: "a long plan and a long transcript",
  mode: "manual",
  holding: false,
  skippingChecks: false,
  messages: [],
  returned: [],
  state: { _tag: "AwaitingHuman", step: 1, kind: "answers" },
  plan: {
    title: "A long plan and a long transcript",
    steps: [
      { type: "compose" },
      // 25 marks against a rail about 500px tall — measured to overflow it by ~230.
      ...Array.from({ length: 25 }, (_, i) => ({
        type: "agent" as const,
        agent: "builder",
        instruction: `step ${String(i + 1)}`,
        conversational: false,
      })),
    ],
  },
  decisions: [],
  marks: [],
  nextChecks: [],
  deployScript: false,
  log: [
    { _tag: "TrakCreated", description: "a long plan and a long transcript" },
    {
      _tag: "AgentReturned",
      step: 1,
      sessionId: "s-deep",
      output: { type: "questions", questions: [{ question: "which way?", options: [] }] },
    },
  ],
  transcript: [
    { _tag: "Session", id: "s-deep", position: 1 },
    ...Array.from({ length: 60 }, (_, i) => ({
      _tag: "Text" as const,
      text: `line ${String(i + 1)} of a transcript long enough to overflow the pane`,
      position: 1,
    })),
  ],
  custody: {},
}

/**
 * Put every scroller in the drawer at its end and say where each one is.
 *
 * At its end is the whole point: that is the position where a scroll container has nothing
 * left to give and hands the rest of the gesture upward, which is the one the two deleted
 * classes were nominally for.
 */
interface Point {
  readonly x: number
  readonly y: number
}

const spentScrollersIn = (page: Page): Promise<readonly Point[]> =>
  page.evaluate(() =>
    [...(document.querySelector("aside")?.querySelectorAll("*") ?? [])]
      .filter((node) => node.scrollHeight > node.clientHeight)
      .map((node) => {
        node.scrollTop = node.scrollHeight
        const at = node.getBoundingClientRect()
        return { x: Math.round(at.left + at.width / 2), y: Math.round(at.top + at.height / 2) }
      }),
  )

/**
 * Wheel hard at each point in turn, checking the page behind after every one.
 *
 * **Recursive rather than a loop, and strictly one at a time.** `no-await-in-loop` is right
 * about what it usually catches and its advice does not apply here: there is one cursor and
 * one page, so two of these in parallel would be two gestures fighting over where the mouse
 * is and one assertion reading the other's page. The order is the test.
 */
const wheelPastEach = async (page: Page, at: readonly Point[]): Promise<void> => {
  const [here, ...rest] = at
  if (here === undefined) return
  // Reset between them, so each point is judged from a page that could still have moved
  // rather than from one a previous escape already left at the bottom.
  await page.evaluate(() => {
    document.scrollingElement?.scrollTo(0, 0)
  })
  await page.mouse.move(here.x, here.y)
  await page.mouse.wheel(0, 600)
  await expect.poll(() => behind(page)).toBe(0)
  return wheelPastEach(page, rest)
}

test("keeps a wheel past the end of anything in the drawer off the list behind", async ({
  page,
}) => {
  await page.route("**/api/traks**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === `/api/traks/${DEEP_ID}`) return route.fulfill({ json: deep })
    if (path === "/api/traks") return route.fulfill({ json: { traks: MANY, archived: 0 } })
    return route.continue()
  })
  await page.goto(`/traks/${DEEP_ID}`)
  await expect(page.getByRole("complementary", { name: "Trak" })).toBeVisible()
  // Polled for the same reason as the answer field's case: the drawer can open before the list.
  await expect.poll(() => behindCanMove(page)).toBe(true)

  const spent = await spentScrollersIn(page)
  // The pane and the rail. Asserted, because a case that found none would pass by
  // wheeling over nothing — which is precisely how it would read once someone changed the
  // fixture and stopped overflowing either of them.
  expect(spent.length).toBeGreaterThanOrEqual(2)

  await wheelPastEach(page, spent)
})

/**
 * A four-section document at an approval gate — the card `ArtifactBody` draws every
 * section of open, taller than the pane at either width.
 *
 * **What this holds is the press, not the document.** `DrawerPane` lands a step's pane at
 * its bottom, `CardShell` puts the gate's press in the card's header, and a document taller
 * than the pane therefore put Approve above the viewport on arrival — 61px at a desk,
 * 520px on a phone — until the header stuck. happy-dom reports every box as 0 and a proof has
 * no pane to land in, so the viewport is the only place this can be measured.
 *
 * **The ending is measured, so the chat bar's context line draws.** A band once sat at
 * the pane's top over the card's header and drew only when the log carried usage, which
 * is how a version that covered Approve passed this case on a log with none. The press
 * has to receive events at the pane's edge, scrolled or not.
 */
const PARAGRAPHS = Array.from(
  { length: 3 },
  () =>
    "A paragraph long enough to wrap several times at either width, so that four of these sections together stand taller than the pane that holds them and the landing rule has something to push out of view.",
).join("\n\n")

const APPROVAL_ID = "e2e0e2e0-6666-4777-8888-999999999999"

const approving: TrakDetailDto = {
  id: APPROVAL_ID,
  description: "file a document tall enough to scroll",
  mode: "manual",
  holding: false,
  skippingChecks: false,
  messages: [],
  returned: [],
  state: { _tag: "AwaitingHuman", step: 1, kind: "approval" },
  plan: {
    title: "File a document tall enough to scroll",
    steps: [
      { type: "compose" },
      { type: "agent", agent: "builder", instruction: "file it", conversational: false },
    ],
  },
  decisions: [],
  marks: [],
  nextChecks: [],
  deployScript: false,
  log: [
    { _tag: "TrakCreated", description: "file a document tall enough to scroll" },
    {
      _tag: "AgentReturned",
      step: 1,
      sessionId: "s-approve",
      output: {
        type: "artifact",
        sections: {
          Summary: PARAGRAPHS,
          Changes: PARAGRAPHS,
          Verification: PARAGRAPHS,
          "Follow-ups": PARAGRAPHS,
        },
      },
      usage: {
        inputTokens: 20,
        outputTokens: 900,
        cacheReadTokens: 120_000,
        cacheWriteTokens: 4_000,
        costUsd: 0.2,
        tools: {},
        context: {
          inputTokens: 20,
          outputTokens: 900,
          cacheReadTokens: 120_000,
          cacheWriteTokens: 4_000,
        },
        contextWindow: 200_000,
      },
    },
  ],
  transcript: [{ _tag: "Session", id: "s-approve", position: 1 }],
  custody: {},
}

test("keeps the Approve press inside the viewport when a tall document opens at its gate", async ({
  page,
}) => {
  await page.route("**/api/traks**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === `/api/traks/${APPROVAL_ID}`) return route.fulfill({ json: approving })
    if (path === "/api/traks") return route.fulfill({ json: { traks: [], archived: 0 } })
    return route.continue()
  })
  await page.goto(`/traks/${APPROVAL_ID}`)

  const approve = page.getByRole("button", { name: "Approve", exact: true })
  await expect(approve).toBeVisible()
  // `toBeVisible` is satisfied by a button 500px above the top of the window, which is the
  // case this exists for, so the box is measured against the viewport by hand.
  const box = await approve.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  if (box === null || viewport === null) return
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)

  // The pane carries no band at its top — the reading is the line at the chat bar's
  // foot — so the pinned header sits at the pane's edge with nothing over it. The
  // actionability check on a trial press — never a real one, since Approve spends — is
  // what says nothing covers it. Held at the landing, scrolled part-way back up while the
  // header is still pinned, and at the top where it is not.
  await expect(page.getByRole("button", { name: "What is in the context window" })).toBeVisible()
  const pressable = async (): Promise<void> => {
    await expect(approve).toBeInViewport()
    await approve.click({ trial: true })
  }
  await pressable()
  await approve.evaluate((el) => el.closest(".overflow-y-auto")?.scrollBy(0, -200))
  await pressable()
  await approve.evaluate((el) => el.closest(".overflow-y-auto")?.scrollTo(0, 0))
  await pressable()
})

/**
 * The band's `⋯` on the ending cell that holds it — a pull request still open, where the
 * menu is the band's only route to Archive. The band is always on the pane's bottom edge,
 * so a panel hanging below it opened into the clipped overflow; it opens upward now. Under
 * a short card and a long one, because the band sat under a short card before and had room
 * below it there. A point test as well as a box: a panel clipped by the pane's own overflow
 * still reports a box inside the window.
 */
const MENU_ID = "e2e0e2e0-1111-4222-8333-777777777777"

const openPullRequest = (card: "short" | "long") => ({
  ...longPullRequest,
  state: "open",
  ...(card === "short" ? { reviews: [], conversation: [] } : {}),
})

for (const card of ["short", "long"] as const)
  test(`opens the band's ⋯ upward and on screen under a ${card} card`, async ({ page }) => {
    await stubbed(page)
    // Registered after `stubbed`, so Playwright tries it first; anything else falls through.
    await page.route("**/api/traks/e2e0e2e0-1111-4222-8333-777777777777**", async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === `/api/traks/${MENU_ID}`)
        return route.fulfill({ json: { ...ended, id: MENU_ID } })
      if (path === `/api/traks/${MENU_ID}/pull-request`)
        return route.fulfill({ json: openPullRequest(card) })
      if (path === `/api/traks/${MENU_ID}/merge`)
        return route.fulfill({ json: { branch: "trak/e2e-ended", into: "main", conflicts: false } })
      return route.fallback()
    })
    await page.goto(`/traks/${MENU_ID}`)

    const viewport = page.viewportSize()
    expect(viewport).not.toBeNull()
    if (viewport === null) return
    const shown = async (control: Locator): Promise<boolean> => {
      const box = await control.boundingBox()
      if (box === null || box.y < 0 || box.y + box.height > viewport.height) return false
      return control.evaluate((node: Element) => {
        const at = node.getBoundingClientRect()
        const hit = document.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2)
        return hit !== null && node.contains(hit)
      })
    }

    await page.getByRole("button", { name: "More endings" }).click()
    const item = page.getByRole("menuitem", { name: "Archive this trak" })
    await expect(item).toBeVisible()
    expect(await shown(item)).toBe(true)

    // The confirmation replaces the item in the same panel. Not pressed: it would archive.
    await item.click()
    const confirm = page.getByRole("menu").getByRole("button", { name: "Archive" })
    await expect(confirm).toBeVisible()
    expect(await shown(confirm)).toBe(true)
  })

/**
 * Put one view on the page the way the app does — the document the engine serves, in a
 * `sandbox="allow-scripts"` frame fed by `srcdoc` — and collect what it says to the page
 * holding it, which is the one channel a view has. `viewDocument` is the engine's own
 * writer, imported because it imports nothing itself.
 */
const hearView = (
  page: Page,
  html: string,
  declared?: Parameters<typeof viewDocument>[1],
): Promise<readonly unknown[]> =>
  page.evaluate(
    (srcdoc) =>
      new Promise<readonly unknown[]>((resolve) => {
        const heard: unknown[] = []
        const frame = document.createElement("iframe")
        frame.setAttribute("sandbox", "allow-scripts")
        frame.srcdoc = srcdoc
        window.addEventListener("message", (event) => {
          if (event.source === frame.contentWindow) heard.push(event.data)
        })
        document.body.append(frame)
        // Long enough for a refused request's report, and for a navigation that was
        // going to happen to have happened.
        setTimeout(() => resolve(heard), 2500)
      }),
    viewDocument(html, declared),
  )

test("a view's frame runs its script, cannot read the page holding it, and fetches from no host", async ({
  page,
}) => {
  await page.goto("/")
  const origin = new URL(page.url()).origin
  const heard = await hearView(
    page,
    `<!DOCTYPE html><script>
      const violation = new Promise((resolve) => {
        document.addEventListener("securitypolicyviolation", (e) => resolve(e.violatedDirective))
        setTimeout(() => resolve(""), 1500)
      })
      ;(async () => {
        let top = "readable"
        try { void window.top.document.title } catch (e) { top = e.name }
        let fetched = true
        try { await fetch("${origin}/api/health") } catch { fetched = false }
        parent.postMessage({ origin: window.origin, top, fetched, blocked: await violation }, "*")
      })()
    </script>`,
  )
  expect(heard).toEqual([
    { origin: "null", top: "SecurityError", fetched: false, blocked: "connect-src" },
  ])
})

/**
 * Every way a view can try to put another document in its frame, each naming the host it
 * would reach. A policy has no directive for a document navigating itself, so these are
 * refused by the document *holding* the view — and a refusal is no request at all, which
 * is what is counted: a navigation's address is as good a way out as a fetch.
 */
const WAYS_OUT: readonly (readonly [string, (to: string) => string])[] = [
  ["setting location", (to) => `<script>location.href = "${to}"</script>`],
  ["a meta refresh", (to) => `<meta http-equiv="refresh" content="0;url=${to}">`],
  ["following a link", (to) => `<a id="a" href="${to}">x</a><script>a.click()</script>`],
  ["submitting a form", (to) => `<form id="f" action="${to}"></form><script>f.submit()</script>`],
  [
    "moving the frame holding it",
    (to) => `<script>try { parent.location = "${to}" } catch {}</script>`,
  ],
  ["opening a window", (to) => `<script>try { window.open("${to}") } catch {}</script>`],
]

for (const [way, attempt] of WAYS_OUT) {
  test(`a view reaches no host by ${way}`, async ({ page, context }) => {
    await page.goto("/")
    const leaked: string[] = []
    context.on("request", (request) => {
      if (request.url().includes("/leaked")) leaked.push(request.url())
    })
    const to = `${new URL(page.url()).origin}/leaked?secret=1`
    await hearView(page, `<!DOCTYPE html><body>${attempt(to)}</body>`)
    expect(leaked).toEqual([])
    expect(context.pages()).toHaveLength(1)
  })
}

test("a view's frame goes nowhere even to a host its server declared for frames", async ({
  page,
}) => {
  await page.goto("/")
  const origin = new URL(page.url()).origin
  // What would load there is not the view: it would ask for a tool the way a view does,
  // through the window the view spoke through. So the address is never fetched.
  let arrived = false
  await page.route("**/declared-frame", (route) => {
    arrived = true
    return route.fulfill({
      contentType: "text/html",
      body: `<script>parent.postMessage({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "press" } }, "*")</script>`,
    })
  })
  const heard = await hearView(
    page,
    `<!DOCTYPE html><script>
      parent.postMessage("before", "*")
      setTimeout(() => { location.href = "${origin}/declared-frame" }, 100)
    </script>`,
    { connect: [], resource: [], frame: [origin], baseUri: [] },
  )
  expect(arrived).toBe(false)
  expect(heard).toEqual(["before"])
})
