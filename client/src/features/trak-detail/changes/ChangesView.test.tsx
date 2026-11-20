/**
 * Tier 2 (`testing-tiers`): the Changes surface against fixture props — RTL, no engine.
 *
 * Three facts this exists to get right, each of which draws something plausible when it is
 * wrong. A diff that blanks to an error the moment a poll drops loses work somebody is
 * reading; a deleted or binary file that opens expanded fills the pane with nothing; and a
 * cap that says nothing about what it dropped reads exactly like a complete list.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import userEvent from "@testing-library/user-event"
import { makeChanges, makeFileChange } from "../../../fixtures"
import { queryKeys } from "../../../queryCache"
import ChangesView from "./ChangesView"
import type { Landing } from "./useLanding"
import { ALL, UNCOMMITTED, slicesFor } from "./slices"
import type { Changes } from "./useChanges"

afterEach(cleanup)

/** The first load of the whole-branch slice, unless a case says otherwise. */
const asChanges = (over: Partial<Changes>): Changes => ({
  id: "trak-1",
  slices: slicesFor(undefined),
  at: ALL,
  pick: () => undefined,
  data: undefined,
  isError: false,
  error: null,
  ...over,
})

/**
 * A file card's own header press.
 *
 * Reached through the card rather than by name, because the index draws a press for each
 * file too and the two share a basename by construction.
 */
const header = (path: string): HTMLElement =>
  within(screen.getByRole("region", { name: path })).getByRole("button")

/** No change map asked the tab for a file. */
const NOWHERE: Landing = {
  path: undefined,
  land: vi.fn<(at: string, path: string) => void>(),
  drop: vi.fn<() => void>(),
}

const draw = (at: string, over: Partial<Changes>): void => {
  render(<ChangesView changes={asChanges({ at, ...over })} landing={NOWHERE} bandBelow={false} />)
}

describe("ChangesView", () => {
  it("keeps the diff on screen when a refetch fails with data in hand", () => {
    draw(UNCOMMITTED, {
      data: makeChanges({ files: [makeFileChange({ path: "src/app/server.ts" })] }),
      isError: true,
      error: new Error("the stream dropped"),
    })

    expect(screen.getByRole("region", { name: "src/app/server.ts" })).toBeDefined()
    expect(screen.queryByText("the stream dropped")).toBeNull()
  })

  it("reports a failure with nothing to fall back on", () => {
    draw(ALL, { isError: true, error: new Error("404 Not Found") })

    expect(screen.getByRole("alert").textContent).toContain("404 Not Found")
  })

  it("words an empty slice by which slice it is", () => {
    draw(UNCOMMITTED, { data: makeChanges({ at: UNCOMMITTED, files: [] }) })

    expect(screen.getByRole("heading", { name: "Nothing uncommitted" })).toBeDefined()
  })

  it("words an empty spawn by the pieces that ran there, not as one agent's step", () => {
    // The pane finds the showing row among the picker's, because `at` is a position index
    // at a step and at a spawn alike and only the row says which of the two this is.
    draw("2", {
      slices: [...slicesFor(undefined), { at: "2", label: "2 · 3 pieces", kind: "join" }],
      data: makeChanges({ at: "2", files: [] }),
    })

    expect(screen.getByRole("heading", { name: "These pieces changed no files" })).toBeDefined()
  })

  it("opens a deleted file folded and a modified one open", async () => {
    draw(ALL, {
      data: makeChanges({
        files: [
          makeFileChange({ path: "kept.ts" }),
          makeFileChange({ path: "gone.ts", change: "deleted" }),
        ],
      }),
    })

    expect(header("kept.ts").getAttribute("aria-expanded")).toBe("true")
    expect(header("gone.ts").getAttribute("aria-expanded")).toBe("false")

    // And a press is what reverses it, on the whole header rather than the chevron alone.
    await userEvent.click(header("gone.ts"))

    expect(header("gone.ts").getAttribute("aria-expanded")).toBe("true")
  })

  it("says what the cap dropped rather than stopping quietly", () => {
    draw(ALL, {
      data: makeChanges({ files: [makeFileChange({ path: "a.ts" })], omittedFiles: 24 }),
    })

    expect(screen.getByText(/24 more files changed and are not shown/)).toBeDefined()
  })

  it("says why a binary file has no hunks", () => {
    draw(ALL, {
      data: makeChanges({
        files: [makeFileChange({ path: "shot.png", binary: true, omitted: "binary", hunks: [] })],
      }),
    })

    // Folded by default, so the sentence arrives with the press that asked for it.
    expect(screen.queryByText(/Binary file/)).toBeNull()
  })

  it("totals the slice beside the picker", () => {
    draw(ALL, {
      data: makeChanges({
        files: [
          makeFileChange({ path: "a.ts", additions: 5, deletions: 2 }),
          makeFileChange({ path: "b.ts", additions: 1, deletions: 0 }),
        ],
      }),
    })

    expect(screen.getByText("2 files +6 −2")).toBeDefined()
  })

  it("hands the picker's press back with the slice that was pressed", async () => {
    const picked = vi.fn<(at: string) => void>()
    render(
      <ChangesView
        changes={asChanges({ data: makeChanges(), pick: picked })}
        landing={NOWHERE}
        bandBelow={false}
      />,
    )

    await userEvent.click(screen.getByRole("button", { name: "Uncommitted" }))

    expect(picked).toHaveBeenCalledWith(UNCOMMITTED)
  })

  it("lists every file in the index, so the whole slice is on screen at once", () => {
    draw(ALL, {
      data: makeChanges({
        files: [
          makeFileChange({ path: "client/src/api/types.ts" }),
          makeFileChange({ path: "client/src/api/client.ts" }),
        ],
      }),
    })

    const index = screen.getByRole("navigation", { name: "Files changed" })

    expect(index.textContent).toContain("client/src/api")
    expect(index.textContent).toContain("types.ts")
    expect(index.textContent).toContain("client.ts")
  })
})

describe("ChangesView, on a file `.gitattributes` marks generated", () => {
  it("opens a generated file folded with its counts, and draws the patch it asks for", async () => {
    // A step's slice, which is never stale, so the primed answer is the one the card reads
    // and nothing reaches for the network.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const proof = ".atelier/proof/chip.tsx"
    queryClient.setQueryData(
      queryKeys.changedFile("trak-1", "3", proof),
      makeChanges({ at: "3", files: [makeFileChange({ path: proof })] }),
    )
    const collapsed = makeFileChange({ path: proof, omitted: "generated", hunks: [] })
    render(
      <QueryClientProvider client={queryClient}>
        <ChangesView
          changes={asChanges({ at: "3", data: makeChanges({ at: "3", files: [collapsed] }) })}
          landing={NOWHERE}
          bandBelow={false}
        />
      </QueryClientProvider>,
    )

    const card = screen.getByRole("region", { name: proof })
    expect(header(proof).getAttribute("aria-expanded")).toBe("false")
    expect(card.textContent).toContain("+2 −1")
    expect(within(card).queryByText("changes,")).toBeNull()

    await userEvent.click(header(proof))

    expect(header(proof).getAttribute("aria-expanded")).toBe("true")
    expect(card.textContent).toContain("changes,")
  })
})
