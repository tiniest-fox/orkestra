import type { Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import type { GoalDetailDto, GoalDto } from "@orkestra/shared/dto/goals"
import type { HostedProcessDto, TrakDetailDto } from "@orkestra/shared/dto/trak"
import type { CliUsageDto } from "@orkestra/shared/dto/usage"
import {
  FLOOR,
  GATED_ID,
  INSET,
  MANY,
  QUESTIONS,
  gated,
  panePadding,
  simulateInset,
  sizeOf,
  underFloor,
} from "./phone"

/**
 * The app at a phone's width, measured.
 *
 * This file runs only under the `phone` project — 375×667, `hasTouch`, `isMobile` — and
 * every case in it asserts a geometry or a computed style. That is the whole reason it
 * exists: happy-dom loads no stylesheet and reports every box as 0, so the phone layout's
 * claims — the 44px touch floor, the full-screen trak and New Chat pages, the safe-area
 * insets, Enter behaving as a newline under a coarse pointer — are held by class strings nothing reads
 * until a browser lays them out. The `*.phone.test.tsx` files assert which components
 * render; these assert what they measure.
 *
 * Read-only, like `app.spec.ts` and for the same reason. The one case that *could* spend
 * — Enter in the chat bar, which on a desktop pointer submits a turn — runs against a
 * stub that counts every POST, and asserts the count is zero.
 *
 * `env(safe-area-inset-bottom)` is 0 in every browser this suite can launch, so the two
 * inset cases simulate an iPhone's 34px by overriding `--spacing-safe-b` — the same
 * variable every paying site reads, so the override exercises exactly the classes under
 * test. The technique is the one the diff view's proofs established.
 */

const CHECKING_ID = "e2e0e2e0-8888-4aaa-8bbb-cccccccccccc"

/**
 * A trak whose check is running, with the drive holding it — the one state the band's
 * cancel press is drawn in. The run is the daemon's memory, so it rides the detail.
 */
const checking: TrakDetailDto = {
  id: CHECKING_ID,
  description: "end a running check from the band",
  mode: "manual",
  holding: false,
  skippingChecks: false,
  messages: [],
  returned: [],
  state: { _tag: "CheckRunning", step: 1 },
  plan: {
    title: "Measure the band on a phone",
    steps: [
      { type: "compose" },
      { type: "agent", agent: "builder", instruction: "build it", conversational: false },
    ],
  },
  decisions: [],
  marks: [],
  nextChecks: [],
  deployScript: false,
  log: [
    { _tag: "TrakCreated", description: "end a running check from the band" },
    {
      _tag: "AgentReturned",
      step: 1,
      sessionId: "s-check",
      output: { type: "artifact", sections: { Summary: "Built it." } },
    },
  ],
  transcript: [{ _tag: "Session", id: "s-check", position: 1 }],
  custody: { holder: { since: 1_786_028_700_000 } },
  check: {
    step: 1,
    name: "verify",
    command: "bash /repo/.orkestra/checks/verify.sh",
    limit: 900,
    startedAt: 1_786_028_700_000,
    output: "compiling\n",
    chunks: 1,
  },
}

const ENDED_ID = "e2e0e2e0-7777-4aaa-8bbb-cccccccccccc"

/**
 * A finished trak whose pull request merged, with a review long enough that the card runs
 * well past a 667px screen — the case the band under the card exists for. The commit on
 * the log is what makes the forge and the merge preview ask, so both are stubbed below.
 */
const ended: TrakDetailDto = {
  id: ENDED_ID,
  description: "reach Archive under a long review",
  mode: "manual",
  holding: false,
  skippingChecks: false,
  messages: [],
  returned: [],
  state: { _tag: "Finished" },
  plan: {
    title: "Reach Archive under a long review",
    steps: [
      { type: "compose" },
      { type: "agent", agent: "builder", instruction: "build it", conversational: false },
    ],
  },
  decisions: [],
  marks: [],
  nextChecks: [],
  deployScript: false,
  log: [
    { _tag: "TrakCreated", description: "reach Archive under a long review" },
    { _tag: "WorkCommitted", step: 1, sha: "abc1234" },
  ],
  transcript: [],
  custody: {},
  worktree: { path: "/tmp/e2e", branch: "trak/e2e-ended", base: "main" },
}

const LIVE_ID = "e2e0e2e0-6666-4aaa-8bbb-cccccccccccc"

/**
 * An agent mid-turn with a transcript long enough to overflow the pane, so the pane follows
 * the live turn to its end — the case that used to carry the header off the screen.
 */
const live: TrakDetailDto = {
  ...checking,
  id: LIVE_ID,
  description: "keep the header in reach",
  state: { _tag: "AgentWorking", step: 1 },
  log: [{ _tag: "TrakCreated", description: "keep the header in reach" }],
  transcript: [
    { _tag: "Session", id: "s-live", position: 1 },
    ...Array.from({ length: 60 }, (_, i) => ({
      _tag: "Text" as const,
      text: `line ${String(i + 1)} of a turn long enough to overflow the pane`,
      position: 1,
    })),
  ],
  check: undefined,
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
          "A paragraph long enough to wrap several times at a phone's width, so that " +
          "twelve of these together run the card well past the bottom of the screen.",
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
  decision: "commented",
  checks: [],
  reviews: Array.from({ length: 4 }, (_, review) => ({
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
 * The gated trak's hosted processes: one running, so Restart and Stop are drawn, and one
 * never started, so Start is — and two, so the panel draws its tabs. The log is long enough
 * to overflow the phone's panel, which is what makes the scroller's own bottom padding the
 * thing that decides whether the newest line clears the home indicator.
 */
const PROCESSES: readonly HostedProcessDto[] = [
  {
    name: "dev",
    description: "The app's dev server",
    page: true,
    readySeconds: 30,
    run: 1,
    state: {
      _tag: "Running",
      port: 47213,
      startedAt: 1_000,
      readyAt: 2_000,
      url: "http://127.0.0.1:47213/",
    },
    log: Array.from({ length: 80 }, (_, i) => `[vite] hmr update line ${String(i + 1)}`).join("\n"),
    chunks: 1,
  },
  {
    name: "api",
    description: "The API",
    page: false,
    readySeconds: 30,
    run: 0,
    state: { _tag: "NotStarted" },
    log: "",
    chunks: 0,
  },
]

/** Below the breakpoint the Review row starts folded, so the long review is a press away. */
const openReview = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: /^Commented/ }).click()
}

/**
 * One handler over every `/api/traks…` path, as `app.spec.ts` stubs — and every POST is
 * counted and refused rather than passed through, because the engine behind the proxy is
 * real and a POST that reached it would spend. The count is what the Enter case asserts
 * on: a press that sent would look identical on screen for the first frame.
 */
const stubbed = async (page: Page): Promise<{ readonly sent: () => number }> => {
  let sent = 0
  await page.route("**/api/traks**", async (route) => {
    if (route.request().method() === "POST") {
      sent += 1
      return route.fulfill({ status: 409, json: { _tag: "AtRest" } })
    }
    const path = new URL(route.request().url()).pathname
    if (path === `/api/traks/${GATED_ID}`) return route.fulfill({ json: gated })
    if (path === `/api/traks/${GATED_ID}/processes`)
      return route.fulfill({ json: { processes: PROCESSES } })
    if (path === `/api/traks/${CHECKING_ID}`) return route.fulfill({ json: checking })
    if (path === `/api/traks/${LIVE_ID}`) return route.fulfill({ json: live })
    if (path === `/api/traks/${ENDED_ID}`) return route.fulfill({ json: ended })
    if (path === `/api/traks/${ENDED_ID}/pull-request`)
      return route.fulfill({ json: longPullRequest })
    if (path === `/api/traks/${ENDED_ID}/merge`)
      return route.fulfill({ json: { branch: "trak/e2e-ended", into: "main", conflicts: false } })
    if (path === "/api/traks") return route.fulfill({ json: { traks: MANY, archived: 0 } })
    return route.continue()
  })
  return { sent: () => sent }
}

/**
 * The project's premise, asserted rather than assumed: `hasTouch` is what makes Chromium
 * answer `(pointer: coarse)`, and both the chat bar's Enter rule and this suite's right
 * to call itself a phone check hang off it. If an upgrade stops the emulation matching,
 * every case here should fail on this line rather than on a mystery.
 */
const coarse = (page: Page): Promise<boolean> =>
  page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)

test("a trak is a full-screen page with a back control at the touch floor", async ({ page }) => {
  await stubbed(page)
  await page.goto(`/traks/${GATED_ID}`)

  expect(await coarse(page)).toBe(true)

  const drawer = page.getByRole("complementary", { name: "Trak" })
  await expect(drawer.getByRole("heading", { name: "Measure the phone layout" })).toBeVisible()

  // The whole viewport, not a panel over the list: below the breakpoint the drawer is
  // the page.
  expect(await sizeOf(drawer)).toEqual({ width: 375, height: 667 })

  // The way out is a back control on the left edge, not the desk's Close — and it is a
  // link, so it is the router's business, but it still owes the floor.
  const back = drawer.getByRole("link", { name: "Back" })
  await expect(back).toBeVisible()
  await expect(drawer.getByRole("link", { name: "Close" })).toHaveCount(0)
  expect(await underFloor([["Back", back]])).toEqual([])
})

test("every control that acts on the list clears 44px on both axes", async ({ page }) => {
  await stubbed(page)
  await page.goto("/")

  const rows = page.locator("ul li")
  await expect(rows).toHaveCount(MANY.length)

  // A row's control is the row: the title link's `::after` overlay spreads the tap
  // target over the whole `<li>`, so the `<li>` is the box that has to clear the floor —
  // the anchor's own rect is one line of text.
  const shortRows = await rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().height).filter((height) => height < 44),
  )
  expect(shortRows).toEqual([])

  // The dock's two halves and the section's own fold. The push band's two presses
  // cannot be measured here — a Playwright context answers `Notification.permission`
  // with `denied`, and the band opens only at `default` — but both are the same
  // `Button size="sm"` whose floor the gate's submit pins below.
  const chat = page.getByRole("link", { name: "New Chat" })
  const trak = page.getByRole("link", { name: "New Trak" })
  expect(
    await underFloor([
      ["New Chat", chat],
      ["New Trak", trak],
      ["section fold", page.getByRole("button", { name: "Needs you" })],
    ]),
  ).toEqual([])

  // One pill, split on the screen's centre line: the seam between the halves is where
  // the raised New Trak button's centre was, so New Trak's half starts at the centre and
  // New Chat's ends there. Measured as the two edges rather than as a width, so the
  // seam's own pixel can change without touching this.
  const chatAt = await chat.evaluate((node) => node.getBoundingClientRect().right)
  const trakAt = await trak.evaluate((node) => node.getBoundingClientRect().left)
  expect(chatAt).toBeLessThanOrEqual(375 / 2)
  expect(trakAt).toBeGreaterThanOrEqual(375 / 2)
  expect(trakAt - chatAt).toBeLessThanOrEqual(2)
})

