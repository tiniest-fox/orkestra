/**
 * Tier 2 (`testing-tiers`): RTL, no network — what each of the header's cells holds.
 *
 * **The failure worth a render test is a press in the wrong cell**, or an empty actions
 * cell drawn where a screen has nothing for it: the title cell holds the way back and the
 * title over its metadata, the presses cell the one action, the one menu and Close, and the
 * actions cell exists only where `actions` is given. Which row the actions sit on is a
 * container query happy-dom cannot evaluate — `e2e/app.spec.ts` measures it. The way out is a
 * link, so a memory router goes around it.
 */

import type { ReactElement } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router"
import Button from "./Button"
import ScreenHeader from "./ScreenHeader"

afterEach(cleanup)

/** A router around one component, because a link cannot render outside one. */
const inRouter = (element: ReactElement): void => {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => element }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  render(<RouterProvider router={router} />)
}

/** The header's grid cells, in source order: title, actions where given, presses. */
const cells = async (): Promise<readonly Element[]> => [
  ...((await screen.findByRole("banner")).firstElementChild?.children ?? []),
]

describe("the screen header", () => {
  it("draws no actions cell where there are no actions, with Close at desk", async () => {
    inRouter(<ScreenHeader title="Files" meta={["project checkout", "3 files"]} phone={false} />)
    const [title, presses, ...rest] = await cells()
    expect(rest).toHaveLength(0)
    expect(title).toContainElement(screen.getByRole("heading", { level: 1, name: "Files" }))
    expect(presses).toContainElement(screen.getByRole("link", { name: "Close" }))
    expect(screen.getByText("project checkout").closest("p")?.textContent).toBe(
      "project checkout·3 files",
    )
  })

  it("holds the action and the menu with Close, and the actions in a cell of their own", async () => {
    inRouter(
      <ScreenHeader
        title="A trak"
        meta={["quiet-gold-puffin"]}
        phone={false}
        action={<Button aria-label="Search">Search</Button>}
        menu={<Button aria-label="More options" />}
        actions={<Button>Run mode</Button>}
      />,
    )
    const [, actions, presses] = await cells()
    expect(presses).toContainElement(screen.getByRole("button", { name: "Search" }))
    expect(presses).toContainElement(screen.getByRole("button", { name: "More options" }))
    expect(presses).not.toContainElement(screen.getByRole("button", { name: "Run mode" }))
    expect(actions).toContainElement(screen.getByRole("button", { name: "Run mode" }))
  })

  it("goes back on the left on a phone, with no Close", async () => {
    inRouter(<ScreenHeader title="New Goal" meta={["not started"]} phone />)
    const [title] = await cells()
    expect(title?.firstElementChild).toBe(screen.getByRole("link", { name: "Back" }))
    expect(screen.queryByRole("link", { name: "Close" })).toBeNull()
  })

  it("closes by state where it is given a handler", async () => {
    let closed = false
    inRouter(
      <ScreenHeader
        title="Files"
        meta={[]}
        phone={false}
        closeLabel="Close the files"
        onClose={() => {
          closed = true
        }}
      />,
    )
    ;(await screen.findByRole("button", { name: "Close the files" })).click()
    expect(closed).toBe(true)
  })
})
