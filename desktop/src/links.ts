// Where a link pressed inside a window goes, decided before the shell acts on it.
//
// Every link the client draws carries `target="_blank"`, which is right in a browser tab
// and, left alone, makes Electron open a bare second window — no address bar, no back
// button, no menu, and nothing stopping the engine when it closes. So the shell answers
// each new-window request and each top-level navigation with a route: hand to the
// default browser, do nothing, or — for a navigation only — let it through.
//
// A new-window request never stays. Agent prose carries hrefs the client does not
// write — a bare relative path, a `./` path, a `#fragment` — and Chromium resolves each
// against the document before the shell sees it, so all three arrive on the engine's own
// origin. Loading one in this window would replace the trak a person is reading, with no
// address bar or Back item to return by; the browser has both, and `_blank` asked for
// somewhere else.
//
// *Internal* has one meaning: the exact origin of the page the window is showing —
// `http://127.0.0.1:<port>` for a project window. A general loopback test would keep
// another project's engine, and any local preview server, inside a window with no address
// bar. `localhost` and `127.0.0.1` are different origins, so a hand-typed `localhost`
// address for the same engine goes to the browser; that follows from the rule.
//
// Pure over the strings, so the decisions are testable without Electron; `main.ts` reads
// the page's URL and acts on the answer.

/**
 * The traks a page address in a project's view opens: none for any other screen, else the
 * one in the path under the engine's own address — so another origin never names one —
 * and the piece `?spot=` stands at, which the client reads inside its parent.
 *
 * A spot is a bare piece id, as the list links one, or a position key, which for a piece is
 * the piece's id, a colon, then its row. The id is what comes before the first colon. A
 * parent's own key — `step:2`, `end` — yields a word that is no trak's id, so the shell
 * holds nothing under it and closes nothing.
 */
export const traksOpened = (engineUrl: string, url: string): readonly string[] => {
  if (!url.startsWith(engineUrl) || !URL.canParse(url)) return []
  const page = /^traks\/([^/?#]+)/.exec(url.slice(engineUrl.length))?.[1]
  if (page === undefined) return []
  const piece = new URL(url).searchParams.get("spot")?.split(":")[0]
  return piece === undefined || piece === "" || piece === page ? [page] : [page, piece]
}

/** Open the default browser, or refuse the link outright. */
export type NewWindowRoute = "browser" | "refused"

/** A navigation may also stay: the window follows it as it would in a browser. */
export type NavigationRoute = NewWindowRoute | "stay"

/** The schemes the default browser is handed; anything else launches whatever application claims it. */
const BROWSER_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:", "mailto:"])

/**
 * `target` is arbitrary text — agent-written prose, a check's output — so a malformed
 * address and a scheme outside the allowlist are both refused rather than passed to
 * `shell.openExternal`, which would launch `vscode://` or `file://` in another program.
 */
export const newWindowRoute = (target: string): NewWindowRoute => {
  if (!URL.canParse(target)) return "refused"
  return BROWSER_SCHEMES.has(new URL(target).protocol) ? "browser" : "refused"
}

/**
 * A top-level navigation on the page's own origin is the window moving within the app,
 * and stays. A `mailto:` has no origin to compare, so it goes to the browser before the
 * check.
 */
export const navigationRoute = (pageUrl: string, target: string): NavigationRoute => {
  const route = newWindowRoute(target)
  if (route === "refused") return route
  const url = new URL(target)
  if (url.protocol === "mailto:") return "browser"
  return URL.canParse(pageUrl) && new URL(pageUrl).origin === url.origin ? "stay" : "browser"
}

/** The hosts a hosted process's page can be served from: the engine probes these two. */
const LOOPBACK: ReadonlySet<string> = new Set(["127.0.0.1", "[::1]", "localhost"])

/**
 * Whether a page asked the shell to show `target` in its native page view. The engine
 * hands the client a process's address as `http://127.0.0.1:<port>/` or
 * `http://[::1]:<port>/`, so anything else — another scheme, another host — is a page
 * asking for something no process serves, and the view stays hidden rather than becoming
 * a browser for it.
 */
export const hostedPageAllowed = (target: string): boolean => {
  if (!URL.canParse(target)) return false
  const url = new URL(target)
  return url.protocol === "http:" && LOOPBACK.has(url.hostname)
}

/** `/<owner>/<repo>/pull/<number>`, with or without a trailing slash. */
const PULL_PATH = /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/

/**
 * Whether a page asked the shell to show `target` in its pull request view. Only an
 * `https://github.com` pull request address: the client takes it from what the forge
 * reports, but the page renders agent-written prose and could send anything, so the host
 * is matched exactly — no other GitHub host, no port, no credentials — and the path has to
 * name a pull request. Once loaded, `pullRequestNavigationRoute` keeps the view on
 * `https://github.com`.
 */
export const pullRequestPageAllowed = (target: string): boolean => {
  if (!URL.canParse(target)) return false
  const url = new URL(target)
  return (
    url.protocol === "https:" &&
    url.host === "github.com" &&
    url.username === "" &&
    url.password === "" &&
    PULL_PATH.test(url.pathname)
  )
}

const GITHUB = "https://github.com"

/** The pages GitHub signs a person in on: the form, the failed-form page, and every step after it. */
const SIGN_IN_PATH = /^\/(?:login|session|sessions\/.+)\/?$/

/** Redirected off github.com from one of its sign-in pages: the press was Continue with Google, or another provider's. */
export type PullRequestRoute = NavigationRoute | "sign-in"

/**
 * Where a navigation or redirect inside the pull request view goes. `https://github.com`
 * stays, and anything else goes to the browser — except a redirect off github.com from a
 * sign-in page, which is `sign-in`. Google refuses to sign in an embedded browser, so that
 * sign-in is started again in the default browser, whose login the view then copies.
 * Not by handing it `target`: GitHub ties that address to a cookie in the view's session,
 * and the browser would fail the check on the way back.
 *
 * **Only a redirect.** Continue with Google reaches Google by one; a link clicked on the
 * sign-in page — Terms, Privacy, Support — is a navigation, and goes to its own target.
 *
 * `pageUrl` is the page the view is on now, not the address it was handed.
 */
export const pullRequestNavigationRoute = (
  pageUrl: string,
  target: string,
  how: "navigate" | "redirect",
): PullRequestRoute => {
  const route = navigationRoute(GITHUB, target)
  if (route !== "browser" || new URL(target).protocol !== "https:") return route
  if (how === "navigate" || !URL.canParse(pageUrl)) return route
  const page = new URL(pageUrl)
  return page.origin === GITHUB && SIGN_IN_PATH.test(page.pathname) ? "sign-in" : route
}

/** GitHub's sign-in form, set to land on `pull` once the person is signed in. */
export const browserSignInUrl = (pull: string): string => {
  const url = new URL("/login", GITHUB)
  url.searchParams.set("return_to", new URL(pull).pathname)
  return url.toString()
}
