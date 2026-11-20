/**
 * Tier 2: the real page, hooks and seams, against fakes put where the desktop shell's
 * preload puts its two bridges — `LauncherPage.test.tsx`'s arrangement, and for its reason.
 * A host's page, with no bridge, is the host build's to test.
 *
 * Roles and text. What is asserted is which pane a project's state draws and which
 * presses it offers; how a tile looks is a picture's job, not this tier's.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import type { LauncherBridge, RecentProjectDto } from "@orkestra/shared/launcher"
import type { RailBridge, RailProjectDto, RailStateDto } from "@orkestra/shared/rail"
import { NO_RAIL } from "../../api/rail"
import { makeTrak } from "../../fixtures"
import RailPage from "./RailPage"

const project = (name: string, over: Partial<RailProjectDto> = {}): RailProjectDto => ({
  path: `/Users/k/Repos/${name}`,
  name,
  short: `~/Repos/${name}`,
  engine: "started",
  ...over,
})

const recents: readonly RecentProjectDto[] = [
  { path: "/Users/k/Repos/atelier", name: "atelier", short: "~/Repos/atelier" },
]

/** Both bridges a window's page is given, every function a spy, and a way to push a state. */
const fakeShell = (state: unknown) => {
  const listeners = new Set<(state: unknown) => void>()
  const rail = {
    state: vi.fn<() => Promise<unknown>>(() => Promise.resolve(state)),
    onState: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    select: vi.fn<(path: string) => void>(),
    retry: vi.fn<(path: string) => void>(),
    remove: vi.fn<(path: string) => void>(),
    menu: vi.fn<(path: string) => void>(),
    place: vi.fn<RailBridge["place"]>(),
  } satisfies RailBridge
  const launcher = {
    recents: vi.fn<() => Promise<unknown>>(() => Promise.resolve(recents)),
    onRecents: () => () => {},
    open: vi.fn<(path: string) => Promise<void>>(() => Promise.resolve()),
    pick: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  } satisfies LauncherBridge
  window.orkestraRail = rail
  window.orkestra = launcher
  return { rail, launcher, push: (next: RailStateDto) => listeners.forEach((l) => l(next)) }
}

const mount = (): ReturnType<typeof render> =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RailPage />
    </QueryClientProvider>,
  )

beforeEach(() => {
  delete window.orkestraRail
  delete window.orkestra
  window.history.replaceState(null, "", "/")
})
afterEach(() => {
  cleanup()
  host.resetHandlers()
})

/**
 * A host with one running project — what a host's build reads through its host transport. The
 * public build is never served by a host and has no such transport, so a page of it with no
 * bridge asks the host nothing; every request it made would land here and be counted.
 */
const asked: string[] = []
const host = setupServer(
  http.get("*/host/projects", () => HttpResponse.json({ projects: [] })),
  http.get("*/host/rail", () => new HttpResponse(null, { status: 404 })),
)
host.events.on("request:start", ({ request }) => {
  asked.push(request.url)
})
beforeAll(() => host.listen({ onUnhandledRequest: "error" }))
afterAll(() => host.close())

