import { describe, expect, it } from "vitest"
import {
  browserSignInUrl,
  hostedPageAllowed,
  navigationRoute,
  newWindowRoute,
  pullRequestNavigationRoute,
  pullRequestPageAllowed,
  traksOpened,
} from "./links.js"

const PAGE = "http://127.0.0.1:41337/traks/witty-jade-otter"

describe("where a new-window request goes", () => {
  it.each([
    ["github.com", "https://github.com/tiniest-fox/orkestra-ts/pull/71"],
    ["a mailto:", "mailto:someone@example.com"],
  ])("hands %s to the default browser", (_, href) => {
    expect(newWindowRoute(href)).toBe("browser")
  })

  it("refuses a file:// link", () => {
    expect(newWindowRoute("file:///etc/hosts")).toBe("refused")
  })

  it("refuses a scheme another application claims", () => {
    expect(newWindowRoute("vscode://file/Users/k/main.ts")).toBe("refused")
  })

  it("refuses a malformed address", () => {
    expect(newWindowRoute("http://")).toBe("refused")
    expect(newWindowRoute("not a url")).toBe("refused")
  })

  // The hrefs agent prose produces, as Chromium hands them over: resolved against the
  // page, so each is on the engine's own origin. None may replace the trak being read.
  const shapes: ReadonlyArray<{ href: string; resolved: string }> = [
    {
      href: "1-scope-and-approach.md",
      resolved: "http://127.0.0.1:41337/traks/1-scope-and-approach.md",
    },
    { href: "./notes/TODO.md", resolved: "http://127.0.0.1:41337/traks/notes/TODO.md" },
    {
      href: "#verification",
      resolved: "http://127.0.0.1:41337/traks/witty-jade-otter#verification",
    },
  ]
  for (const { href, resolved } of shapes)
    it(`sends \`${href}\`, resolved onto the engine's own origin, to the browser rather than this window`, () => {
      expect(new URL(href, PAGE).href).toBe(resolved)
      expect(newWindowRoute(resolved)).toBe("browser")
    })
})

describe("where a top-level navigation goes", () => {
  it("keeps a navigation on the engine's own origin in the window", () => {
    expect(navigationRoute(PAGE, "http://127.0.0.1:41337/traks")).toBe("stay")
  })

  it("hands github.com to the default browser", () => {
    expect(navigationRoute(PAGE, "https://github.com/tiniest-fox/orkestra-ts/pull/71")).toBe(
      "browser",
    )
  })

  it("treats another port on 127.0.0.1 as another origin, so it goes to the browser", () => {
    expect(navigationRoute(PAGE, "http://127.0.0.1:41338/")).toBe("browser")
  })

  it("treats localhost as a different origin from 127.0.0.1", () => {
    expect(navigationRoute(PAGE, "http://localhost:41337/")).toBe("browser")
  })

  it("hands a mailto: to the browser", () => {
    expect(navigationRoute(PAGE, "mailto:someone@example.com")).toBe("browser")
  })

  it("refuses a file:// link", () => {
    expect(navigationRoute(PAGE, "file:///etc/hosts")).toBe("refused")
  })

  it("refuses a malformed address", () => {
    expect(navigationRoute(PAGE, "not a url")).toBe("refused")
  })

  it("sends every http navigation off a file:// page to the browser, since a file page has no origin to match", () => {
    expect(
      navigationRoute("file:///Applications/Orkestra.app/launcher.html", "http://127.0.0.1:41337/"),
    ).toBe("browser")
  })
})

describe("what a hosted process's page view may show", () => {
  it("shows a process on either loopback address", () => {
    expect(hostedPageAllowed("http://127.0.0.1:47213/")).toBe(true)
    expect(hostedPageAllowed("http://[::1]:47213/")).toBe(true)
    expect(hostedPageAllowed("http://localhost:47213/cart")).toBe(true)
  })

  it("refuses another host, another scheme and a malformed address", () => {
    expect(hostedPageAllowed("http://example.com:47213/")).toBe(false)
    expect(hostedPageAllowed("https://127.0.0.1:47213/")).toBe(false)
    expect(hostedPageAllowed("file:///etc/hosts")).toBe(false)
    expect(hostedPageAllowed("not a url")).toBe(false)
  })
})

