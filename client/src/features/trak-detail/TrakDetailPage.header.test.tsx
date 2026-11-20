/**
 * Tier 2: what a person steers the trak with from the header — the run mode and its
 * one-shots, the openers and the handoff, and the Rebuild. Split from
 * `TrakDetailPage.controls.test.tsx`, which holds the chat bar and the presses that leave
 * a step, so the two run on separate workers.
 */

import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { makeOpeners, makeWorktree } from "../../fixtures"
import {
  server,
  ID,
  detail,
  renderDetail,
  answers,
  loaded,
  emptyList,
  working,
  finished,
  previews,
  modes,
} from "./TrakDetailPage.support"

const holds = (sent: unknown[]) =>
  http.post("*/api/traks/:id/hold", async ({ params, request }) => {
    sent.push({ id: params["id"], body: await request.json() })
    return new HttpResponse(null, { status: 204 })
  })

describe("the run mode in the header", () => {
  it("reads out the mode, and opens on four modes with the hold at the foot", async () => {
    server.use(emptyList, answers(detail({ mode: "smart" })))
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Run mode: Smart" }))
    expect(screen.getAllByRole("menuitemradio").map((r) => r.textContent)).toEqual([
      "ManualYou review everything",
      "SmartOnly what matters",
      "DeciderYou make the calls",
      "AutoRuns on its own",
    ])
    expect(screen.getByRole("menuitemradio", { name: /Smart/ }).getAttribute("aria-checked")).toBe(
      "true",
    )
    // The row's name is its text run together, which is what `^Hold` matches on.
    expect(screen.getByRole("menuitemcheckbox", { name: /^Hold/ })).toBeDefined()
  })

  it("withholds the hold while a spawn's children run, where there is no step to hold", async () => {
    server.use(
      emptyList,
      answers(detail({ mode: "smart", state: { _tag: "AwaitingChildren", step: 2 } })),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Run mode: Smart" }))
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(4)
    expect(screen.queryByRole("menuitemcheckbox", { name: /^Hold/ })).toBeNull()
  })

  it("sends the mode picked, to this trak, and closes", async () => {
    const sent: unknown[] = []
    server.use(emptyList, answers(detail({ mode: "smart" })), modes(sent))
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Run mode: Smart" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Manual/ }))

    await waitFor(() => {
      expect(sent).toEqual([{ id: ID, body: { mode: "manual" } }])
    })
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("asks for the hold, and takes a pending one back, by the same row", async () => {
    const sent: unknown[] = []
    server.use(emptyList, answers(detail({ mode: "auto", holding: true })), holds(sent))
    renderDetail()

    // Pending, the readout says so — in its name, and as the plate a sighted reader sees.
    fireEvent.click(
      await screen.findByRole("button", { name: "Run mode: Auto, holding this step" }),
    )
    const row = screen.getByRole("menuitemcheckbox", { name: /^Holding/ })
    expect(row.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(row)

    await waitFor(() => {
      expect(sent).toEqual([{ id: ID, body: { holding: false } }])
    })
  })

  it("does not offer the hold on manual, where every gate is stood at already", async () => {
    server.use(emptyList, answers(detail({ mode: "manual" })))
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Run mode: Manual" }))
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(4)
    expect(screen.queryByRole("menuitemcheckbox", { name: /^Hold/ })).toBeNull()
  })

  it("is live while an agent is working, which is the case it exists for", async () => {
    const sent: unknown[] = []
    server.use(emptyList, answers(working({ mode: "auto" })), modes(sent))
    renderDetail()

    const readout = await screen.findByRole("button", { name: "Run mode: Auto" })
    expect(readout.hasAttribute("disabled")).toBe(false)
    fireEvent.click(readout)
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Manual/ }))

    await waitFor(() => {
      expect(sent).toEqual([{ id: ID, body: { mode: "manual" } }])
    })
  })

  it("says why a refused change did not land, beside the readout", async () => {
    server.use(
      emptyList,
      answers(detail({ mode: "smart" })),
      http.post("*/api/traks/:id/mode", () =>
        HttpResponse.json({ _tag: "AtRest" }, { status: 409 }),
      ),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Run mode: Smart" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Auto/ }))

    expect(await screen.findByRole("alert")).toBeDefined()
    expect(screen.getByRole("button", { name: "Run mode: Smart" })).toBeDefined()
  })

  it("is drawn at every altitude, because the mode is about the trak", async () => {
    server.use(emptyList, answers(working({ mode: "auto" })))
    renderDetail()

    await loaded()
    for (const level of [/Map/, /Trak/]) {
      fireEvent.click(screen.getByRole("button", { name: level }))
      expect(screen.getByRole("button", { name: "Run mode: Auto" })).toBeDefined()
    }
  })
})

/**
 * The editor and the terminal at the checkout — drawn from two facts the header
 * composes: the engine's machine has apps to open it with, and this trak still has a
 * checkout to open. `controls.test.ts` holds the state switch; these pin the
 * composition and the default above pins the platform's no.
 */
describe("the opener controls", () => {
  const listed = http.get("*/api/openers", () => HttpResponse.json(makeOpeners()))
  const OPEN = "Open Ghostty at this trak's checkout"
  const EDIT = "Open Zed at this trak's checkout"

  it("offers the bound editor and the bound terminal on a trak with a checkout, editor first", async () => {
    server.use(listed, answers(detail({ worktree: makeWorktree() })))
    renderDetail()

    await loaded()
    const terminal = await screen.findByRole("button", { name: OPEN })
    const editor = screen.getByRole("button", { name: EDIT })
    expect(terminal).toBeEnabled()
    expect(editor).toBeEnabled()
    // The editor is the outer one, so the terminal keeps the picker as its neighbour.
    expect(editor.compareDocumentPosition(terminal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("withholds both while there is no checkout to open at", async () => {
    server.use(listed, answers(detail()))
    renderDetail()

    await loaded()
    expect(screen.queryByRole("button", { name: OPEN })).toBeNull()
    expect(screen.queryByRole("button", { name: EDIT })).toBeNull()
  })

  it("withholds it where an archive took the checkout, whatever the wire still names", async () => {
    // `worktree` is set on purpose: the wire keeps naming a deleted checkout, so the
    // state is the only thing that can say no here.
    server.use(
      emptyList,
      listed,
      answers(detail({ state: { _tag: "Closed" }, worktree: makeWorktree() })),
    )
    renderDetail()

    await loaded()
    expect(screen.queryByRole("button", { name: OPEN })).toBeNull()
  })

  it("withholds it on a merged trak, whose merge press ran that same archive", async () => {
    // `Merged` is only reached through `Closing`, which removed the checkout — the
    // ordinary happy ending is the same no as `Closed`.
    server.use(
      emptyList,
      listed,
      answers(detail({ state: { _tag: "Merged", sha: "abc1234" }, worktree: makeWorktree() })),
    )
    renderDetail()

    await loaded()
    expect(screen.queryByRole("button", { name: OPEN })).toBeNull()
  })

  it("withholds both on the platform's 404, checkout or not", async () => {
    // The default handler above is the platform saying no.
    server.use(answers(detail({ worktree: makeWorktree() })))
    renderDetail()

    await loaded()
    expect(screen.queryByRole("button", { name: OPEN })).toBeNull()
    expect(screen.queryByRole("button", { name: EDIT })).toBeNull()
  })
})

/**
 * A sandboxed trak — `handoff` on the wire. Its checkout is on another machine, so the
 * editor says it has no local path, the terminal opens a shell in the sandbox, and the
 * commands that resume the session sit beside them; under a host the command to run there
 * replaces the terminal press.
 */
describe("the handoff on a sandboxed trak", () => {
  const listed = http.get("*/api/openers", () => HttpResponse.json(makeOpeners()))
  const RESUME = "claude --resume 7d3f0c1e-2b4a-4c8e-9f61-0a1b2c3d4e5f"
  const HOST = "pnpm host shell orkestra t1"

  it("draws the editor disabled with the reason, the terminal at the sandbox, and the resume line", async () => {
    server.use(listed, answers(detail({ worktree: makeWorktree(), handoff: { resume: RESUME } })))
    renderDetail()

    await loaded()
    expect(
      await screen.findByRole("button", { name: "Open Ghostty at this trak's sandbox" }),
    ).toBeEnabled()
    expect(
      screen.getByRole("button", { name: "Zed: A sandboxed trak has no local path." }),
    ).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: "Resume this session yourself" }))
    expect(screen.getByText(RESUME)).toBeDefined()
    expect(screen.queryByText(HOST)).toBeNull()
  })

  it("under a host, shows the line to run there in place of the terminal press", async () => {
    // The default handler is the platform's no: a host's engine on Linux lists nothing.
    server.use(
      answers(detail({ worktree: makeWorktree(), handoff: { resume: RESUME, host: HOST } })),
    )
    renderDetail()

    await loaded()
    fireEvent.click(await screen.findByRole("button", { name: "Resume this session yourself" }))
    expect(screen.getByText(HOST)).toBeDefined()
    expect(screen.getByText(RESUME)).toBeDefined()
    expect(screen.queryByRole("button", { name: /^Open Ghostty at this trak/ })).toBeNull()
  })

  it("under a host on a machine that lists terminals, still draws no terminal press", async () => {
    server.use(
      listed,
      answers(detail({ worktree: makeWorktree(), handoff: { resume: RESUME, host: HOST } })),
    )
    renderDetail()

    await loaded()
    expect(
      await screen.findByRole("button", { name: "Resume this session yourself" }),
    ).toBeDefined()
    expect(screen.queryByRole("button", { name: /^Open Ghostty at this trak/ })).toBeNull()
  })

  it("draws no handoff on a trak whose checkout is on the engine's machine", async () => {
    server.use(listed, answers(detail({ worktree: makeWorktree() })))
    renderDetail()

    await loaded()
    await screen.findByRole("button", { name: "Open Ghostty at this trak's checkout" })
    expect(screen.queryByRole("button", { name: "Resume this session yourself" })).toBeNull()
  })
})

/**
 * The one-shot skip at the foot of the same panel — `useSetHold`'s twin, offered on every
 * mode and drawn armed both in the panel and on the readout.
 */
const skips = (sent: unknown[]) =>
  http.post("*/api/traks/:id/skip-checks", async ({ params, request }) => {
    sent.push({ id: params["id"], body: await request.json() })
    return new HttpResponse(null, { status: 204 })
  })

describe("skipping the next step's checks, from the run-mode panel", () => {
  it("is offered on manual, where the hold is not — the foot survives the mode", async () => {
    server.use(emptyList, answers(detail({ mode: "manual", nextChecks: ["verify"] })))
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Run mode: Manual" }))
    expect(screen.queryByRole("menuitemcheckbox", { name: /^Hold/ })).toBeNull()
    const row = screen.getByRole("menuitemcheckbox", { name: /^Skip checks/ })
    expect(row.getAttribute("aria-checked")).toBe("false")
    // At rest the foot says nothing: the sentence appears once there is something to say.
    expect(screen.queryByText(/will not run/)).toBeNull()
  })

  it("sits under the hold on smart, and asks for the skip by the same row", async () => {
    const sent: unknown[] = []
    server.use(emptyList, answers(detail({ mode: "smart", nextChecks: ["verify"] })), skips(sent))
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Run mode: Smart" }))
    const rows = screen.getAllByRole("menuitemcheckbox").map((r) => r.textContent)
    expect(rows).toEqual([
      "Holdthis step",
      "Skip checksthe next step",
      "Auto-mergeonce its checks pass",
    ])
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /^Skip checks/ }))

    await waitFor(() => {
      expect(sent).toEqual([{ id: ID, body: { skipping: true } }])
    })
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("armed, wears its plate on the readout, names the script in the foot, and takes it back", async () => {
    const sent: unknown[] = []
    server.use(
      emptyList,
      answers(detail({ mode: "auto", skippingChecks: true, nextChecks: ["verify"] })),
      skips(sent),
    )
    renderDetail()

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Run mode: Auto, skipping checks on the next step",
      }),
    )
    const row = screen.getByRole("menuitemcheckbox", { name: /^Skipping checks/ })
    expect(row.getAttribute("aria-checked")).toBe("true")
    // On auto the foot says the one extra thing that is true there.
    expect(
      screen.getByText(
        "verify will not run on the next step. It is accepted with nobody reading it.",
      ),
    ).toBeDefined()
    fireEvent.click(row)

    await waitFor(() => {
      expect(sent).toEqual([{ id: ID, body: { skipping: false } }])
    })
  })

  it("says the switch is waiting where the next step declares no checks", async () => {
    server.use(emptyList, answers(detail({ mode: "smart", skippingChecks: true, nextChecks: [] })))
    renderDetail()

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Run mode: Smart, skipping checks on the next step",
      }),
    )
    expect(
      screen.getByText("The next step declares no checks; the first that does will not run them."),
    ).toBeDefined()
  })

  it("wears both plates apart where a hold is pending beside it", async () => {
    server.use(
      emptyList,
      answers(
        detail({ mode: "smart", holding: true, skippingChecks: true, nextChecks: ["verify"] }),
      ),
    )
    renderDetail()

    expect(
      await screen.findByRole("button", {
        name: "Run mode: Smart, holding this step, skipping checks on the next step",
      }),
    ).toBeDefined()
  })

  it("is withheld past the last stop, where no check run is ahead", async () => {
    server.use(emptyList, answers(detail({ mode: "smart", state: { _tag: "Merging" } })))
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Run mode: Smart" }))
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(4)
    // Auto-merge is a setting rather than a one-shot, so it is still offered here.
    expect(screen.getAllByRole("menuitemcheckbox").map((r) => r.textContent)).toEqual([
      "Auto-mergeonce its checks pass",
    ])
  })
})