/** Claude's plan usage, read a minute ago and polling — the tab at its widest. */
const USAGE: CliUsageDto = {
  cli: "claude",
  polling: true,
  usage: {
    _tag: "Read",
    at: Date.now() - 60_000,
    windows: [{ kind: "five_hour", utilization: 72, resetsAt: Date.now() + 3 * 3_600_000 }],
  },
}

/**
 * The dock's four tabs — processes and Files left of the pill, Claude's plan usage and
 * the git action right of it — and the sheet the action tab opens. Stubbed so the tabs have labels to
 * find whatever this checkout's remote and processes say, and with the widest state the
 * round drew: Reconcile 12/128 on a long branch. The sheet is opened and measured, and
 * nothing is pressed.
 */
test("the dock's four tabs fit at 375px and they and the sheet's presses clear 44px", async ({
  page,
}) => {
  await page.route("**/api/git", (route) =>
    route.fulfill({
      json: {
        head: { _tag: "Branch", name: "a-long-branch-name-that-has-to-truncate-in-the-band" },
        origin: true,
        upstream: { name: "origin/main", ahead: 12, behind: 128 },
        fetchedAt: Date.now(),
        fetching: false,
      },
    }),
  )
  await page.route("**/api/processes", (route) => route.fulfill({ json: { processes: PROCESSES } }))
  await page.route("**/api/usage", (route) => route.fulfill({ json: { clis: [USAGE] } }))
  await page.goto("/")
  const dock = page.getByRole("navigation", { name: "Start a trak" })
  const tabs = [
    ["process tab", dock.getByRole("button", { name: /^Project checkout's processes:/ })],
    ["files tab", dock.getByRole("button", { name: "Project files" })],
    ["usage tab", dock.getByRole("button", { name: "Claude usage" })],
    ["action tab", dock.getByRole("button", { name: "Reconcile, 12 ahead, 128 behind" })],
  ] as const
  await Promise.all(tabs.map(([, tab]) => expect(tab).toBeVisible()))
  const boxes = await Promise.all(
    tabs.map(([, tab]) =>
      tab.evaluate((node) => {
        const { left, right, width } = node.getBoundingClientRect()
        return { left, right, width }
      }),
    ),
  )
  // Equal shares, whatever the branch is called, and every one on the screen.
  const widths = boxes.map((box) => Math.round(box.width))
  expect(new Set(widths).size).toBe(1)
  expect(Math.max(...boxes.map((box) => box.right))).toBeLessThanOrEqual(375)
  // Two each side of the pill, never under it.
  const chat = page.getByRole("link", { name: "New Chat" })
  const trak = page.getByRole("link", { name: "New Trak" })
  expect(boxes[1]?.right).toBeLessThanOrEqual(
    await chat.evaluate((node) => node.getBoundingClientRect().left),
  )
  expect(boxes[2]?.left).toBeGreaterThanOrEqual(
    await trak.evaluate((node) => node.getBoundingClientRect().right),
  )

  await tabs[3][1].click()
  const sheet = page.getByRole("dialog", { name: "Project checkout" })
  const presses = ["Reconcile", "Fetch"].map(
    (name) => [name, sheet.getByRole("button", { name })] as const,
  )
  expect(await underFloor([...tabs, ...presses])).toEqual([])
})

/**
 * The notice row a refused press raises over the band, and the presses in it. Both of
 * the bar's routes are stubbed, so the two presses made here reach no engine and run no
 * `git`: the first is refused over a dirty tree, which offers the stash press, and that
 * one is refused as a conflict, which offers *Resolve in a Trak*. That one is measured
 * and not pressed — it opens the New Trak page.
 */
test("the notice row's dismiss and its fix presses clear 44px on both axes", async ({ page }) => {
  await page.route("**/api/git", (route) =>
    route.fulfill({
      json: {
        head: { _tag: "Branch", name: "main" },
        origin: true,
        upstream: { name: "origin/main", ahead: 1, behind: 4 },
        fetchedAt: Date.now(),
        fetching: false,
      },
    }),
  )
  await page.route("**/api/git/reconcile", (route) =>
    route.fulfill({
      status: 409,
      json:
        // Read as text: the body is `{}` or `{"stash":true}`, and parsed it is untyped.
        route.request().postData()?.includes('"stash":true') === true
          ? { _tag: "Conflict", files: ["README.md"], description: "Merge it." }
          : { _tag: "Dirty", files: ["M README.md", "?? new.txt"] },
    }),
  )
  await page.goto("/")
  const dock = page.getByRole("navigation", { name: "Start a trak" })
  // The tab opens the sheet and the press is there; the row rises once the sheet is shut.
  await dock.getByRole("button", { name: "Reconcile, 1 ahead, 4 behind" }).click()
  const sheet = page.getByRole("dialog", { name: "Project checkout" })
  await sheet.getByRole("button", { name: "Reconcile" }).click()
  await expect(sheet.getByText(/Reconcile refused/)).toBeVisible()
  await sheet.press("Escape")
  const notice = dock.getByRole("alert")
  const stash = notice.getByRole("button", { name: "Stash & reconcile" })
  await expect(stash).toBeVisible()
  expect(
    await underFloor([
      ["dismiss", notice.getByRole("button", { name: "Dismiss" })],
      ["stash press", stash],
    ]),
  ).toEqual([])
  // The row sits over the band and the pill overhangs it, so the press must clear both.
  const pill = page.getByRole("link", { name: "New Chat" })
  expect(await stash.evaluate((node) => node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(
    await pill.evaluate((node) => node.getBoundingClientRect().top),
  )

  await stash.click()
  const resolve = notice.getByRole("button", { name: "Resolve in a Trak" })
  await expect(resolve).toBeVisible()
  expect(
    await underFloor([
      ["dismiss", notice.getByRole("button", { name: "Dismiss" })],
      ["resolve press", resolve],
    ]),
  ).toEqual([])
})

test("New Chat is a full-screen page whose controls clear the floor and whose foot reads the inset", async ({
  page,
}) => {
  const acted = await stubbed(page)
  await page.goto("/traks/chat")

  const drawer = page.getByRole("complementary", { name: "New Chat" })
  const field = drawer.getByRole("textbox", { name: "What do you want to know?" })
  await expect(field).toBeVisible()
  expect(await sizeOf(drawer)).toEqual({ width: 375, height: 667 })

  // Below the breakpoint the inert bands are not drawn, so the screen is the back
  // control, the model picker in the pane, the field and the send — and all of them owe
  // the floor. The send is disabled until something is typed, and a disabled control is
  // still a box a thumb lands on. The picker's tiles are measured through the first one:
  // they are one grid cell wide at two across, so every tile is the same box.
  expect(
    await underFloor([
      ["Back", drawer.getByRole("link", { name: "Back" })],
      [
        "model tile",
        drawer.getByRole("group", { name: "Which model answers" }).getByRole("button").first(),
      ],
      ["chat field", field],
      ["Start chat", drawer.getByRole("button", { name: "Start chat" })],
    ]),
  ).toEqual([])

  // The chat bar is the only thing between the pane and the home indicator, so it is the
  // payer — `pb-foot`, 16px plus the inset. Two readings of one declaration, apart by
  // exactly the inset, for the reservation case's reason.
  const foot = (): Promise<number> =>
    page.evaluate(() => {
      const box = document.querySelector("aside textarea")?.closest(".pb-foot")
      return box === null || box === undefined
        ? Number.NaN
        : Number.parseFloat(getComputedStyle(box).paddingBottom)
    })
  const flat = await foot()
  expect(flat).not.toBeNaN()
  await simulateInset(page)
  expect((await foot()) - flat).toBe(INSET)

  // Nothing here pressed the send, and the stub would have counted it if it had: the
  // first send is what creates the trak, and creating one spends.
  expect(acted.sent()).toBe(0)
})

test("every control that acts on a gate clears 44px on both axes", async ({ page }) => {
  await stubbed(page)
  await page.goto(`/traks/${GATED_ID}`)

  const drawer = page.getByRole("complementary", { name: "Trak" })
  await expect(drawer.getByRole("button", { name: "Send answers" })).toBeVisible()

  expect(
    await underFloor([
      // The four surfaces, which are the phone's whole navigator.
      ["tab Agent", drawer.getByRole("button", { name: "Agent" })],
      ["tab Map", drawer.getByRole("button", { name: "Map" })],
      ["tab Trak", drawer.getByRole("button", { name: "Trak", exact: true })],
      ["tab Changes", drawer.getByRole("button", { name: "Changes" })],
      // The gate itself: the two option presses, the field an option fills, the note,
      // and the submit the recommended pre-fill leaves enabled.
      ["option a", drawer.getByRole("button", { name: "list only" })],
      ["option b", drawer.getByRole("button", { name: "all commands" })],
      ["answer field", drawer.getByRole("textbox", { name: QUESTIONS[0]?.question ?? "" })],
      ["note field", drawer.getByRole("textbox", { name: "Additional thoughts" })],
      ["Send answers", drawer.getByRole("button", { name: "Send answers" })],
      // The run-mode readout in the header, which opens the picker.
      ["run mode", drawer.getByRole("button", { name: /^Run mode/ })],
      // The chat bar's pair, at the foot of the same screen.
      ["chat field", drawer.getByRole("textbox", { name: "Say something to the agent" })],
      ["chat send", drawer.getByRole("button", { name: "Send", exact: true })],
    ]),
  ).toEqual([])
})

test("the press that ends a running check clears the floor, and the band grows to hold it", async ({
  page,
}) => {
  const acted = await stubbed(page)
  await page.goto(`/traks/${CHECKING_ID}`)

  const drawer = page.getByRole("complementary", { name: "Trak" })
  const press = drawer.getByRole("button", { name: "Stop verify" })
  await expect(press).toBeVisible()
  // The band is 32px on a desk and takes the press with it to 44 here: `client-style`'s
  // floor for a control drawn outside `Button`/`MenuItem`, paid in console height rather
  // than by a hit target grown past the card's clip.
  expect(await underFloor([["end the check", press]])).toEqual([])
  const band = press.locator("xpath=ancestor::div[contains(@class, 'border-b')][1]")
  expect((await sizeOf(band)).height).toBe(FLOOR)
  // Nothing pressed it: the stub would have counted the POST, and a stop kills a script.
  expect(acted.sent()).toBe(0)
})

test("the continues notice is one press that clears the floor", async ({ page }) => {
  const acted = await stubbed(page)
  await page.goto(`/traks/${GATED_ID}`)

  const drawer = page.getByRole("complementary", { name: "Trak" })
  // Step over to the continuing position on the strip. The key inside the sentence is
  // inline 2xs text and can never clear the floor on its own — the whole notice being
  // the press is the design, so the notice is the box measured.
  await drawer.getByRole("button", { name: /^builder — step 2 — / }).click()
  const notice = drawer.getByRole("button", { name: /continues the conversation/ })
  await expect(notice).toBeVisible()
  expect(await underFloor([["continues notice", notice]])).toEqual([])

  // And it is a navigation: pressing it moves the drawer to the position that holds the
  // conversation, spending nothing.
  await notice.click()
  await expect(drawer.getByRole("button", { name: "Send answers" })).toBeVisible()
  expect(acted.sent()).toBe(0)
})

test("a low tap on either directive arrow steps, rather than opening the instruction", async ({
  page,
}) => {
  await stubbed(page)
  await page.goto(`/traks/${GATED_ID}`)

  const block = page.getByRole("region", { name: "Current position" })
  await expect(block.getByRole("button", { name: "step 1" })).toBeVisible()

  // The instruction's press sits between the arrows on the same row, so a tap on an arrow's
  // lower edge is the one that would land on it if anything ever reached under them. 4px
  // above the bottom is inside the arrow's 44px.
  // The point is taken relative to the arrow at the moment of the tap, which `tap` makes only
  // once the arrow is visible and has stopped moving — a box read once off a block still
  // settling sent the tap where the arrow had been.
  // The two frames are for the pane's landing scroll, which pins the gate card's sticky header
  // one pixel below the arrows. Under CPU load Chromium hit-tests the touch against the last
  // painted frame, before that scroll is drawn, and sends it to the header — while the DOM,
  // which every Playwright check reads, already puts the arrow under the point.
  const tapLow = async (arrow: string): Promise<void> => {
    const press = block.getByRole("button", { name: arrow })
    await press.click({ trial: true })
    const box = await press.boundingBox()
    if (box === null) throw new Error(`${arrow} has no box`)
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve()
            })
          })
        }),
    )
    await press.tap({ position: { x: box.width / 2, y: box.height - 4 } })
  }

  await tapLow("Next step")
  await expect(block.getByRole("button", { name: "step 2" })).toHaveAttribute(
    "aria-expanded",
    "false",
  )

  await tapLow("Previous step")
  await expect(block.getByRole("button", { name: "step 1" })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
})

