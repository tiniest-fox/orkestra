// The native views a project draws pages in, laid over the client's side panel wherever
// the page says the pane is: one for a hosted process's page, and one for the trak's pull
// request on GitHub. Each project makes each on its first `show`.
//
// **A project's own page is itself a view on its window**, right of the rail, and several
// share one window. So what these views are keyed by is the project — its `PageHost` — and
// three things follow: a box the page measured from its own corner is moved by where the
// project's view sits, a project that is not the one selected has its views taken off
// screen by the shell (its page cannot know another tile was pressed), and they are put
// back above everything when it is selected again.
//
// **Native rather than an iframe, which is the person's choice and what it buys**: no page
// can refuse to be framed — GitHub sends `x-frame-options: deny` — and the view gets real
// devtools. What it costs is that it sits above every element of the window's page, so the
// client hides it whenever something of its own has to be drawn there — `page-preload.ts`
// is how it asks.
//
// **Two views rather than one, picked by the address.** One view loads fresh whenever its
// run changes, so a dev page and the pull request sharing it would each reload on every
// switch between their tabs. The bridge stays three messages: `show` names the address and
// the shell's own check of it is the routing, so `hide` and `reload` act on whichever view
// is showing.
//
// **A view handed a new run stays hidden until that run's page has loaded.** A view is reused
// across traks, so until then it holds the previous trak's page — for the pull request view,
// for as long as the login copy and GitHub take. The client draws a loading state under it.
//
// **The pull request view has a session of its own**, persisted, so the GitHub login
// survives a restart and its cookies never reach a loopback page an agent's code serves.
// The login in it is the default browser's, copied — `browser-login.ts` — each time the
// view is shown and each time the window comes back to the front, so a person who signs in
// over there finds the panel signed in on return. The client hears how each copy went.
//
// **Each has its own navigation guard, and the window's is left as it is.** `links.ts`
// keeps local preview servers out of a project window on purpose; these views exist to show
// one, or GitHub. So inside the process view a navigation stays only on the origin of the
// address the client handed it, and inside the pull request view only on github.com —
// anything else goes to the default browser, the way a link out of the window does.
// Continue with Google is sent there too, as GitHub's sign-in form, since Google refuses to
// sign in an embedded browser. No preload, sandboxed, no node: each view is a browser tab
// with no address bar, and nothing in it can reach the shell.

import { homedir } from "node:os"
import { app, ipcMain, session, shell, WebContentsView, type WebContents } from "electron"
import type { PageLogin } from "@orkestra/shared/page"
import { readBrowserLogin } from "./browser-login.js"
import { PAGE_CHANNELS } from "./bridge.js"
import {
  browserSignInUrl,
  hostedPageAllowed,
  navigationRoute,
  newWindowRoute,
  pullRequestNavigationRoute,
  pullRequestPageAllowed,
} from "./links.js"
import { placement } from "./page.js"
import { mirrorLogin } from "./panel-login.js"

/**
 * What the views need of the project they belong to, and nothing more — `main.ts` builds
 * one per started project, and the test hands over a stand-in.
 */
export interface PageHost {
  /** The window's content view, which the project's own view is a child of too. */
  readonly contentView: {
    /** Adding a view already there moves it above its siblings. */
    readonly addChildView: (view: WebContentsView) => void
    readonly removeChildView: (view: WebContentsView) => void
  }
  /** The project's own page — the one that sends the messages. */
  readonly webContents: {
    readonly getZoomFactor: () => number
    readonly on: (
      event: "did-start-navigation",
      listener: (details: {
        readonly isMainFrame: boolean
        readonly isSameDocument: boolean
      }) => void,
    ) => unknown
    readonly send: (channel: string, login: PageLogin) => void
  }
  /** The window coming to the front. */
  readonly on: (event: "focus", listener: () => void) => unknown
  /** The project leaving its window. */
  readonly once: (event: "closed", listener: () => void) => unknown
  /** Where the project's own view sits in its window, in points. */
  readonly origin: () => { readonly x: number; readonly y: number }
  /** Whether the project is off screen — not the one its window has selected. */
  readonly hidden: () => boolean
}

type Host = PageHost

/** Which of a window's two views an address belongs in. */
type Kind = "process" | "pull"

/** The session the pull request view keeps GitHub's login in — `persist:` writes it to disk. */
const GITHUB_SESSION = "persist:github"

/** The view an address is drawn in, or `undefined` for one neither may show. */
const kindOf = (url: string): Kind | undefined => {
  if (hostedPageAllowed(url)) return "process"
  if (pullRequestPageAllowed(url)) return "pull"
  return undefined
}