describe("where a navigation inside a hosted page goes", () => {
  const SHOWN = "http://[::1]:47213/"

  it("stays on the process's own origin", () => {
    expect(navigationRoute(SHOWN, "http://[::1]:47213/cart")).toBe("stay")
  })

  it("sends the other loopback address and another port to the browser", () => {
    expect(navigationRoute(SHOWN, "http://127.0.0.1:47213/cart")).toBe("browser")
    expect(navigationRoute(SHOWN, "http://[::1]:41337/traks/x")).toBe("browser")
  })
})

describe("what the pull request view may show", () => {
  it("shows a pull request on github.com", () => {
    expect(pullRequestPageAllowed("https://github.com/tiniest-fox/orkestra-ts/pull/121")).toBe(true)
    expect(pullRequestPageAllowed("https://github.com/tiniest-fox/orkestra-ts/pull/121/")).toBe(
      true,
    )
  })

  it("refuses another GitHub host, http:, a port and credentials", () => {
    expect(pullRequestPageAllowed("https://gist.github.com/a/b/pull/1")).toBe(false)
    expect(pullRequestPageAllowed("https://github.example.com/a/b/pull/1")).toBe(false)
    expect(pullRequestPageAllowed("https://github.com.evil.test/a/b/pull/1")).toBe(false)
    expect(pullRequestPageAllowed("http://github.com/a/b/pull/1")).toBe(false)
    expect(pullRequestPageAllowed("https://github.com:8443/a/b/pull/1")).toBe(false)
    expect(pullRequestPageAllowed("https://me:secret@github.com/a/b/pull/1")).toBe(false)
  })

  it("refuses a github.com address that is not a pull request, and a malformed one", () => {
    expect(pullRequestPageAllowed("https://github.com/tiniest-fox/orkestra-ts")).toBe(false)
    expect(pullRequestPageAllowed("https://github.com/a/b/pull/1/files")).toBe(false)
    expect(pullRequestPageAllowed("https://github.com/a/b/issues/1")).toBe(false)
    expect(pullRequestPageAllowed("not a url")).toBe(false)
  })
})

describe("where a navigation inside the pull request view goes", () => {
  const SHOWN = "https://github.com/tiniest-fox/orkestra-ts/pull/121"

  it("stays anywhere on https://github.com, the login page included", () => {
    expect(
      pullRequestNavigationRoute(
        SHOWN,
        "https://github.com/tiniest-fox/orkestra-ts/pull/121/files",
        "navigate",
      ),
    ).toBe("stay")
    expect(
      pullRequestNavigationRoute(SHOWN, "https://github.com/login?return_to=%2F", "navigate"),
    ).toBe("stay")
  })

  it("sends any other origin to the browser from a page that is not a sign-in", () => {
    expect(pullRequestNavigationRoute(SHOWN, "https://gist.github.com/x", "navigate")).toBe(
      "browser",
    )
    expect(pullRequestNavigationRoute(SHOWN, "https://docs.github.com/", "navigate")).toBe(
      "browser",
    )
    expect(pullRequestNavigationRoute(SHOWN, "http://github.com/", "navigate")).toBe("browser")
    expect(pullRequestNavigationRoute(SHOWN, "https://example.com/", "navigate")).toBe("browser")
    expect(pullRequestNavigationRoute(SHOWN, "https://accounts.google.com/", "navigate")).toBe(
      "browser",
    )
  })

  it("sends everything off github.com to the browser before the view has a page", () => {
    expect(pullRequestNavigationRoute("", "https://accounts.google.com/", "navigate")).toBe(
      "browser",
    )
  })

  it("refuses what it refuses everywhere, and sends a mailto: to the browser", () => {
    expect(pullRequestNavigationRoute(SHOWN, "file:///etc/hosts", "navigate")).toBe("refused")
    expect(pullRequestNavigationRoute(SHOWN, "mailto:someone@example.com", "navigate")).toBe(
      "browser",
    )
  })

  it("sends every new window to the browser, github.com included", () => {
    expect(newWindowRoute("https://github.com/tiniest-fox/orkestra-ts/pull/121/files")).toBe(
      "browser",
    )
  })
})