describe("RailPage", () => {
  it("draws a tile per project in the shell's order, and marks the selected one", async () => {
    const state: RailStateDto = {
      projects: [
        project("orkestra", {
          traks: [makeTrak({ state: { _tag: "AwaitingHuman", step: 1, kind: "approval" } })],
        }),
        project("harbor-web", { engine: "off" }),
      ],
      selected: "/Users/k/Repos/orkestra",
    }
    fakeShell(state)
    mount()

    const rail = await screen.findByRole("navigation", { name: "Projects" })
    await waitFor(() => expect(rail.querySelectorAll("button[aria-current]")).toHaveLength(1))
    expect(screen.getByRole("button", { name: "orkestra, 1 waiting on you" })).toHaveAttribute(
      "aria-current",
      "true",
    )
    expect(screen.getByRole("button", { name: "harbor-web, not started" })).not.toHaveAttribute(
      "aria-current",
    )
  })

  it("hands a pressed tile's path to the shell, and asks it for the tile's menu", async () => {
    const { rail } = fakeShell({ projects: [project("harbor-web", { engine: "off" })] })
    mount()

    const tile = await screen.findByRole("button", { name: "harbor-web, not started" })
    fireEvent.click(tile)
    expect(rail.select).toHaveBeenCalledWith("/Users/k/Repos/harbor-web")
    fireEvent.contextMenu(tile)
    expect(rail.menu).toHaveBeenCalledWith("/Users/k/Repos/harbor-web")
  })

  it("draws the list's loading frame while the selected project's engine starts", async () => {
    fakeShell({
      projects: [project("harbor-web", { engine: "starting" })],
      selected: "/Users/k/Repos/harbor-web",
    })
    mount()

    await screen.findByRole("button", { name: "harbor-web, starting" })
    expect(screen.getByRole("status")).toHaveTextContent("Loading…")
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("RailPage, for a project with no client to show", () => {
  it("offers Try again and Remove from window over what a failed engine printed", async () => {
    const { rail } = fakeShell({
      projects: [
        project("harbor-web", {
          engine: "failed",
          failure: {
            reason: "The engine for ~/Repos/harbor-web exited with 1 before serving.",
            output: "could not load .orkestra/agents/review.md",
          },
        }),
      ],
      selected: "/Users/k/Repos/harbor-web",
    })
    mount()

    expect(await screen.findByRole("heading", { name: "harbor-web did not start" })).toBeDefined()
    expect(screen.getByRole("alert")).toHaveTextContent("could not load .orkestra/agents/review.md")
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(rail.retry).toHaveBeenCalledWith("/Users/k/Repos/harbor-web")
    fireEvent.click(screen.getByRole("button", { name: "Remove from window" }))
    expect(rail.remove).toHaveBeenCalledWith("/Users/k/Repos/harbor-web")
  })

  it("offers Remove from window alone for a folder the shell refuses", async () => {
    fakeShell({
      projects: [
        project("harbor-web", {
          engine: "refused",
          failure: { reason: "~/Repos/harbor-web no longer exists." },
        }),
      ],
      selected: "/Users/k/Repos/harbor-web",
    })
    mount()

    expect(
      await screen.findByRole("heading", { name: "harbor-web cannot be opened" }),
    ).toBeDefined()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
    expect(screen.getByRole("button", { name: "Remove from window" })).toBeDefined()
  })
})

describe("RailPage, as the shell reports to it", () => {
  it("lists the recent projects in a window that holds none, with the add tile alone on the rail", async () => {
    const { launcher } = fakeShell({ projects: [] })
    mount()

    fireEvent.click(await screen.findByRole("button", { name: "atelier — ~/Repos/atelier" }))
    await waitFor(() => expect(launcher.open).toHaveBeenCalledWith("/Users/k/Repos/atelier"))
    const rail = screen.getByRole("navigation", { name: "Projects" })
    expect(rail.querySelectorAll("button")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Open a folder…" })).toBeDefined()
  })

  it("redraws when the shell pushes the next state, without asking again", async () => {
    const { rail, push } = fakeShell({ projects: [project("harbor-web", { engine: "off" })] })
    mount()
    await screen.findByRole("button", { name: "harbor-web, not started" })

    push({ projects: [project("harbor-web")], selected: "/Users/k/Repos/harbor-web" })
    expect(await screen.findByRole("button", { name: "harbor-web" })).toHaveAttribute(
      "aria-current",
      "true",
    )
    expect(rail.state).toHaveBeenCalledOnce()
  })

  it("draws no frame for a started project, since the shell lays its own view over the pane", async () => {
    fakeShell({ projects: [project("harbor-web")], selected: "/Users/k/Repos/harbor-web" })
    mount()

    await screen.findByRole("button", { name: "harbor-web" })
    expect(document.querySelector("iframe")).toBeNull()
  })
})

describe("RailPage, under the public slots", () => {
  it("with no bridge, asks no host, says it could not read its projects and draws no settings", async () => {
    asked.length = 0
    window.history.replaceState(null, "", "/?settings")
    mount()

    expect(await screen.findByText(NO_RAIL)).toBeDefined()
    expect(asked).toEqual([])
    expect(screen.queryByRole("button", { name: "Host settings" })).toBeNull()
    expect(screen.queryByRole("heading", { name: /settings/iu })).toBeNull()
  })
})