/**
 * Auto-merge, the third switch at the foot of the same panel — a setting rather than a
 * one-shot, offered at `Finished` too, and pressed on to start a stopped one again.
 */
const autoMerges = (sent: unknown[]) =>
  http.post("*/api/traks/:id/auto-merge", async ({ params, request }) => {
    sent.push({ id: params["id"], body: await request.json() })
    return new HttpResponse(null, { status: 204 })
  })

describe("auto-merge, from the run-mode panel", () => {
  it("offers no mode once the trak has no next gate — only auto-merge, at Finished", async () => {
    server.use(emptyList, answers(finished({ mode: "auto" })), previews({ into: "main" }))
    renderDetail()

    await loaded()
    expect(screen.queryByRole("button", { name: /^Run mode/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Auto-merge: off" }))
    expect(screen.queryByRole("menuitemradio")).toBeNull()
    expect(screen.getAllByRole("menuitemcheckbox").map((r) => r.textContent)).toEqual([
      "Auto-mergeonce its checks pass",
    ])
  })

  it("is gone altogether once the trak is archived", async () => {
    server.use(emptyList, answers(finished({ mode: "auto", state: { _tag: "Closed" } })))
    renderDetail()

    await loaded()
    expect(screen.queryByRole("button", { name: /^Run mode|^Auto-merge/ })).toBeNull()
  })

  it("sits under the one-shots and turns it on, live while an agent works", async () => {
    const sent: unknown[] = []
    server.use(emptyList, answers(working({ mode: "smart" })), autoMerges(sent))
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Run mode: Smart" }))
    const row = screen.getByRole("menuitemcheckbox", { name: /^Auto-merge/ })
    expect(row.getAttribute("aria-checked")).toBe("false")
    fireEvent.click(row)

    await waitFor(() => {
      expect(sent).toEqual([{ id: ID, body: { on: true } }])
    })
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("on, wears its plate on the readout and turns off by the same row", async () => {
    const sent: unknown[] = []
    server.use(
      emptyList,
      answers(detail({ mode: "smart", autoMerge: { sentBack: 1, limit: 3 } })),
      autoMerges(sent),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Run mode: Smart, auto-merging" }))
    const row = screen.getByRole("menuitemcheckbox", { name: /^Auto-merging/ })
    expect(row.textContent).toBe("Auto-mergingsent back 1 of 3")
    fireEvent.click(row)

    await waitFor(() => {
      expect(sent).toEqual([{ id: ID, body: { on: false } }])
    })
  })

  it("stopped, reads off with the cause under it, and is pressed on to start again", async () => {
    const sent: unknown[] = []
    server.use(
      emptyList,
      answers(finished({ autoMerge: { sentBack: 0, limit: 3, stopped: { _tag: "Blocked" } } })),
      previews({ into: "main" }),
      autoMerges(sent),
    )
    renderDetail()

    await loaded()
    fireEvent.click(screen.getByRole("button", { name: "Auto-merge: off" }))
    const row = screen.getByRole("menuitemcheckbox", { name: /^Auto-merge/ })
    expect([row.getAttribute("aria-checked"), row.textContent]).toEqual([
      "false",
      "Auto-mergestopped",
    ])
    expect(screen.getByText(/Merge it on GitHub once the review is in\.$/)).toBeDefined()
    fireEvent.click(row)

    await waitFor(() => {
      expect(sent).toEqual([{ id: ID, body: { on: true } }])
    })
  })

  it("says why a refused press did not land, beside the readout", async () => {
    server.use(
      emptyList,
      answers(detail({ mode: "smart" })),
      http.post("*/api/traks/:id/auto-merge", () =>
        HttpResponse.json({ _tag: "GoalForbidsAutoMerge" }, { status: 409 }),
      ),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole("button", { name: "Run mode: Smart" }))
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /^Auto-merge/ }))

    expect((await screen.findByRole("alert")).textContent).toBe(
      "This trak’s goal does not allow auto-merge.",
    )
  })
})

/**
 * A sandboxed trak's Rebuild, in the header's menu above the archive. The press is free and
 * queued by the engine under a running turn, so the menu says what it waits on rather than
 * offering a second press.
 */
describe("the Rebuild on a sandboxed trak", () => {
  const SANDBOXED = { worktree: makeWorktree(), handoff: { resume: "claude --resume s-1" } }

  it("asks first, then posts the rebuild and shows it waiting", async () => {
    let owed: "waiting" | undefined
    let posted = 0
    server.use(
      http.get(`*/api/traks/${ID}`, () =>
        HttpResponse.json(
          detail({ ...SANDBOXED, ...(owed === undefined ? {} : { rebuild: owed }) }),
        ),
      ),
      http.post(`*/api/traks/${ID}/sandbox/rebuild`, () => {
        posted += 1
        owed = "waiting"
        return HttpResponse.json({ rebuild: "waiting" })
      }),
    )
    renderDetail()
    await loaded()

    fireEvent.click(screen.getByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Rebuild sandbox" }))
    expect(posted).toBe(0)
    expect(screen.getByText(/Uncommitted changes are carried across/)).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Rebuild" }))

    await waitFor(() => {
      expect(posted).toBe(1)
    })
    // The menu is back at its items, the Rebuild now saying what it waits on.
    expect(
      await screen.findByRole("menuitem", { name: "Rebuild waits for the running work to end" }),
    ).toBeDisabled()
  })

  it("keeps the confirmation open with the reason when the press does not land", async () => {
    let posted = 0
    server.use(
      answers(detail(SANDBOXED)),
      http.post(`*/api/traks/${ID}/sandbox/rebuild`, () => {
        posted += 1
        return new HttpResponse(null, { status: 404, statusText: "not in a sandbox" })
      }),
    )
    renderDetail()
    await loaded()

    fireEvent.click(screen.getByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Rebuild sandbox" }))
    fireEvent.click(screen.getByRole("button", { name: "Rebuild" }))

    expect(await screen.findByText("Could not rebuild the sandbox.")).toBeDefined()
    expect(posted).toBe(1)
    expect(screen.getByRole("button", { name: "Rebuild" })).toBeDefined()
    expect(screen.queryByRole("menuitem", { name: "Rebuild sandbox" })).toBeNull()
  })

  it("shows the engine's reason when it refuses over changes an earlier remake left", async () => {
    const SAID =
      "Changes an earlier remake left behind are still at refs/orkestra/carried/t1. Apply them or delete that ref first."
    server.use(
      answers(detail(SANDBOXED)),
      http.post(
        `*/api/traks/${ID}/sandbox/rebuild`,
        () => new HttpResponse(null, { status: 409, statusText: SAID }),
      ),
    )
    renderDetail()
    await loaded()

    fireEvent.click(screen.getByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Rebuild sandbox" }))
    fireEvent.click(screen.getByRole("button", { name: "Rebuild" }))
    expect(await screen.findByText(SAID)).toBeDefined()
  })

  it("is not offered on a trak whose checkout is on this machine", async () => {
    server.use(answers(detail({ worktree: makeWorktree() })))
    renderDetail()
    await loaded()

    fireEvent.click(screen.getByRole("button", { name: "More options" }))
    expect(screen.queryByRole("menuitem", { name: "Rebuild sandbox" })).toBeNull()
    expect(screen.getByRole("menuitem", { name: "Archive this trak" })).toBeDefined()
  })
})