test("a field fitted before the web font swaps in is refitted to it", async ({ page }) => {
  // Held back until well after the gate draws, so the first fit is in the fallback face —
  // where the note's placeholder wraps to two lines and the web font's does not.
  await page.route("**/fonts.gstatic.com/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await route.continue()
  })
  await stubbed(page)
  await page.goto(`/traks/${GATED_ID}`)

  const note = page.getByRole("textbox", { name: "Additional thoughts" })
  await expect(note).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  // What `Field` would measure now against what it holds: equal once it has refitted,
  // whichever face won, so the test needs no font to have loaded and no height pinned.
  const drawnAndFresh = (): Promise<readonly [number, number]> =>
    note.evaluate((box: HTMLTextAreaElement) => {
      const drawn = box.offsetHeight
      const held = box.style.height
      box.style.height = "0px"
      const fresh = Math.max(
        box.scrollHeight + box.offsetHeight - box.clientHeight,
        Number.parseFloat(getComputedStyle(box).minHeight),
      )
      box.style.height = held
      return [drawn, fresh] as const
    })
  await expect.poll(async () => new Set(await drawnAndFresh()).size).toBe(1)
})

test("Enter on a touch keyboard inserts a newline and sends nothing", async ({ page }) => {
  const acted = await stubbed(page)
  await page.goto(`/traks/${GATED_ID}`)

  expect(await coarse(page)).toBe(true)

  // The coarse-pointer rendering path, end to end: `ChatBar` reads the media query at
  // the keystroke, so this is the one behaviour the width alone cannot select.
  const field = page.getByRole("textbox", { name: "Say something to the agent" })
  await field.click()
  await page.keyboard.type("two")
  await page.keyboard.press("Enter")
  await page.keyboard.type("lines")

  await expect(field).toHaveValue("two\nlines")
  // Zero POSTs: on a fine pointer that Enter is the send. The stub would have counted
  // and refused it, so a regression fails here rather than billing.
  expect(acted.sent()).toBe(0)
})