interface Held {
  readonly view: WebContentsView
  /** The run the view last loaded — a different one is loaded fresh, at whatever address. */
  run: string | undefined
  /** The address it was loaded at — what a navigation inside may stay on, and where a sign-in returns to. */
  loaded: string | undefined
  /**
   * The run whose page is still on its way, or `undefined` once it has landed. The view is
   * held hidden meanwhile: it still holds the previous run's page, which is another trak's.
   */
  arriving: string | undefined
  /** Whether the client last asked for the view on screen — what a page that lands is shown to. */
  wanted: boolean
}

/** One window's views, each made on the first `show` that names it. */
interface Views {
  readonly made: Map<Kind, Held>
  /** The view last shown — the one `reload` acts on. */
  shown: Kind | undefined
  /**
   * The view to put back when the project is selected again: the one that was showing
   * when it went off screen, or the one its page has asked for since.
   */
  back: Kind | undefined
  /** The copy of the browser's login under way, which a second ask joins rather than repeats. */
  copying: Promise<boolean> | undefined
  /** What the window was last told about the login. */
  login: PageLogin["state"] | undefined
  /**
   * A sign-in is under way in the browser: until this time, a copy that finds no login
   * says `waiting` and copies again rather than reporting it. `undefined` when none is.
   */
  pendingUntil: number | undefined
  /** The next of those copies, while one is due. */
  retry: ReturnType<typeof setTimeout> | undefined
}

/**
 * How long a pending sign-in is waited for, and how often the browser's store is read
 * meanwhile. Chromium writes a new cookie to disk only on its next commit, up to thirty
 * seconds after the sign-in, so a person who comes straight back finds the store without
 * it; a single copy on return would report them signed out.
 */
const PENDING_MS = 60_000
const RETRY_MS = 5000

/** Each project window's views, gone with the window. */
const held = new Map<Host, Views>()

/** Where a copy that failed outright is told — `main.ts`'s log, handed to `installPageView`. */
let report: (message: string) => void = () => undefined

/** Acts on a route out of the view: only `browser` does anything. */
const toBrowser = (route: string, url: string): void => {
  if (route === "browser") void shell.openExternal(url)
}

const guard = (entry: Held): void => {
  const contents = entry.view.webContents
  contents.setWindowOpenHandler(({ url }) => {
    toBrowser(newWindowRoute(url), url)
    return { action: "deny" }
  })
  contents.on("will-navigate", (event, url) => {
    const route = entry.loaded === undefined ? "refused" : navigationRoute(entry.loaded, url)
    if (route === "stay") return
    event.preventDefault()
    toBrowser(route, url)
  })
}

/**
 * The pull request view's guard. Redirects are held to the rule as well as navigations:
 * Continue with Google reaches Google by a redirect, and that is the move `sign-in` names.
 */
const guardGithub = (contents: WebContents, signIn: () => void): void => {
  contents.setWindowOpenHandler(({ url }) => {
    toBrowser(newWindowRoute(url), url)
    return { action: "deny" }
  })
  const route = (
    event: { readonly preventDefault: () => void },
    url: string,
    how: "navigate" | "redirect",
  ): void => {
    const where = pullRequestNavigationRoute(contents.getURL(), url, how)
    if (where === "stay") return
    event.preventDefault()
    if (where === "sign-in") signIn()
    else toBrowser(where, url)
  }
  contents.on("will-navigate", (event, url) => route(event, url, "navigate"))
  contents.on("will-redirect", (event) => {
    if (event.isMainFrame) route(event, event.url, "redirect")
  })
}

const hide = (entry: Held): void => {
  entry.wanted = false
  entry.view.setVisible(false)
}

const hideAll = (views: Views): void => {
  views.back = undefined
  for (const entry of views.made.values()) hide(entry)
}

