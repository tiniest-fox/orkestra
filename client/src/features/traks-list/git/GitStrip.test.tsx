/**
 * Tier 2: every popover the desk's git strip opens — the processes list, a CLI's usage, the
 * branch's card and the chevron's menu — shuts on a press outside it, and stays open on a
 * press inside it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { makeCliUsage, makeHostGit, makeHostedProcess } from "../../../fixtures"
import GitStrip from "./GitStrip"
import { gitView } from "./gitView"

afterEach(cleanup)

const Strip = () => (
  <GitStrip
    bar={{
      // Ahead of its upstream, so the action is Push and Fetch waits behind the chevron.
      view: gitView(
        makeHostGit({ upstream: { name: "origin/main", ahead: 2, behind: 0 } }),
        undefined,
        undefined,
        undefined,
        undefined,
      ),
      unread: false,
      press: () => undefined,
      fix: () => undefined,
      dismiss: () => undefined,
    }}
    processes={{
      processes: [makeHostedProcess()],
      presses: {
        press: () => undefined,
        starting: undefined,
        stopping: undefined,
        said: undefined,
      },
      origins: undefined,
    }}
    usage={[makeCliUsage()]}
    files={{ open: false, toggle: () => undefined }}
  />
)

const popovers: readonly (readonly [string, RegExp, string, "dialog" | "menu"])[] = [
  [
    "the processes list",
    /^Project checkout's processes:/,
    "Project checkout's processes",
    "dialog",
  ],
  ["a CLI's usage", /^Claude usage$/, "Claude usage", "dialog"],
  ["the branch's card", /^Project checkout: /, "Project checkout", "dialog"],
  ["the chevron's menu", /^More git actions$/, "", "menu"],
]

describe("GitStrip", () => {
  it.each(popovers)("shuts %s on a press outside it", (_, trigger, name, role) => {
    render(<Strip />)
    fireEvent.click(screen.getByRole("button", { name: trigger }))
    const opened = screen.getByRole(role, name === "" ? {} : { name })

    fireEvent.pointerDown(opened)
    expect(screen.queryByRole(role, name === "" ? {} : { name })).not.toBeNull()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole(role, name === "" ? {} : { name })).toBeNull()
  })
})