describe("where Continue with Google goes from the pull request view", () => {
  const GOOGLE = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x"
  const PULL = "https://github.com/tiniest-fox/orkestra-ts/pull/121"

  it("reads leaving a GitHub sign-in page as a sign-in to start in the browser", () => {
    for (const page of [
      "https://github.com/login?return_to=%2Ftiniest-fox%2Forkestra-ts%2Fpull%2F121",
      "https://github.com/session",
      "https://github.com/sessions/two-factor",
    ])
      expect(pullRequestNavigationRoute(page, GOOGLE, "redirect")).toBe("sign-in")
  })

  it("sends a link clicked on a sign-in page to its own target, not the sign-in form", () => {
    for (const link of ["https://docs.github.com/site-policy", "https://support.github.com/"])
      expect(pullRequestNavigationRoute("https://github.com/login", link, "navigate")).toBe(
        "browser",
      )
  })

  it("keeps a move within github.com from a sign-in page in the view", () => {
    expect(
      pullRequestNavigationRoute(
        "https://github.com/login",
        "https://github.com/sessions/social/google/initiate",
        "redirect",
      ),
    ).toBe("stay")
  })

  it("sends off-github moves from any other page, and plain http:, to the browser", () => {
    expect(pullRequestNavigationRoute(PULL, GOOGLE, "redirect")).toBe("browser")
    expect(pullRequestNavigationRoute("https://github.com/sessions-x", GOOGLE, "redirect")).toBe(
      "browser",
    )
    expect(pullRequestNavigationRoute(GOOGLE, "https://accounts.google.com/x", "redirect")).toBe(
      "browser",
    )
    expect(
      pullRequestNavigationRoute("https://github.com/login", "http://example.com/", "redirect"),
    ).toBe("browser")
  })

  it("starts the browser on GitHub's sign-in form, set to land on the pull request", () => {
    expect(browserSignInUrl(PULL)).toBe(
      "https://github.com/login?return_to=%2Ftiniest-fox%2Forkestra-ts%2Fpull%2F121",
    )
  })
})

describe("which traks a view's address opens", () => {
  const ENGINE = "http://127.0.0.1:41337/"
  const PIECE = "c1111111-2222-4333-8444-555555555555"

  it("reads the id off a trak's address", () => {
    expect(traksOpened(ENGINE, PAGE)).toEqual(["witty-jade-otter"])
  })

  it("stops the id at a query or a fragment", () => {
    expect(traksOpened(ENGINE, `${PAGE}?other=2`)).toEqual(["witty-jade-otter"])
    expect(traksOpened(ENGINE, `${PAGE}#top`)).toEqual(["witty-jade-otter"])
  })

  it("adds the piece a bare ?spot= names", () => {
    expect(traksOpened(ENGINE, `${PAGE}?spot=${PIECE}`)).toEqual(["witty-jade-otter", PIECE])
  })

  it("adds the piece a ?spot= position key stands in", () => {
    expect(traksOpened(ENGINE, `${PAGE}?spot=${PIECE}%3Astep%3A0`)).toEqual([
      "witty-jade-otter",
      PIECE,
    ])
  })

  it("adds nothing for a ?spot= on the parent's own step", () => {
    expect(traksOpened(ENGINE, `${PAGE}?spot=witty-jade-otter`)).toEqual(["witty-jade-otter"])
    expect(traksOpened(ENGINE, `${PAGE}?spot=`)).toEqual(["witty-jade-otter"])
  })

  it("names no trak for another screen", () => {
    expect(traksOpened(ENGINE, `${ENGINE}goals/g1?spot=${PIECE}`)).toEqual([])
    expect(traksOpened(ENGINE, ENGINE)).toEqual([])
  })

  it("names no trak on another origin", () => {
    expect(traksOpened(ENGINE, "http://127.0.0.1:9999/traks/witty-jade-otter")).toEqual([])
  })
})