test("the list's dock reservation reads the home-indicator inset", async ({ page }) => {
  await stubbed(page)
  await page.goto("/")
  await expect(page.locator("ul li")).toHaveCount(MANY.length)

  const reservation = (): Promise<number> =>
    page.evaluate(() => {
      const main = document.querySelector("main")
      return main === null ? Number.NaN : Number.parseFloat(getComputedStyle(main).paddingBottom)
    })

  // Two readings of one declaration, apart by exactly the inset: the reservation is the
  // dock's own 96px *plus* `--spacing-safe-b`, because the dock rides that token higher.
  // The delta is asserted rather than the 130px sum, so the dock's shape can change
  // without touching this — what may not change is that the reservation reads the inset,
  // which is the half a flat `pb-24` silently dropped.
  const flat = await reservation()
  expect(flat).not.toBeNaN()
  await simulateInset(page)
  expect((await reservation()) - flat).toBe(INSET)

  // And the consequence a thumb would find: scrolled to the end, the last row ends above
  // the raised button rather than under it.
  await page.evaluate(() => {
    document.scrollingElement?.scrollTo(0, document.scrollingElement.scrollHeight)
  })
  const lastBottom = await page
    .locator("ul li")
    .last()
    .evaluate((node) => node.getBoundingClientRect().bottom)
  const dockTop = await page
    .getByRole("link", { name: "New Trak" })
    .evaluate((node) => node.getBoundingClientRect().top)
  expect(lastBottom).toBeLessThanOrEqual(dockTop)
})

