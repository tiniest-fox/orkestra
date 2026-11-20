import type { Locator, Page } from "@playwright/test"
import type { TrakDetailDto, TrakSummaryDto } from "@orkestra/shared/dto/trak"

/**
 * What `phone.spec.ts` shares with any other phone spec, such as a host build's: the floor, the
 * simulated inset, the gated trak, and the measures. Not a spec, so Playwright collects
 * nothing from it — a spec that imported another spec would run its cases twice.
 */

/** The touch floor: no control that acts may be smaller than this on either axis. */
export const FLOOR = 44

/** An iPhone's home-indicator inset, the value the simulated-inset cases inject. */
export const INSET = 34

export const GATED_ID = "e2e0e2e0-9999-4aaa-8bbb-cccccccccccc"

/**
 * One question with options, so the gate draws every control it can: two option
 * presses, the field an option fills, and — because the recommended label pre-fills
 * it — an enabled submit.
 */
export const QUESTIONS = [
  {
    question: "Which way should the flag go?",
    context: "Both are defensible and the difference shows up much later.",
    options: [
      { label: "list only", description: "Smallest change.", recommended: true },
      { label: "all commands", description: "Consistent, but touches every handler." },
    ],
  },
]

/**
 * A trak at an answers gate with a plan long enough that the map overflows the pane —
 * which is what makes the pane's own padding observable at that altitude.
 */
export const gated: TrakDetailDto = {
  id: GATED_ID,
  description: "read the request back, word for word",
  mode: "manual",
  holding: false,
  skippingChecks: false,
  messages: [],
  returned: [],
  state: { _tag: "AwaitingHuman", step: 1, kind: "answers" },
  plan: {
    title: "Measure the phone layout",
    steps: [
      { type: "compose" },
      ...Array.from({ length: 25 }, (_, i) => ({
        type: "agent" as const,
        agent: "builder",
        instruction: `step ${String(i + 1)}`,
        conversational: false,
        // The second step picks the first's conversation up — with the spliced session
        // below, that is what draws the continues notice its floor case measures.
        ...(i === 1 ? { continues: "1-builder" } : {}),
      })),
    ],
  },
  decisions: [],
  marks: [],
  nextChecks: [],
  deployScript: false,
  log: [
    { _tag: "TrakCreated", description: "read the request back, word for word" },
    {
      _tag: "AgentReturned",
      step: 1,
      sessionId: "s-phone",
      output: { type: "questions", questions: QUESTIONS },
    },
  ],
  transcript: [
    { _tag: "Session", id: "s-phone", position: 1 },
    // The same session at a second position — the splice a `--resume` writes, which is
    // what resolves step 2's `continues` to a press.
    { _tag: "Session", id: "s-phone", position: 2 },
  ],
  custody: {},
}

/** Enough rows that the list overflows a 667px screen, so the foot is reachable at all. */
export const MANY: TrakSummaryDto[] = Array.from({ length: 30 }, (_, i) => ({
  id: `e2e0e2e0-aaaa-4bbb-8ccc-${String(i).padStart(12, "0")}`,
  description: `a trak long enough to fill the phone's list, number ${String(i + 1)}`,
  state: { _tag: "AwaitingHuman", step: 1, kind: "answers" },
  running: false,
  mode: "manual",
  branchMoved: false,
}))

/** Border-box size in CSS pixels. Via the rect rather than `boundingBox()`, which is
 *  nullable and would make every assertion conditional. */
export const sizeOf = (
  control: Locator,
): Promise<{ readonly width: number; readonly height: number }> =>
  control.evaluate((node: Element) => {
    const at = node.getBoundingClientRect()
    return { width: at.width, height: at.height }
  })

/** Measure every named control at once and report the ones under the floor, by name —
 *  so a failure says which control shrank instead of which index. */
export const underFloor = async (
  controls: readonly (readonly [string, Locator])[],
): Promise<readonly string[]> => {
  const sizes = await Promise.all(
    controls.map(async ([name, control]) => [name, await sizeOf(control)] as const),
  )
  return sizes
    .filter(([, size]) => size.width < FLOOR || size.height < FLOOR)
    .map(([name, size]) => `${name} (${String(size.width)}×${String(size.height)})`)
}

/** Simulate an installed iPhone's bottom inset — see the file header. */
export const simulateInset = async (page: Page): Promise<void> => {
  await page.addStyleTag({ content: `:root { --spacing-safe-b: ${String(INSET)}px; }` })
}

/**
 * The pane's computed bottom padding: the first vertically scrolling element in the
 * drawer that is not the position strip. The strip has to be skipped by name because
 * `overflow-x-auto` makes its *computed* `overflow-y` `auto` as well, and it sits before
 * the pane in document order; below the strip the pane is the first scroller, ahead of
 * any textarea inside it.
 */
export const panePadding = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const aside = document.querySelector("aside")
    if (aside === null) return "no drawer"
    for (const node of aside.querySelectorAll("*")) {
      if (node.getAttribute("aria-label") === "Positions") continue
      if (getComputedStyle(node).overflowY === "auto") return getComputedStyle(node).paddingBottom
    }
    return "no scroller"
  })
