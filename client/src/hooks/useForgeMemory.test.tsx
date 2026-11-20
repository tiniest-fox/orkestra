/**
 * The row behind an open drawer and the drawer's own card read one store, and this is
 * what holds the row to it.
 *
 * `useForgeMemory` folds every forge answer in the query cache during render, so the fold
 * is only as fresh as the render — and a trak's own pane landing an answer under
 * `queryKeys.pullRequest` re-renders nothing in the list by itself. The hook's subscription
 * to the cache is what makes the row re-read: the test mounts one reader, writes a pull
 * request under the pane's key with nothing else moving, and expects the reader to say so.
 *
 * `usePullRequest`'s docblock promises exactly this — "what this pane reads is projected
 * into the store, so the row behind this page says what the card said without waiting out
 * the list's poll" — and nothing but this subscription makes it true.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { makePullRequest } from "../fixtures"
import { queryKeys } from "../queryCache"
import { useForgeMemory } from "./useForgeMemory"

afterEach(cleanup)

const BRANCH = "trak/awkward-peach-bonobo"

/** A row, at the one thing it asks the memory for. */
const Row = (): ReactNode => {
  const memory = useForgeMemory()
  const pull = memory.get(BRANCH)?.pull
  return <span>{pull === undefined ? "nothing yet" : `#${pull.number} ${pull.checks}`}</span>
}

describe("useForgeMemory", () => {
  it("reaches the row when a trak's own pane learns something new", () => {
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <Row />
      </QueryClientProvider>,
    )
    expect(screen.getByText("nothing yet")).toBeInTheDocument()

    // The drawer's `usePullRequest` resolves: checks are running on this branch.
    act(() => {
      client.setQueryData(
        queryKeys.pullRequest("a-trak"),
        makePullRequest({ branch: BRANCH, rollup: "running" }),
      )
    })

    expect(screen.getByText("#41 running")).toBeInTheDocument()
    client.clear()
  })
})
