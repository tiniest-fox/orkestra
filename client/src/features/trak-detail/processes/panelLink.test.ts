import { describe, expect, it } from "vitest"
import { makeHostedProcess } from "../../../fixtures"
import { panelLink } from "./panelLink"

const DEV = makeHostedProcess({
  name: "dev",
  run: 3,
  state: { _tag: "Running", port: 5173, startedAt: 1, readyAt: 2, url: "http://[::1]:5173/" },
})
const API = makeHostedProcess({
  name: "api",
  state: { _tag: "Stopped", port: 8080, startedAt: 1, at: 2 },
})
const PULL = "https://github.com/o/r/pull/41"

describe("which panel item a link names", () => {
  it("names a running process on any loopback, at the link's path on the process's own host", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"])
      expect(
        panelLink(`http://${host}:5173/a?b#c`, [API, DEV], undefined, undefined),
      ).toStrictEqual({
        kind: "process",
        name: "dev",
        page: { run: 3, url: "http://[::1]:5173/a?b#c" },
      })
  })

  it("names a process that is not up, with no page to hold", () => {
    expect(panelLink("http://localhost:8080/x", [DEV, API], undefined, undefined)).toStrictEqual({
      kind: "process",
      name: "api",
      page: undefined,
    })
  })

  it("names nothing for another port, another host, https, or no address at all", () => {
    expect(panelLink("http://localhost:4000/", [DEV], undefined, undefined)).toBeUndefined()
    expect(panelLink("http://example.com:5173/", [DEV], undefined, undefined)).toBeUndefined()
    expect(panelLink("https://localhost:5173/", [DEV], undefined, undefined)).toBeUndefined()
    expect(panelLink("guide/plan.md", [DEV], undefined, undefined)).toBeUndefined()
    // A process that never started holds no port to match.
    expect(
      panelLink("http://localhost:80/", [makeHostedProcess()], undefined, undefined),
    ).toBeUndefined()
  })

  it("names the pull request at its own root, a trailing slash, query or fragment aside", () => {
    for (const href of [PULL, `${PULL}/`, `${PULL}?w=1`, `${PULL}#issuecomment-1`])
      expect(panelLink(href, [DEV], PULL, undefined)).toStrictEqual({ kind: "pull" })
  })

  it("names nothing for another pull request, a subpage, or where the panel offers none", () => {
    expect(panelLink("https://github.com/o/r/pull/42", [DEV], PULL, undefined)).toBeUndefined()
    expect(panelLink(`${PULL}/files`, [DEV], PULL, undefined)).toBeUndefined()
    expect(panelLink(PULL, [DEV], undefined, undefined)).toBeUndefined()
  })
})

/** Where each process is served behind a page domain: `dev` has a hostname, `api` none. */
const origins = (name: string): string | undefined =>
  name === "dev" ? "https://dev--t--p.example.com" : undefined

describe("a link behind a page domain", () => {
  it("names a process at its own hostname, held at its loopback address", () => {
    expect(
      panelLink("https://dev--t--p.example.com/a?b#c", [API, DEV], undefined, origins),
    ).toStrictEqual({
      kind: "process",
      name: "dev",
      page: { run: 3, url: "http://[::1]:5173/a?b#c" },
    })
  })

  it("still names one by loopback and port, and nothing at another hostname", () => {
    expect(panelLink("http://localhost:5173/", [DEV], undefined, origins)).toMatchObject({
      name: "dev",
    })
    expect(panelLink("https://web--t--p.example.com/", [DEV], undefined, origins)).toBeUndefined()
    expect(panelLink("http://dev--t--p.example.com/", [DEV], undefined, origins)).toBeUndefined()
  })
})
