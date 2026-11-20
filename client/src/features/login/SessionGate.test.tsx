// Tier 2: the door, against a faked guard.
//
// The theme is which of the three states draws what — the bar is always there, and what
// its slot holds and what sits under it is the gate's decision. For the refused one, the
// login is everything under the bar and the children are not behind it: a login that drew
// the list underneath would be promising a page the engine refuses to send, and a slot
// that kept its link would be offering a route the guard refuses.
//
// The slot's occupant here is a bare anchor rather than the app's `Button to=`, because
// the gate is rendered without a router — it needs none of its own.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import SessionGate from "./SessionGate"

const server = setupServer()

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" })
})
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
afterAll(() => {
  server.close()
})

const isIn = http.get("*/api/session", () => new HttpResponse(null, { status: 204 }))
const isOut = http.get("*/api/session", () => new HttpResponse(null, { status: 401 }))
const unreachable = http.get("*/api/session", () => HttpResponse.error())

/** Accepts one passphrase; records what arrived, so a test can say what was sent. */
const accepts = (passphrase: string, sent: string[]) =>
  http.post("*/api/session", async ({ request }) => {
    const body: unknown = await request.json()
    const typed =
      typeof body === "object" && body !== null && "passphrase" in body
        ? String(body.passphrase)
        : ""
    sent.push(typed)
    return new HttpResponse(null, { status: typed === passphrase ? 204 : 401 })
  })

const renderGate = (): QueryClient => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SessionGate action={<a href="/traks/new">New Trak</a>}>
        <p>the trak list</p>
      </SessionGate>
    </QueryClientProvider>,
  )
  return queryClient
}

describe("the session gate", () => {
  it("draws the app under the bar, slot filled, when the engine says this browser is in", async () => {
    server.use(isIn)
    renderGate()
    expect(await screen.findByText("the trak list")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "New Trak" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Passphrase")).not.toBeInTheDocument()
  })

  it("draws the bar with its slot empty until it knows, and nothing under it", () => {
    server.use(isIn)
    renderGate()
    expect(screen.getByText("Orkestra")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "New Trak" })).not.toBeInTheDocument()
    expect(screen.queryByText("the trak list")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Passphrase")).not.toBeInTheDocument()
  })

  it("draws the login and nothing else when refused — the bar with its slot empty", async () => {
    server.use(isOut)
    renderGate()
    expect(await screen.findByLabelText("Passphrase")).toBeInTheDocument()
    expect(screen.getByText("Behind a passphrase")).toBeInTheDocument()
    expect(screen.queryByText("the trak list")).not.toBeInTheDocument()
    // The bar is on screen, and the one thing its slot holds is a link the guard refuses.
    expect(screen.getByText("Orkestra")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "New Trak" })).not.toBeInTheDocument()
  })

  it("puts the engine being unreachable on the band, not on the field", async () => {
    server.use(
      isOut,
      http.post("*/api/session", () => HttpResponse.error()),
    )
    renderGate()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText("Passphrase"), "anything{Enter}")
    // The list's own unreachable band: it announces itself, and the field is not blamed.
    const band = await screen.findByRole("alert")
    expect(band).toHaveTextContent("Could not reach the engine")
    expect(screen.getByLabelText("Passphrase")).toHaveAttribute("aria-invalid", "false")
  })

  it("draws the app when the engine cannot be asked, so an outage is not a login", async () => {
    server.use(unreachable)
    renderGate()
    expect(await screen.findByText("the trak list")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "New Trak" })).toBeInTheDocument()
  })

  it("will not send an empty passphrase", async () => {
    server.use(isOut)
    renderGate()
    const button = await screen.findByRole("button", { name: "Sign in" })
    expect(button).toBeDisabled()
  })

  it("says so for a wrong passphrase, and lets the app through for the right one", async () => {
    const sent: string[] = []
    server.use(isOut, accepts("correct horse", sent))
    renderGate()
    const user = userEvent.setup()

    const field = await screen.findByLabelText("Passphrase")
    await user.type(field, "wrong")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("That is not the passphrase.")
    // The refusal is the field's: it turns, and the strip hangs off it.
    expect(field).toHaveAttribute("aria-invalid", "true")
    expect(screen.queryByText("the trak list")).not.toBeInTheDocument()

    await user.clear(field)
    await user.type(field, "correct horse{Enter}")
    expect(await screen.findByText("the trak list")).toBeInTheDocument()
    expect(sent).toEqual(["wrong", "correct horse"])
  })

  it("goes back to the login when a poll finds the session gone", async () => {
    server.use(isIn)
    const cache = renderGate()
    expect(await screen.findByText("the trak list")).toBeInTheDocument()

    // An engine restart forgets every session. The next poll is what notices; here it
    // is forced rather than waited for.
    server.use(isOut)
    await cache.invalidateQueries()
    await waitFor(() => {
      expect(screen.getByLabelText("Passphrase")).toBeInTheDocument()
    })
    expect(screen.queryByText("the trak list")).not.toBeInTheDocument()
    // The bar never left; its slot did.
    expect(screen.getByText("Orkestra")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "New Trak" })).not.toBeInTheDocument()
  })
})