test("the drawer's pane pays the inset exactly where no chat bar is below it", async ({ page }) => {
  await stubbed(page)
  await page.goto(`/traks/${GATED_ID}`)
  const drawer = page.getByRole("complementary", { name: "Trak" })
  await expect(drawer.getByRole("button", { name: "Send answers" })).toBeVisible()
  await simulateInset(page)

  // At the step altitude the chat bar below the pane pays the inset (`pb-foot`), so the
  // pane itself pays nothing — paying twice would open a 34px band between them.
  expect(await panePadding(page)).toBe("0px")

  // At the map and the trak altitudes the chat bar is withheld and nothing else sits
  // below the pane, so the pane is the payer — `DrawerPane` carries the rule.
  const map = drawer.getByRole("button", { name: "Map" })
  await map.click()
  await expect(map).toHaveAttribute("aria-current", "true")
  expect(await panePadding(page)).toBe(`${String(INSET)}px`)

  const trak = drawer.getByRole("button", { name: "Trak", exact: true })
  await trak.click()
  await expect(trak).toHaveAttribute("aria-current", "true")
  expect(await panePadding(page)).toBe(`${String(INSET)}px`)
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

const APPROVAL_ID = "e2e0e2e0-7777-4888-8999-aaaaaaaaaaaa"

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

/**
 * The finished pane's presses under a long pull-request card. The band holding them is
 * sticky in the drawer's pane, which happy-dom cannot see and an atelier proof cannot hold —
 * so the claim that Archive is on screen whatever the card's length, and that the row's
 * three cells fit the width rather than running off its right edge, is measured here.
 */
test("keeps the finished pane's presses on screen under a long pull-request card", async ({
  page,
}) => {
  await stubbed(page)
  await page.goto(`/traks/${ENDED_ID}`)
  await openReview(page)

  const archive = page.getByRole("button", { name: "Archive", exact: true })
  const ask = page.getByRole("button", { name: "Ask", exact: true })
  await expect(archive).toBeVisible()
  await expect(page.getByText(LAST_WORDS)).toBeAttached()

  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  if (viewport === null) return
  const inside = async (control: Locator): Promise<boolean> => {
    const box = await control.boundingBox()
    return (
      box !== null &&
      box.y >= 0 &&
      box.y + box.height <= viewport.height &&
      box.x >= 0 &&
      box.x + box.width <= viewport.width
    )
  }

  // The premise: the card runs past the screen, so the presses would be off it under the
  // old arrangement. Then the presses, on screen anyway.
  const last = await page.getByText(LAST_WORDS).boundingBox()
  expect(last).not.toBeNull()
  expect(last?.y ?? 0).toBeGreaterThan(viewport.height)
  expect(await inside(archive)).toBe(true)
  expect(await inside(ask)).toBe(true)

  // And still on screen once the reader has scrolled to the end.
  await page.getByText(LAST_WORDS).scrollIntoViewIfNeeded()
  expect(await inside(archive)).toBe(true)
  expect(await inside(ask)).toBe(true)
})

/**
 * The request box with several things ticked, under the pinned chrome. On a phone the box
 * says what is ticked as a count and opens in place of the press row, so the band is the
 * same height at two ticks as at more, and a ticked row scrolled clear of it can be read and
 * unticked. With a list and the row under it, the box left 7px of pane under the chrome.
 */
test("keeps the card readable with several comments ticked and the box open", async ({ page }) => {
  await stubbed(page)
  await page.goto(`/traks/${ENDED_ID}`)
  await openReview(page)

  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  if (viewport === null) return
  const inside = async (control: Locator): Promise<boolean> => {
    const box = await control.boundingBox()
    return (
      box !== null &&
      box.y >= 0 &&
      box.y + box.height <= viewport.height &&
      box.x >= 0 &&
      box.x + box.width <= viewport.width
    )
  }

  const boxes = page.getByRole("checkbox", { name: /^reviewer-/ })
  const send = page.getByRole("button", { name: "Send it back" })
  const band = send.locator("xpath=ancestor::div[contains(@class,'sticky')][1]")
  await expect(boxes.first()).toBeVisible()
  await boxes.nth(0).check()
  await boxes.nth(1).check()
  await expect(page.getByText("What should change?")).toBeAttached()

  // A count on the label line, no list and no remove, and the row gone while it is open.
  await expect(band.getByText("2 ticked")).toBeVisible()
  await expect(band.getByRole("button", { name: /^Remove/ })).toHaveCount(0)
  await Promise.all(
    ["Archive", "Ask", "More work"].map((name) =>
      expect(page.getByRole("button", { name, exact: true })).toHaveCount(0),
    ),
  )

  const two = (await band.boundingBox())?.height
  await boxes.nth(2).check()
  expect((await band.boundingBox())?.height).toBe(two)
  await boxes.nth(2).uncheck()

  // The send has to stay reachable, wherever the pane is scrolled.
  expect(await inside(send)).toBe(true)

  // And each ticked row is still a row somebody can read and untick: scrolled clear of the
  // band, the point at its centre lands on the checkbox itself.
  const top = (await band.boundingBox())?.y ?? 0
  const uncovered = async (row: Locator): Promise<boolean> => {
    // Halfway between the pane's top and the band's, which is the part of the pane left
    // uncovered — `scrollIntoView` centres on the whole pane, where the band is.
    await row.evaluate((node: Element, bandTop: number) => {
      let pane = node.parentElement
      while (pane !== null && getComputedStyle(pane).overflowY !== "auto") pane = pane.parentElement
      if (pane === null) return
      const paneTop = pane.getBoundingClientRect().top
      pane.scrollTop += node.getBoundingClientRect().top - (paneTop + (bandTop - paneTop) / 2)
    }, top)
    return row.evaluate((node: Element) => {
      const at = node.getBoundingClientRect()
      return document.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2) === node
    })
  }
  expect(await uncovered(boxes.nth(0))).toBe(true)
  expect(await uncovered(boxes.nth(1))).toBe(true)
  expect(await inside(send)).toBe(true)
  await boxes.nth(1).uncheck()
  await expect(band.getByText("1 ticked")).toBeVisible()

  // The way out of the box is the way back to the row.
  await page.getByRole("button", { name: "Clear" }).click()
  await expect(page.getByRole("button", { name: "More work", exact: true })).toBeVisible()
  await expect(boxes.nth(0)).not.toBeChecked()
})

/**
 * A door pressed from the pinned band answers in the box, which opens inside the band in
 * the row's place — on screen however long the review is — and takes focus into its field.
 * While the field has focus the chrome above the pane hides, so nothing pinned covers it,
 * and it comes back once the field lets go. The chat bar's field hides it the same way.
 */
test("brings the field a door opens on screen, focused and under nothing", async ({ page }) => {
  await stubbed(page)
  await page.goto(`/traks/${ENDED_ID}`)
  await openReview(page)
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

  const back = page.getByRole("link", { name: "Back" })
  await expect(back).toBeVisible()

  await page.getByRole("button", { name: "More work", exact: true }).click()
  expect(await shown(page.getByRole("textbox", { name: "What should change?" }))).toBe(true)
  await expect(back).toBeHidden()
  // Cancel takes no focus on a phone, so the field letting go is what a press elsewhere does.
  await page.getByRole("textbox", { name: "What should change?" }).blur()
  await expect(back).toBeVisible()
  await page.getByRole("button", { name: "Cancel" }).click()

  await page.getByRole("button", { name: "Ask", exact: true }).click()
  expect(await shown(page.getByRole("textbox", { name: "What do you want to ask?" }))).toBe(true)
  await expect(back).toBeHidden()

  // And the agent chat bar on a live turn.
  await page.goto(`/traks/${LIVE_ID}`)
  const chat = page.getByRole("textbox", { name: "Say something to the agent" })
  await expect(back).toBeVisible()
  await chat.focus()
  expect(await shown(chat)).toBe(true)
  await expect(back).toBeHidden()
  await chat.blur()
  await expect(back).toBeVisible()
})

/** Pressable at its centre: on screen and under nothing. */
const reachable = (control: Locator): Promise<boolean> =>
  control.evaluate((node: Element) => {
    const at = node.getBoundingClientRect()
    const x = at.x + at.width / 2
    const y = at.y + at.height / 2
    if (y < 0 || y > window.innerHeight) return false
    const hit = document.elementFromPoint(x, y)
    return hit !== null && (hit === node || node.contains(hit))
  })

/**
 * The whole chrome stays pinned above the pane while the pane follows a live turn to its
 * end — Back, the surface tabs, the strip and the directive — and on Map and Trak too.
 * It used to sit at the head of the pane's scroller and go off the top with every line.
 */
test("keeps the header, tabs, strip and directive on screen while the pane follows a live turn", async ({
  page,
}) => {
  await stubbed(page)
  await page.goto(`/traks/${LIVE_ID}`)
  await expect(page.getByText("line 60 of a turn", { exact: false })).toBeAttached()

  // The pane at its end, where following leaves it.
  const pane = page.locator(".overflow-y-auto").filter({ hasText: "line 60 of a turn" }).first()
  await pane.evaluate((node: Element) => {
    node.scrollTop = node.scrollHeight
  })
  const last = await page.getByText("line 60 of a turn", { exact: false }).boundingBox()
  expect(last?.y ?? 0).toBeLessThan(667)

  const back = page.getByRole("link", { name: "Back" })
  const block = page.getByRole("region", { name: "Current position" })
  expect(await reachable(back)).toBe(true)
  expect(await reachable(page.getByRole("button", { name: "Map", exact: true }))).toBe(true)
  expect(await reachable(page.getByRole("list", { name: "Positions" }))).toBe(true)
  expect(await reachable(block.getByRole("button", { name: "Previous step" }))).toBe(true)
  // One row: the floor and its hairline.
  expect((await sizeOf(block)).height).toBeLessThanOrEqual(FLOOR + 1)

  // Each surface scrolled to its end, Back and the way back to Agent still reachable.
  const pinnedOn = async (surface: string): Promise<void> => {
    await page.getByRole("button", { name: surface, exact: true }).click()
    await page
      .locator(".overflow-y-auto")
      .first()
      .evaluate((node: Element) => {
        node.scrollTop = node.scrollHeight
      })
    expect(await reachable(back)).toBe(true)
    expect(await reachable(page.getByRole("button", { name: "Agent", exact: true }))).toBe(true)
  }
  await pinnedOn("Map")
  await pinnedOn("Trak")
})

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
  // what says nothing covers it. Held at the landing, scrolled part-way back up, and at
  // the top.
  // The line is 4px; its press reaches the touch floor by rising over the spend row.
  const line = page.getByRole("button", { name: "What is in the context window" })
  await expect(line).toBeVisible()
  const press = await line.boundingBox()
  expect(press?.height ?? 0).toBeGreaterThanOrEqual(FLOOR)
  // It rises from the bar's foot and stops short of the field, which it used to cover.
  const field = await page
    .getByRole("textbox", { name: "Say something to the agent" })
    .boundingBox()
  expect(press?.y ?? 0).toBeGreaterThanOrEqual((field?.y ?? 0) + (field?.height ?? 0))
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

test("the list's first load fits the screen, with nothing to scroll sideways to", async ({
  page,
}) => {
  // The list is held on its first load: the route is taken and never answered, so the
  // page stays at `<EmptyState loading />` for as long as the case runs.
  await page.route("**/api/traks", () => new Promise<void>(() => undefined))
  await page.goto("/")
  await expect(page.getByRole("status")).toHaveText("Loading…")

  // The whole width, nothing more. The first-load band's placeholder bars once had
  // fixed widths that no percentage cap could bind, so the band was wider than the phone
  // and the page scrolled sideways by the difference — a fault no happy-dom tier can see,
  // because it is a measurement.
  const overrun = await page.evaluate(() => {
    const root = document.documentElement
    return root.scrollWidth - root.clientWidth
  })
  expect(overrun).toBe(0)
})

/**
 * The band's `⋯` on the ending cell that holds it — a pull request still open, where the
 * menu is the band's only route to Archive. The band is always on the pane's bottom edge,
 * so a panel hanging below it opened into the clipped overflow; it opens upward now. Under
 * a short card and a long one, because the band sat under a short card before and had room
 * below it there. A point test as well as a box: a panel clipped by the pane's own overflow
 * still reports a box inside the window.
 */
const MENU_ID = "e2e0e2e0-7777-4aaa-8bbb-dddddddddddd"

const openPullRequest = (card: "short" | "long") => ({
  ...longPullRequest,
  state: "open",
  ...(card === "short" ? { reviews: [], conversation: [] } : {}),
})

for (const card of ["short", "long"] as const)
  test(`opens the band's ⋯ upward and on screen under a ${card} card`, async ({ page }) => {
    await stubbed(page)
    // Registered after `stubbed`, so Playwright tries it first; anything else falls through.
    await page.route("**/api/traks/e2e0e2e0-7777-4aaa-8bbb-dddddddddddd**", async (route) => {
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
    if (card === "long") await openReview(page)

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

    // The menu shuts and the confirmation rises as a sheet, which has to draw over the
    // band it is mounted in rather than inside it. Not pressed: it would archive.
    await item.click()
    await expect(page.getByRole("menu")).toHaveCount(0)
    const confirm = page
      .getByRole("dialog", { name: "Archive this trak?" })
      .getByRole("button", { name: "Archive" })
    await expect(confirm).toBeVisible()
    expect(await shown(confirm)).toBe(true)
  })

/**
 * The header's ⋯ on a finished trak: its Archive asks in a sheet the page draws after the
 * pane. Drawn inside the header, a band at the same rung as the finished band but earlier in
 * the drawer, the sheet was painted under that band wherever the two crossed.
 */
test("asks the header's Archive in a sheet over the finished band", async ({ page }) => {
  await stubbed(page)
  await page.goto(`/traks/${ENDED_ID}`)

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

  await page.getByRole("button", { name: "More options" }).click()
  await page.getByRole("menuitem", { name: "Archive this trak" }).click()
  await expect(page.getByRole("menu")).toHaveCount(0)
  // Not pressed: it would archive.
  const sheet = page.getByRole("dialog", { name: "Archive this trak?" })
  await expect(sheet.getByRole("button", { name: "Archive" })).toBeVisible()
  expect(await shown(sheet.getByRole("button", { name: "Archive" }))).toBe(true)
  expect(await shown(sheet.getByRole("button", { name: "Cancel" }))).toBe(true)
  // Its heading too: here the finished band stands just above the chat bar, across the
  // sheet's top rather than its presses, and a sheet inside the header lost it there.
  expect(await shown(sheet.getByText("Archive this trak?"))).toBe(true)
})

test("the side panel's presses clear the floor, and its log pays the inset", async ({ page }) => {
  await stubbed(page)
  await page.goto(`/traks/${GATED_ID}`)
  const drawer = page.getByRole("complementary", { name: "Trak" })
  const opener = drawer.getByRole("button", { name: "Side panel" })
  await expect(opener).toBeVisible()
  expect(await underFloor([["the opener", opener]])).toEqual([])

  await opener.click()
  const panel = drawer.getByRole("region", { name: "Side panel" })
  const restart = panel.getByRole("button", { name: "Restart" })
  await expect(restart).toBeVisible()
  expect(
    await underFloor([
      ["Back", panel.getByRole("button", { name: "Back to the trak" })],
      ["the dev tab", panel.getByRole("tab", { name: "dev" })],
      ["the api tab", panel.getByRole("tab", { name: "api" })],
      ["Restart", restart],
      ["Stop", panel.getByRole("button", { name: "Stop" })],
    ]),
  ).toEqual([])

  // The log is the panel's bottom edge, and its scroller pays the inset inside itself so the
  // newest line rests above the indicator — `ProcessLog` carries the rule.
  const scroller = panel.getByLabel("dev's log").locator("xpath=..")
  await simulateInset(page)
  expect(await scroller.evaluate((node) => getComputedStyle(node).paddingBottom)).toBe(
    `${String(INSET)}px`,
  )

  await panel.getByRole("tab", { name: "api" }).click()
  const start = panel.getByRole("button", { name: "Start" })
  await expect(start).toBeVisible()
  expect(await underFloor([["Start", start]])).toEqual([])
})

const RUNNING_GOAL_ID = "e2e-goal-running"
const DRAFTED_GOAL_ID = "e2e-goal-drafted"

/** Every limit set, so each one draws its stepper as well as its switch. */
const GOAL_LIMITS = { parallel: 2, perHour: 3, perDay: 10, modes: ["smart", "auto"] } as const

const goalOf = (goal: GoalDto): GoalDetailDto => ({
  goal,
  log: [],
  settled: [],
  subgoals: [],
  transcript: [],
})

const runningGoal = goalOf({
  id: RUNNING_GOAL_ID,
  file: "measure.md",
  title: "Measure the goal's settings",
  line: "Every press in the sheet clears the floor",
  finished: "Done.",
  limits: { ...GOAL_LIMITS, modes: [...GOAL_LIMITS.modes] },
  state: { _tag: "Watching" },
  paused: false,
  running: false,
  offers: ["Chat"],
  plan: [],
  subgoalPlan: [],
  subgoals: [],
  traks: [],
  landed: 0,
  planned: 0,
  messages: [],
  dismissed: false,
})

const DRAFT = {
  file: "measure-draft",
  title: "Measure the drafted file",
  line: "Every press in the sheet clears the floor",
  finished: "Done.",
  limits: { ...GOAL_LIMITS, modes: [...GOAL_LIMITS.modes] },
}

/**
 * The Chat tab draws the file gate's card from the `GoalDrafted` in the log, not from
 * `state` — so without it the page shows no "Approve the goal file" card at all.
 */
const draftedGoal = {
  ...goalOf({
    id: DRAFTED_GOAL_ID,
    title: "Measure the drafted file",
    draft: DRAFT,
    limits: {},
    state: { _tag: "AtGate", gate: "file" },
    paused: false,
    running: false,
    offers: ["Approve", "Chat"],
    plan: [],
    subgoalPlan: [],
    subgoals: [],
    traks: [],
    landed: 0,
    planned: 0,
    messages: [],
    dismissed: false,
  }),
  log: [{ _tag: "GoalDrafted", call: "d1", draft: DRAFT }],
} satisfies GoalDetailDto

/**
 * The two goals, and every POST to a goal refused rather than passed through — a change
 * from the running goal's sheet is free, but Approve on the drafted file would spend.
 */
const stubbedGoals = async (page: Page): Promise<void> => {
  await page.route("**/api/goals**", async (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ status: 409, json: { _tag: "AtRest" } })
    const path = new URL(route.request().url()).pathname
    if (path === `/api/goals/${RUNNING_GOAL_ID}`) return route.fulfill({ json: runningGoal })
    if (path === `/api/goals/${DRAFTED_GOAL_ID}`) return route.fulfill({ json: draftedGoal })
    if (path === "/api/goals")
      return route.fulfill({ json: { goals: [runningGoal.goal, draftedGoal.goal] } })
    return route.continue()
  })
}

/**
 * Every press in the limits-and-modes strips — the draft's sheet, or a running goal's Goal
 * tab — and each limit row measured against the presses inside it: a row shorter than its
 * presses lets them overflow, and the column's `overflow-hidden` clips the last row's — a
 * press that measures 44 and is cut on glass. `done` where the strips are in a sheet.
 */
const sheetUnderFloor = async (sheet: Locator, done: boolean): Promise<readonly string[]> => {
  const presses = [
    ...(done ? [["Done", sheet.getByRole("button", { name: "Done" })] as const] : []),
    ...["Manual", "Smart", "Auto"].map(
      (mode) =>
        [`mode ${mode}`, sheet.getByRole("button", { name: new RegExp(`^${mode}`) })] as const,
    ),
    ...["Never", "Composer decides", "Always"].map(
      (merge) =>
        [`merge ${merge}`, sheet.getByRole("radio", { name: new RegExp(`^${merge}`) })] as const,
    ),
    ...["at once", "an hour", "a day"].flatMap((unit) => [
      [`fewer ${unit}`, sheet.getByRole("button", { name: `Fewer ${unit}` })] as const,
      [`more ${unit}`, sheet.getByRole("button", { name: `More ${unit}` })] as const,
      [`limit ${unit}`, sheet.getByRole("switch", { name: `Limit ${unit}` })] as const,
    ]),
  ] as const
  const rows = await Promise.all(
    ["At once", "Per hour", "Per day"].map(async (label) => {
      const row = sheet.getByText(label, { exact: true }).locator("xpath=..")
      const contained = await row.evaluate((node) => {
        const box = node.getBoundingClientRect()
        return [...node.querySelectorAll("button")].every((press) => {
          const at = press.getBoundingClientRect()
          return at.top >= box.top && at.bottom <= box.bottom
        })
      })
      return contained ? [] : [`${label} row overflowed by its presses`]
    }),
  )
  return [...(await underFloor(presses)), ...rows.flat()]
}

test("the goal settings' presses clear the floor, inside rows that hold them", async ({ page }) => {
  await stubbedGoals(page)

  // A running goal's settings are on its Goal tab, edited in place.
  await page.goto(`/goals/${RUNNING_GOAL_ID}`)
  const tab = page.getByRole("button", { name: "Goal", exact: true })
  await expect(tab).toBeVisible()
  await tab.click()
  const running = page.getByRole("complementary", { name: "Goal" })
  await expect(running.getByRole("group", { name: "Modes" })).toBeVisible()
  expect(await sheetUnderFloor(running, false)).toEqual([])

  await page.goto(`/goals/${DRAFTED_GOAL_ID}`)
  const card = page.getByRole("region", { name: "Approve the goal file" })
  const draftEdit = card.getByRole("button", { name: "Edit limits and modes" })
  await expect(draftEdit).toBeVisible()
  expect(await underFloor([["draft Edit", draftEdit]])).toEqual([])
  await draftEdit.click()
  const drafted = page.getByRole("dialog", { name: "Limits and modes" })
  await expect(drafted.getByText("Written into the file when you approve it.")).toBeVisible()
  expect(await sheetUnderFloor(drafted, true)).toEqual([])
})
