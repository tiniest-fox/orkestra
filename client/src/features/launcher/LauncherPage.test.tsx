/**
 * Tier 2: the real page, the real hooks, the real seam, against a fake put where the
 * desktop shell's preload puts the bridge — the wire is mocked, not the hook, so a shape
 * the seam would refuse fails here too.
 *
 * Roles and text, no snapshots. What the rows say is the one thing the round argued
 * about: two folders named `client` have to be told apart by their paths.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import type { LauncherBridge, RecentProjectDto } from "@orkestra/shared/launcher"
import LauncherPage from "./LauncherPage"

const rows: readonly RecentProjectDto[] = [
  { path: "/Users/k/Repos/orkestra", name: "orkestra", short: "~/Repos/orkestra" },
  {
    path: "/Users/k/Repos/harbor/apps/client",
    name: "client",
    short: "~/Repos/harbor/apps/client",
  },
  { path: "/Users/k/Repos/festival/client", name: "client", short: "~/Repos/festival/client" },
]

/**
 * A bridge whose every function is a spy, and whose `recents` answers `answer`. An
 * `open` never settles: the real one takes as long as an engine boot, and the window is
 * closed by the shell before it answers, so what the page does *while* it is pending is
 * the thing to see.
 */
const fakeBridge = (answer: unknown) => {
  const listeners = new Set<(recents: unknown) => void>()
  const bridge: LauncherBridge = {
    recents: vi.fn<() => Promise<unknown>>(() => Promise.resolve(answer)),
    onRecents: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    open: vi.fn<(path: string) => Promise<void>>(() => new Promise<void>(() => {})),
    pick: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  }
  return { bridge, push: (recents: unknown) => listeners.forEach((l) => l(recents)) }
}

const mount = (): ReturnType<typeof render> =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LauncherPage />
    </QueryClientProvider>,
  )

/** With no bridge the seam asks a host; an engine serving this page is not one, and 404s. */
const server = setupServer(
  http.get("*/host/projects", () => new HttpResponse(null, { status: 404 })),
)

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
beforeEach(() => {
  delete window.orkestra
})
afterEach(cleanup)
afterAll(() => server.close())

describe("LauncherPage", () => {
  it("lists each recent as its folder name over its path, in the shell's order", async () => {
    window.orkestra = fakeBridge(rows).bridge
    mount()

    const buttons = await screen.findAllByRole("button", { name: /—/ })
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "orkestra — ~/Repos/orkestra",
      "client — ~/Repos/harbor/apps/client",
      "client — ~/Repos/festival/client",
    ])
    expect(screen.getByRole("heading", { name: "Recent projects" })).toBeDefined()
  })

  it("hands the pressed row's path to the shell, and refuses a second press meanwhile", async () => {
    const { bridge } = fakeBridge(rows)
    window.orkestra = bridge
    mount()

    fireEvent.click(await screen.findByRole("button", { name: "client — ~/Repos/festival/client" }))
    await waitFor(() => expect(bridge.open).toHaveBeenCalledWith("/Users/k/Repos/festival/client"))
    // Every row is disabled while the shell boots, so the second press cannot land.
    expect(screen.getByRole("button", { name: "orkestra — ~/Repos/orkestra" })).toHaveProperty(
      "disabled",
      true,
    )
    expect(screen.getByRole("button", { name: "Open a folder…" })).toHaveProperty("disabled", true)
  })

  it("asks the shell for its picker from the footer button", async () => {
    const { bridge } = fakeBridge(rows)
    window.orkestra = bridge
    mount()

    fireEvent.click(await screen.findByRole("button", { name: "Open a folder…" }))
    await waitFor(() => expect(bridge.pick).toHaveBeenCalledOnce())
  })

  it("shows the empty region on a first launch, with the footer's button as the only one", async () => {
    window.orkestra = fakeBridge([]).bridge
    mount()

    expect(await screen.findByRole("heading", { name: "No projects yet" })).toBeDefined()
    expect(screen.getAllByRole("button")).toHaveLength(1)
  })

  it("redraws when the shell says the list changed, without asking again", async () => {
    const { bridge, push } = fakeBridge(rows)
    window.orkestra = bridge
    mount()
    await screen.findByRole("button", { name: "orkestra — ~/Repos/orkestra" })

    push(rows.slice(1))
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "orkestra — ~/Repos/orkestra" })).toBeNull(),
    )
    expect(bridge.recents).toHaveBeenCalledOnce()
  })

  it("says so when there is neither a bridge nor a host, rather than drawing an empty list", async () => {
    mount()

    expect(await screen.findByRole("alert")).toBeDefined()
    expect(screen.queryByRole("heading", { name: "No projects yet" })).toBeNull()
  })

  it("refuses a list the shell got wrong, rather than drawing half of it", async () => {
    window.orkestra = fakeBridge([{ path: "/x" }]).bridge
    mount()

    expect(await screen.findByRole("alert")).toBeDefined()
  })
})