const viewsFor = (window: Host): Views => {
  const found = held.get(window)
  if (found !== undefined) return found
  const views: Views = {
    made: new Map(),
    shown: undefined,
    back: undefined,
    copying: undefined,
    login: undefined,
    pendingUntil: undefined,
    retry: undefined,
  }
  held.set(window, views)
  // Coming back from the browser is when a sign-in made there arrives, so the wait for it
  // runs from here — from the signed-out bands as much as from `waiting`, since a person may
  // sign in without pressing anything.
  // Not after `keychain`: macOS's prompt takes focus and gives it back, so a copy here would
  // ask again the moment the person answered. Try again, or the next open, copies then.
  window.on("focus", () => {
    if (views.made.get("pull")?.view.getVisible() !== true || views.login === "keychain") return
    if (views.login === "waiting" || views.login === "signed-out" || views.login === "browser-out")
      pend(views)
    void refreshLogin(window, views)
  })
  // The page reloading or leaving the trak takes its pane with it, and nothing on the
  // fresh page knows a view is there to hide — so the shell hides them the moment the
  // window's own page starts to go. The new page shows one again if it draws a pane.
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) hideAll(views)
  })
  window.once("closed", () => {
    // A copy still in flight settles after this; with no wait left it schedules nothing.
    views.pendingUntil = undefined
    clearTimeout(views.retry)
    held.delete(window)
    for (const entry of views.made.values()) {
      window.contentView.removeChildView(entry.view)
      entry.view.webContents.close()
    }
  })
  return views
}

const viewFor = (window: Host, views: Views, kind: Kind): Held => {
  const found = views.made.get(kind)
  if (found !== undefined) return found
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(kind === "pull" ? { partition: GITHUB_SESSION } : {}),
    },
  })
  view.setVisible(false)
  window.contentView.addChildView(view)
  const entry: Held = {
    view,
    run: undefined,
    loaded: undefined,
    arriving: undefined,
    wanted: false,
  }
  if (kind === "pull") guardGithub(view.webContents, () => signIn(window, entry))
  else guard(entry)
  views.made.set(kind, entry)
  return entry
}

/**
 * Copy the default browser's GitHub login into the pull request view, tell the window how
 * it went, and answer whether the view's login changed. A read that throws is a store this
 * code cannot read; it is reported here and the view is left as it was.
 */
const copyLogin = (window: Host, views: Views): Promise<boolean> => {
  views.copying ??= (async () => {
    const browser = app.getApplicationNameForProtocol("https://")
    try {
      const read = await readBrowserLogin(browser, homedir())
      const mirrored = await mirrorLogin(session.fromPartition(GITHUB_SESSION).cookies, read)
      // The window may have closed while the copy ran, and its contents with it.
      if (held.get(window) === views)
        tell(window, views, { state: settle(window, views, mirrored.state), browser })
      return mirrored.changed
    } catch (error) {
      report(`could not copy ${browser}'s GitHub login: ${String(error)}`)
      return false
    }
  })().finally(() => {
    views.copying = undefined
  })
  return views.copying
}

/** Start, or extend, the wait for a sign-in in the browser. */
const pend = (views: Views): void => {
  views.pendingUntil = Date.now() + PENDING_MS
}

const tell = (window: Host, views: Views, login: PageLogin): void => {
  views.login = login.state
  window.webContents.send(PAGE_CHANNELS.login, login)
}

/**
 * What a copy that read `state` tells the window. A copy that finds no login while a
 * sign-in is pending says `waiting` and schedules the next; anything else, or the wait
 * running out, ends the sign-in and is said as it is.
 */
const settle = (window: Host, views: Views, state: PageLogin["state"]): PageLogin["state"] => {
  clearTimeout(views.retry)
  views.retry = undefined
  const signedOut = state === "signed-out" || state === "browser-out"
  if (!signedOut || views.pendingUntil === undefined || Date.now() >= views.pendingUntil) {
    views.pendingUntil = undefined
    return state
  }
  views.retry = setTimeout(() => {
    views.retry = undefined
    void refreshLogin(window, views)
  }, RETRY_MS)
  return "waiting"
}

/** Copy again, and load the page the view already shows afresh if the login moved under it. */
const refreshLogin = async (window: Host, views: Views): Promise<void> => {
  if (await copyLogin(window, views)) views.made.get("pull")?.view.webContents.reload()
}

/**
 * Start a sign-in in the default browser, on GitHub's form, set to land on the pull request
 * the view was handed; the window draws `waiting` until a copy finds the login or the wait
 * for it runs out.
 */
const signIn = (window: Host, entry: Held): void => {
  const views = held.get(window)
  if (entry.loaded === undefined || views === undefined) return
  void shell.openExternal(browserSignInUrl(entry.loaded))
  pend(views)
  tell(window, views, { state: "waiting", browser: app.getApplicationNameForProtocol("https://") })
}

/**
 * Answer the page messages for every project `owns` recognises. Registered once, as
 * the launch window's handlers are: `ipcMain.on` is per channel, not per window.
 *
 * `owns` is the main process's own answer to *is this a project's page*, so a message
 * from anything else is dropped — the launch window and the rail have no such bridge, but
 * a check costs nothing. Every argument is checked again here, since a page can send anything.
 */
