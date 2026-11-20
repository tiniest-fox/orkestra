// The pull request view's session made to mirror the default browser's GitHub login, and
// what the client is told about it.
//
// **The browser is the source of truth.** A copy replaces every `github.com` cookie the
// view holds with the browser's, so signing out there signs the view out too; a browser
// with no login empties the view. A read that failed — the keychain, a browser that is not
// Chromium — leaves the view as it is, so a password sign-in made in the panel survives it.
//
// Takes the session's cookies rather than reaching for them, so it is testable without
// Electron; `page-view.ts` hands over `session.cookies`, which is a `Jar`.

import type { CookiesSetDetails } from "electron"
import type { PageLogin } from "@orkestra/shared/page"
import type { BrowserLogin, GithubCookie } from "./browser-login.js"

const GITHUB = "https://github.com"
const HOSTS: ReadonlySet<string> = new Set(["github.com", ".github.com"])
const LOGIN_COOKIE = "user_session"

/** What a copy left the view with: the line the client draws, and whether its page is stale. */
export interface Mirrored {
  readonly state: PageLogin["state"]
  /** The view's login is not the one it had, so a page already loaded has to load again. */
  readonly changed: boolean
}

/** The three calls made on a session's `Cookies`. */
export interface Jar {
  readonly get: (filter: { readonly domain: string }) => Promise<
    readonly {
      readonly name: string
      readonly value: string
      readonly domain?: string
      readonly path?: string
    }[]
  >
  readonly remove: (url: string, name: string) => Promise<void>
  readonly set: (details: CookiesSetDetails) => Promise<void>
}

const setCookie = (cookies: Jar, cookie: GithubCookie): Promise<void> =>
  cookies.set({
    url: `${GITHUB}${cookie.path}`,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    // A host-only cookie names no domain: one that did would be shared with every
    // subdomain, and a `__Host-` cookie with a domain is refused outright.
    ...(cookie.host.startsWith(".") ? { domain: cookie.host } : {}),
    ...(cookie.expires === undefined ? {} : { expirationDate: cookie.expires }),
  })

/**
 * Bring the view's `github.com` cookies in line with what the browser `read`, and say
 * what the client should draw. `signed-out` and `browser-out` are the same read; the view
 * having held a login until now is what tells a browser that signed out from a first use.
 */
export const mirrorLogin = async (cookies: Jar, read: BrowserLogin): Promise<Mirrored> => {
  if (read.state === "keychain" || read.state === "not-chromium")
    return { state: read.state, changed: false }
  const held = (await cookies.get({ domain: "github.com" })).filter((cookie) =>
    HOSTS.has(cookie.domain ?? ""),
  )
  const before = held.find((cookie) => cookie.name === LOGIN_COOKIE)?.value
  await Promise.all(
    held.map((cookie) => cookies.remove(`${GITHUB}${cookie.path ?? "/"}`, cookie.name)),
  )
  if (read.state === "signed-out")
    return {
      state: before === undefined ? "signed-out" : "browser-out",
      changed: before !== undefined,
    }
  const now = Date.now() / 1000
  const live = read.cookies.filter((cookie) => cookie.expires === undefined || cookie.expires > now)
  await Promise.all(live.map((cookie) => setCookie(cookies, cookie)))
  const after = live.find((cookie) => cookie.name === LOGIN_COOKIE)?.value
  return { state: "copied", changed: before !== after }
}
