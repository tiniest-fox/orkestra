/**
 * Tier 2: reporting a problem from the trak's `⋯` menu. Absent where the engine's detail
 * carries no `report` — an engine nobody hosts — and, where it does, a pane in place of the
 * step pane that sends the person's words, keeps them across a failed send, and shows the
 * reference once one goes.
 */

import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { makeReport } from "../../fixtures"
import type { ReportSendAnswerDto } from "../../api/types"
import {
  server,
  ID,
  detail,
  renderDetail,
  answers,
  loaded,
  emptyList,
} from "./TrakDetailPage.support"

const preview = (report = makeReport({ trak: { ...makeReport().trak, id: ID } })) =>
  http.get(`*/api/traks/${ID}/report`, () => HttpResponse.json(report))

/** Answers each send with the next of `answers`, keeping every body it was sent. */
const sends = (sent: unknown[], ...replies: readonly ReportSendAnswerDto[]) =>
  http.post(`*/api/traks/${ID}/report`, async ({ request }) => {
    sent.push(await request.json())
    return HttpResponse.json(replies[sent.length - 1] ?? replies.at(-1))
  })

const openReport = async (): Promise<void> => {
  await loaded()
  fireEvent.click(screen.getByRole("button", { name: "More options" }))
  fireEvent.click(screen.getByRole("menuitem", { name: "Report a problem…" }))
}

describe("with no report destination", () => {
  it("offers no report in the menu", async () => {
    server.use(emptyList, answers(detail()))
    renderDetail()
    await loaded()
    fireEvent.click(screen.getByRole("button", { name: "More options" }))
    expect(screen.getAllByRole("menuitem").length).toBeGreaterThan(0)
    expect(screen.queryByRole("menuitem", { name: "Report a problem…" })).toBeNull()
  })
})

describe("with a report destination", () => {
  it("opens the pane in place of the step, shows what goes, and sends an empty note", async () => {
    const sent: unknown[] = []
    server.use(
      emptyList,
      answers(detail({ report: { destination: "the inbox" } })),
      preview(),
      sends(sent, { _tag: "Sent", reference: "https://reports.example/42" }),
    )
    renderDetail()
    await openReport()

    const pane = screen.getByRole("region", { name: "Report a problem" })
    expect(screen.queryByRole("textbox", { name: "Say something to the agent" })).toBeNull()
    expect(await within(pane).findByText("removed")).toBeDefined()
    expect(within(pane).getByText("Sent to the inbox")).toBeDefined()
    fireEvent.click(within(pane).getByRole("button", { name: "Send report" }))

    expect(await screen.findByText("Report sent")).toBeDefined()
    expect(sent).toEqual([{ includeLog: true }])
    const link = screen.getByRole("link", { name: /reports\.example\/42/ })
    expect(link.getAttribute("href")).toBe("https://reports.example/42")
    expect(screen.getByText(/Sent to the inbox\./)).toBeDefined()
  })

  it("sends the note with the log turned off, and shows a text reference as text", async () => {
    const sent: unknown[] = []
    server.use(
      emptyList,
      answers(detail({ report: {} })),
      preview(),
      sends(sent, { _tag: "Sent", reference: "FB-20261127-0042" }),
    )
    renderDetail()
    await openReport()

    fireEvent.change(screen.getByRole("textbox", { name: "What went wrong (optional)" }), {
      target: { value: "It retried four times." },
    })
    await screen.findByText("removed")
    fireEvent.click(screen.getByRole("switch", { name: /Include the log/ }))
    expect(screen.getByText(/You turned it off/)).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Send report" }))

    expect(await screen.findByText("FB-20261127-0042")).toBeDefined()
    expect(sent).toEqual([{ note: "It retried four times.", includeLog: false }])
    expect(screen.queryByRole("link", { name: /FB-/ })).toBeNull()
    expect(screen.queryByText(/Sent to/)).toBeNull()
  })

  it("keeps the note and shows the reason when a send fails, and Try again sends it again", async () => {
    const sent: unknown[] = []
    server.use(
      emptyList,
      answers(detail({ report: { destination: "the inbox" } })),
      preview(),
      sends(
        sent,
        { _tag: "NotSent", reason: "The receiver did not answer within 30 seconds." },
        { _tag: "Sent", reference: "FB-1" },
      ),
    )
    renderDetail()
    await openReport()

    const box = screen.getByRole("textbox", { name: "What went wrong (optional)" })
    fireEvent.change(box, { target: { value: "It stopped." } })
    fireEvent.click(screen.getByRole("button", { name: "Send report" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("The receiver did not answer within 30 seconds.")
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: "What went wrong (optional)" })
        .value,
    ).toBe("It stopped.")
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))

    expect(await screen.findByText("Report sent")).toBeDefined()
    expect(sent).toEqual([
      { note: "It stopped.", includeLog: true },
      { note: "It stopped.", includeLog: true },
    ])
  })

  it("locks the log off and says why before sending where it cannot be cleaned", async () => {
    server.use(
      emptyList,
      answers(detail({ report: {} })),
      preview(makeReport({ log: { _tag: "LeftOut", reason: "secrets-unreadable" } })),
    )
    renderDetail()
    await openReport()

    const toggle = await screen.findByRole("switch", { name: /Include the log/ })
    await waitFor(() => {
      expect(toggle).toBeDisabled()
    })
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    expect(screen.getByText(/^No log\. The log is left out/)).toBeDefined()
  })

  it("goes back to the trak from the pane's back press", async () => {
    server.use(emptyList, answers(detail({ report: {} })), preview())
    renderDetail()
    await openReport()
    fireEvent.click(screen.getByRole("button", { name: /^Back to/ }))
    expect(await loaded()).toBeDefined()
    expect(screen.queryByRole("region", { name: "Report a problem" })).toBeNull()
  })
})

describe("the trak's own text in the preview", () => {
  it("shows the trak's title and description as they go, removals and cut marked", async () => {
    const report = makeReport()
    server.use(
      emptyList,
      answers(detail({ report: {} })),
      preview(
        makeReport({
          trak: {
            ...report.trak,
            id: ID,
            title: "Push fails with [redacted]",
            description: "Push fails with [redacted] in the env",
          },
          cut: { description: 4096 },
        }),
      ),
    )
    renderDetail()
    await openReport()

    const request = await screen.findByLabelText("The request that goes")
    expect(request.textContent).toBe(
      "Push fails with removed in the env ⋯ 4,096 more bytes left out",
    )
    // One in the title, one in the description, one in the fixture's log line.
    expect(screen.getAllByText("removed")).toHaveLength(3)
  })

  it("says the typed text is withheld, and takes no note, where it cannot be cleaned", async () => {
    server.use(
      emptyList,
      answers(detail({ report: {} })),
      preview(
        makeReport({
          withheld: "secrets-unreadable",
          trak: { ...makeReport().trak, id: ID, title: ID, description: "" },
          log: { _tag: "LeftOut", reason: "secrets-unreadable" },
        }),
      ),
    )
    renderDetail()
    await openReport()

    expect(
      await screen.findByText(/^The title, the description and your note are left out/),
    ).toBeDefined()
    expect(screen.getByRole("textbox", { name: "What went wrong (optional)" })).toBeDisabled()
    expect(screen.queryByLabelText("The request that goes")).toBeNull()
  })
})