export const installPageView = (
  owns: (sender: WebContents) => Host | undefined,
  warn: (message: string) => void,
) => {
  report = warn
  ipcMain.on(PAGE_CHANNELS.show, (event, run: unknown, url: unknown, bounds: unknown) => {
    const window = owns(event.sender)
    if (window === undefined || typeof run !== "string" || typeof url !== "string") return
    const kind = kindOf(url)
    if (kind === undefined) return
    const box = placement(bounds, window.webContents.getZoomFactor())
    if (box === undefined) return
    const views = viewsFor(window)
    const entry = viewFor(window, views, kind)
    const opening = !entry.view.getVisible()
    // Keyed on the run, never the address: a restart is usually handed the port the stopped
    // run had, and comparing addresses kept that run's page on screen — `PageBridge.show`.
    if (entry.run !== run) {
      entry.run = run
      entry.loaded = url
      entry.arriving = run
      void (async () => {
        // A pull request loads after the copy, so its first page is already signed in.
        if (kind === "pull") await copyLogin(window, views)
        // A load that fails still drew Chromium's error page, which is this run's to show;
        // one another run replaced is caught by the check below.
        if (entry.run === run) await entry.view.webContents.loadURL(url).catch(() => undefined)
        if (entry.arriving !== run) return
        entry.arriving = undefined
        if (entry.wanted) entry.view.setVisible(true)
      })()
    } else if (kind === "pull" && opening && entry.arriving === undefined)
      void refreshLogin(window, views)
    // One pane, so one view: the other is hidden, and keeps its page for when it is back.
    for (const [other, it] of views.made) if (other !== kind) hide(it)
    views.shown = kind
    // The page measured from its own corner, and it starts right of the rail.
    const at = window.origin()
    entry.view.setBounds({ ...box, x: box.x + at.x, y: box.y + at.y })
    // A project off screen keeps its page running, and that page may ask for a view —
    // a process restarted, a pull request arrived. It is drawn when the project is back.
    if (window.hidden()) views.back = kind
    else {
      entry.wanted = true
      // Until its page lands, the client's own loading state under the view is what is seen.
      entry.view.setVisible(entry.arriving === undefined)
    }
  })
  ipcMain.on(PAGE_CHANNELS.hide, (event) => {
    const window = owns(event.sender)
    const views = window === undefined ? undefined : held.get(window)
    if (views !== undefined) hideAll(views)
  })
  ipcMain.on(PAGE_CHANNELS.reload, (event) => {
    const window = owns(event.sender)
    const views = window === undefined ? undefined : held.get(window)
    if (views?.shown !== undefined) views.made.get(views.shown)?.view.webContents.reload()
  })
  ipcMain.on(PAGE_CHANNELS.copyLogin, (event) => {
    const window = owns(event.sender)
    const views = window === undefined ? undefined : held.get(window)
    if (window !== undefined && views?.made.has("pull") === true) void refreshLogin(window, views)
  })
  ipcMain.on(PAGE_CHANNELS.signIn, (event) => {
    const window = owns(event.sender)
    const entry = window === undefined ? undefined : held.get(window)?.made.get("pull")
    if (window !== undefined && entry !== undefined) signIn(window, entry)
  })
}

/**
 * Take a project's views off screen because another tile was selected. Its page is not
 * told and sends no `hide`, so without this the views would stay drawn over the project
 * that is selected instead.
 */
export const suspendPages = (host: PageHost): void => {
  const views = held.get(host)
  if (views === undefined) return
  const showing = [...views.made].find(([, entry]) => entry.wanted)?.[0]
  hideAll(views)
  views.back = showing
}

/**
 * Put a project's views back as it is selected again: above the project's own view,
 * which `main.ts` has just raised, and showing the one that was when it left. Where the
 * pane is now is the page's to say — it sends `show` again when its box has moved.
 */
export const resumePages = (host: PageHost): void => {
  const views = held.get(host)
  if (views === undefined) return
  for (const entry of views.made.values()) host.contentView.addChildView(entry.view)
  const back = views.back === undefined ? undefined : views.made.get(views.back)
  views.back = undefined
  if (back === undefined) return
  back.wanted = true
  // A page still arriving is shown by its load landing, not before.
  if (back.arriving === undefined) back.view.setVisible(true)
  if (views.shown === "pull") void refreshLogin(host, views)
}
