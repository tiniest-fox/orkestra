// The Electron main process: a dock icon, a launch window listing the recent projects,
// a folder picker, and windows that each hold a rail of projects — one engine per project,
// started when its tile is first selected, with a notification when a trak on it parks,
// finishes or fails. Everything it does is process management, windows, that banner,
// where a pressed link goes, and the native views laid over a window's page.
//
// **A window's own page is the rail, loaded off disk** — the client's `rail.html`, built
// beside the engine, talking to this process over `rail-preload.ts`. Each started project
// is the engine's own client, loaded as-is over loopback in a view right of the rail, and
// the view stays alive while another tile is selected: a switch reloads nothing, so each
// project keeps its place. A hosted process's page and a pull request are further views
// over that one (`page-view.ts`). The launch window is the other page loaded off disk.
//
// **Only the engines this app started are its to stop.** One found already serving a
// project is attached and left alone. Removing a project from its window stops its
// engine, closing a window stops every engine on its rail, and quitting stops every one —
// each asks first when a trak reports `running`, since stopping mid-turn kills a `claude`
// that has been paid for.
//
// **Which windows are open, and what is on each rail, is `windows.json`**, rewritten on
// every change. Closing a window takes it out of the file; quitting leaves the file as it
// stands, so the next launch puts every window back and starts only the project each one
// had selected.

import { existsSync, statSync } from "node:fs"
import { stat } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  Notification,
  shell,
  type WebContents,
  WebContentsView,
} from "electron"
import type { RailStateDto } from "@orkestra/shared/rail"
import { projectDir } from "../../src/app/discovery.js"
import { CHANNELS, RAIL_CHANNELS } from "./bridge.js"
import {
  type Engine,
  nodeLaunch,
  reloadEngine,
  running,
  startEngine,
  stopEngine,
  stopQuestion,
} from "../../src/supervisor/engine.js"
import { findIcon } from "../../src/supervisor/icon-file.js"
import type { Notice } from "../../src/supervisor/notice.js"
import { watchEngine } from "../../src/supervisor/watch.js"
import { navigationRoute, type NewWindowRoute, newWindowRoute, traksOpened } from "./links.js"
import { loginShellPath } from "./login-path.js"
import { type Placement, placement } from "./page.js"
import { installPageView, type PageHost, resumePages, suspendPages } from "./page-view.js"
import { type EntryKind, projectRefusal } from "./project.js"
import { failureOf, railProject, type Tile } from "./rail.js"
import { bumped, rowsOf, without } from "./recents.js"
import { readRecents, writeRecents } from "./recents-file.js"
import { afterRemoval, routeOpen, type SavedWindow } from "./windows.js"
import { readWindows, writeWindows } from "./windows-file.js"

// `~/Library/Application Support/Orkestra/` — set explicitly rather than derived from
// the package name, so the dev run and the packaged app read the same recents. The
// engine spells the same directory out without Electron for its opener picks
// (`src/app/openers.ts`); a change here has to keep the two agreeing.
app.setName("Orkestra")
app.setPath("userData", join(app.getPath("appData"), "Orkestra"))
const RECENTS_FILE = join(app.getPath("userData"), "recents.json")
const WINDOWS_FILE = join(app.getPath("userData"), "windows.json")
const HOME = app.getPath("home")

/** The rail's width in the page's own pixels — where the pane starts before the page has said. */
const RAIL_WIDTH = 48

/** One window: a rail of projects, and the pane right of it. */
interface Win {
  readonly window: BrowserWindow
  /** Project roots, top of the rail first. */
  projects: readonly string[]
  selected: string | undefined
  /** Where the pane is in the window, in points — the selected project's view fills it. */
  pane: Placement
  /** A close has been asked for and is past its question, or still asking it. */
  closing: boolean
}

/** One project on a window's rail. The first five fields are what the rail is told. */
interface Project extends Tile {
  state: Tile["state"]
  failure: Tile["failure"]
  icon: Tile["icon"]
  traks: Tile["traks"]
  /** The window whose rail holds it. A project sits in one window only. */
  readonly home: Win
  /** Present once the engine has answered; an attached one has no `child`. */
  engine: Engine | undefined
  /** The engine's own client, right of the rail. Kept while another tile is selected. */
  view: WebContentsView | undefined
  /** What `page-view.ts` knows the project by, for as long as it has a view. */
  host: PageHost | undefined
  /** Whether `view` is on screen: the project is the one its window has selected. */
  visible: boolean
  /** Ends the stream subscription behind the notifications and the tile's list. */
  unwatch: (() => void) | undefined
  /** What `page-view.ts` asked to hear when the project leaves its window. */
  readonly leaving: (() => void)[]
  /**
   * The notifications shown for each trak, keyed by its id, until the trak is opened.
   * Holding them is also what keeps one from being collected before it can be closed.
   */
  readonly notices: Map<string, Notification[]>
}

/**
 * The windows that are up, in the order they were last focused: a focus moves a window
 * to the end, so the last one is where a project opened from the menu or the dock goes.
 */
const windows = new Set<Win>()
/** The projects on any rail, keyed by root. */
const projects = new Map<string, Project>()
/**
 * The projects whose engine is being started, keyed by root. Claimed before `start`'s
 * first `await`: a second press on a tile still booting would otherwise attach to the
 * engine the first is starting and overwrite the record of it, leaving that engine
 * reachable from nothing and running past quit.
 */
const opening = new Map<string, Promise<void>>()
/**
 * The projects whose engine is being stopped, keyed by root. Entered before the project
 * leaves `projects` and removed once `stopEngine` has returned, so an engine in its grace
 * is always in some set: a quit reads this alongside `opening`, so the SIGKILL escalation
 * finishes before the app exits, and `start` waits on it, so a project added back starts
 * a fresh engine rather than attaching to one that is on its way out.
 */
const stopping = new Map<string, Promise<void>>()
/** Opens asked for and not yet routed to a window — they wait on `initialised`. */
let asked = 0
let recents: readonly string[] = []
/** The launch window, while it is up. One at most: a second press shows the first. */
let launcher: BrowserWindow | undefined
let quitting = false

/**
 * The `PATH` the engine for `root` is started with: the login shell's, read inside `root`
 * itself. A per-repository version manager only puts the toolchain on `PATH` there, so
 * the answer is per project and this is the last moment it can be asked for — see
 * `login-path.ts`.
 *
 * A shell that did not answer falls back to this process's own `PATH`, which from the app
 * is Finder's four directories. That is the one moment the person can learn why nothing
 * will be found, so it is said here rather than swallowed.
 */
const pathFor = async (root: string): Promise<string> => {
  const fromShell = await loginShellPath(root)
  if (fromShell !== undefined) return fromShell
  const fallback = process.env["PATH"] ?? ""
  if (app.isPackaged) {
    dialog.showErrorBox(
      "The login shell did not answer",
      `Orkestra could not read your shell's PATH in ${root}, so its engine gets ${fallback}. ` +
        "claude, git and gh will not be found until the project is opened again with a shell that answers.",
    )
  } else {
    console.error(`login shell did not report a PATH in ${root}; its engine gets: ${fallback}`)
  }
  return fallback
}

const kindOf = (path: string): EntryKind => {
  try {
    return statSync(path).isDirectory() ? "directory" : "file"
  } catch {
    return "missing"
  }
}

/**
 * The recents the launch window draws: those whose folder can be reached right now.
 *
 * **A filter over what is drawn, never over `recents`.** A `stat` that fails cannot tell
 * *deleted* from *could not look* — a project on a drive that is unplugged fails the
 * same way as one that was rm'd — so a folder that cannot be reached is left out of the
 * window and left in the file. What removes an entry from `recents.json` is a press the
 * shell refused and explained; nothing silent does. The `stat`s are asynchronous so a
 * mount that hangs delays the list and does not block this process; no engine is asked
 * anything while the list draws.
 */
const reachable = async (): Promise<readonly string[]> => {
  // One snapshot, stat'd and filtered: `recents` can be reassigned during the stats —
  // an open, a refusal, Clear Menu — and `present` is indexed against the list checked.
  const checked = recents
  const present = await Promise.all(
    checked.map((root) =>
      stat(root).then(
        (s) => s.isDirectory(),
        () => false,
      ),
    ),
  )
  return checked.filter((_, i) => present[i] === true)
}

/**
 * Put `window` in front. `focus()` does nothing to a window macOS reports as not
 * visible, and a minimized one is exactly that; `show()` does not deminiaturize either.
 * `restore()` is the way back from the dock, so it goes first at every site that means
 * to bring a window forward.
 */
const bringForward = (window: BrowserWindow): void => {
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/**
 * Close the launch window once `window` is genuinely on screen: now if it is, otherwise
 * when it next shows or comes back from the dock. Never before — a launcher that closes
 * over a window still minimized leaves nothing on screen, and the dock icon does not
 * help, since `activate` shows the launcher only when no project is open.
 */
const closeLauncherBehind = (window: BrowserWindow): void => {
  const up = (): boolean => window.isVisible() && !window.isMinimized()
  if (up()) {
    launcher?.close()
    return
  }
  const once = (): void => {
    if (!up()) return
    window.off("show", once)
    window.off("restore", once)
    launcher?.close()
  }
  window.on("show", once)
  window.on("restore", once)
}

/** The rows every page that lists the recent projects draws: the launch window while it
 *  is up, and each window's rail page, whose empty pane lists them. Told rather than
 *  asked, so a row that stopped opening leaves the page without it polling. */
const pushRecents = async (): Promise<void> => {
  const rows = rowsOf(await reachable(), HOME)
  if (launcher !== undefined && !launcher.isDestroyed()) {
    launcher.webContents.send(CHANNELS.recentsChanged, rows)
  }
  for (const win of windows) {
    if (!win.window.isDestroyed()) win.window.webContents.send(CHANNELS.recentsChanged, rows)
  }
}

/** Every surface that draws the list, after it changed: the menu, and the launch window. */
const recentsChanged = (): void => {
  buildMenu()
  void pushRecents()
}

const rememberOpened = async (root: string): Promise<void> => {
  recents = bumped(recents, root)
  app.addRecentDocument(root)
  await writeRecents(RECENTS_FILE, recents)
  recentsChanged()
}

const forget = async (root: string): Promise<void> => {
  recents = without(recents, root)
  await writeRecents(RECENTS_FILE, recents)
  recentsChanged()
}

/**
 * Ask before killing a turn. `true` means go ahead.
 *
 * Only an engine that answered and reported nothing running is stopped without the
 * question. One that could not be asked gets it too, worded for that case: the turn it
 * may be in the middle of is the thing the question protects.
 */
const confirmStop = async (engines: readonly Engine[], what: string): Promise<boolean> => {
  const question = stopQuestion(await Promise.all(engines.map(running)))
  if (question === "none") return true
  const sure = question === "running"
  const { response } = await dialog.showMessageBox({
    type: "warning",
    buttons: [what, "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: sure ? "A trak is running." : "An engine did not answer.",
    detail: sure
      ? `${what} stops the engine, which kills the agent turn in flight. The trak can be resumed later, but the work of this turn is lost.`
      : `It could not say whether a trak is running. ${what} stops it anyway, and kills any agent turn it is in the middle of.`,
  })
  return response === 0
}

/**
 * Have the project's engine read `.orkestra/` again. Nothing running is interrupted, so
 * nothing is asked first; a failure is shown, and the files loaded before go on serving.
 */
const reloadFiles = async (project: Project): Promise<void> => {
  const { engine } = project
  if (engine === undefined) return
  const failed = await reloadEngine(engine)
  if (failed === undefined) return
  await dialog.showMessageBox({
    type: "warning",
    message: `${basename(project.root)}: the project files did not reload.`,
    detail: `${failed}\n\nThe files loaded before are still in use.`,
  })
}

/**
 * A notification centre entry for a trak that parked, finished or failed on `project`.
 * Titled with the project, since several are open and macOS already names the app; a
 * click brings its window up on its tile, and that tile's view on the trak.
 */
const notify = (project: Project, notice: Notice): void => {
  const shown = new Notification({ title: basename(project.root), body: notice.body })
  shown.on("click", () => {
    clearNotices(project, notice.trak)
    const { engine, view, home } = project
    if (projects.get(project.root) !== project || engine === undefined) return
    bringForward(home.window)
    select(home, project.root)
    void view?.webContents.loadURL(`${engine.url}traks/${notice.trak}`)
  })
  project.notices.set(notice.trak, [...(project.notices.get(notice.trak) ?? []), shown])
  shown.show()
}

/** Close what is still shown for a trak the person has opened, and stop holding it. */
const clearNotices = (project: Project, trak: string): void => {
  for (const shown of project.notices.get(trak) ?? []) shown.close()
  project.notices.delete(trak)
}

/** Acts on a route: only `browser` does anything, and a refused link does nothing. */
const send = (route: NewWindowRoute, url: string): void => {
  if (route === "browser") void shell.openExternal(url)
}

/**
 * A link that leaves the page goes to the default browser, where a person is signed in
 * and has a back button, rather than to a second window with none of that. Installed
 * before the page loads, or the first navigation is unguarded. `deny` on its own makes
 * a press do nothing, which is also what a refused scheme looks like — the browser is
 * opened inside the handler. A new-window request on the app's own origin goes to the
 * browser too, never to this window: it would replace the trak being read, and there
 * is no Back to return by.
 */
const guardLinks = (contents: WebContents): void => {
  contents.setWindowOpenHandler(({ url }) => {
    send(newWindowRoute(url), url)
    return { action: "deny" }
  })
  contents.on("will-navigate", (event, url) => {
    const route = navigationRoute(contents.getURL(), url)
    if (route === "stay") return
    event.preventDefault()
    send(route, url)
  })
}

/* -------------------------------------------------------------------------- */
/* What a window's rail is told, and what is saved.                           */
/* -------------------------------------------------------------------------- */

const savedOf = (win: Win): SavedWindow => ({ projects: win.projects, selected: win.selected })

const stateOf = (win: Win): RailStateDto => ({
  projects: win.projects.flatMap((root) => {
    const project = projects.get(root)
    return project === undefined ? [] : [railProject(project, HOME)]
  }),
  ...(win.selected === undefined ? {} : { selected: win.selected }),
})

/** The rail page's next state, whole. Told rather than asked, as the recents are. */
const pushState = (win: Win): void => {
  if (!win.window.isDestroyed()) {
    win.window.webContents.send(RAIL_CHANNELS.stateChanged, stateOf(win))
  }
}

/** Writes in the order they were asked for: two overlapping writes could land reversed. */
let saving: Promise<void> = Promise.resolve()

/**
 * Write the windows that are up to `windows.json`. **Never once the quit is past its
 * question**: from there every window is on its way down, and the file has to keep
 * saying what was open so the next launch puts it back.
 */
const save = (): void => {
  if (quitting) return
  const snapshot = [...windows].map(savedOf)
  saving = saving
    .then(() => writeWindows(WINDOWS_FILE, snapshot))
    .catch((e: unknown) => console.error(`could not write ${WINDOWS_FILE}: ${String(e)}`))
}

/* -------------------------------------------------------------------------- */
/* A window's pane: which project's view is on it.                            */
/* -------------------------------------------------------------------------- */

/**
 * Put the selected project's view on the pane and take every other off it.
 *
 * **The selected view is added again, not only shown.** Child views stack in the order
 * they were added, so a project started after another's hosted page was drawn would sit
 * above that page for good; adding one already there moves it to the top, and
 * `resumePages` then puts its own pages back above it. A project with no view — off,
 * starting, failed, refused — leaves the pane to the rail page, which draws it.
 */
const layout = (win: Win): void => {
  if (win.window.isDestroyed()) return
  const shown = win.selected === undefined ? undefined : projects.get(win.selected)
  win.window.setTitle(shown === undefined ? "Orkestra" : basename(shown.root))
  for (const root of win.projects) {
    const project = projects.get(root)
    if (project === undefined || project === shown || !project.visible) continue
    project.visible = false
    project.view?.setVisible(false)
    if (project.host !== undefined) suspendPages(project.host)
  }
  if (shown?.view === undefined || shown.host === undefined || shown.visible) return
  shown.visible = true
  shown.view.setBounds(win.pane)
  win.window.contentView.addChildView(shown.view)
  shown.view.setVisible(true)
  resumePages(shown.host)
  // The keys go to the project rather than staying on the tile that was pressed.
  if (win.window.isFocused()) shown.view.webContents.focus()
}

/** Move the selected project's view to where the pane now is. */
const fit = (win: Win): void => {
  const shown = win.selected === undefined ? undefined : projects.get(win.selected)
  if (shown?.visible === true) shown.view?.setBounds(win.pane)
}

/**
 * The window was resized: the pane keeps its corner and takes the rest of the window.
 * The rail page says the same a frame later, and this is what keeps the project's view
 * on the window's edge for that frame instead of showing a strip of the page under it.
 */
const resized = (win: Win): void => {
  const [width = 0, height = 0] = win.window.getContentSize()
  win.pane = {
    ...win.pane,
    width: Math.max(1, width - win.pane.x),
    height: Math.max(1, height - win.pane.y),
  }
  fit(win)
}

/* -------------------------------------------------------------------------- */
/* A project: its engine, and its view.                                       */
/* -------------------------------------------------------------------------- */

/**
 * The engine's own client for `project`, in a view on its window. The page bridge and
 * nothing else: where a hosted process's page goes is the one thing the engine's pages
 * ask of the shell — `page-preload.ts`. Transparent until the page has painted, so the
 * rail page's loading frame under it is what shows meanwhile.
 */
const openView = (project: Project, engine: Engine): void => {
  const { home } = project
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PAGE_PRELOAD,
    },
  })
  view.setBackgroundColor("#00000000")
  view.setVisible(false)
  guardLinks(view.webContents)
  // A trak opened in the view, by a link or by a notification's click, closes what the
  // notification centre still shows for it. The client routes in-page, so both events.
  const opened = (url: string): void => {
    for (const trak of traksOpened(engine.url, url)) clearNotices(project, trak)
  }
  view.webContents.on("did-navigate", (_event, url) => opened(url))
  view.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) opened(url)
  })
  home.window.contentView.addChildView(view)
  project.view = view
  project.host = {
    contentView: home.window.contentView,
    webContents: view.webContents,
    // The window outlives the project, so a listener put on it is held to the view it
    // was put there for: after the project has left, it hears nothing.
    on: (event, listener) =>
      home.window.on(event, () => {
        if (project.view === view) listener()
      }),
    once: (_event, listener) => project.leaving.push(listener),
    origin: () => ({ x: home.pane.x, y: home.pane.y }),
    hidden: () => !project.visible,
  }
  void view.webContents.loadURL(engine.url)
}

/** Take a project's view, and the pages drawn over it, off its window for good. */
const dropView = (project: Project): void => {
  const { view, home } = project
  if (view === undefined) return
  for (const listener of project.leaving.splice(0)) listener()
  project.view = undefined
  project.host = undefined
  project.visible = false
  if (!home.window.isDestroyed()) home.window.contentView.removeChildView(view)
  if (!view.webContents.isDestroyed()) view.webContents.close()
}

/**
 * Start the engine for a tile, once at a time per project. The tile reads `starting`
 * from here until the engine answers, exits, or the folder is refused.
 */
const start = (project: Project): Promise<void> => {
  const inFlight = opening.get(project.root)
  if (inFlight !== undefined) return inFlight
  project.state = "starting"
  project.failure = undefined
  pushState(project.home)
  const attempt = startOnce(project).finally(() => opening.delete(project.root))
  opening.set(project.root, attempt)
  return attempt
}

/**
 * Never rejects: every way a start goes wrong is a state the pane draws, and
 * `closeProject` and the quit both wait on this promise.
 *
 * **A project removed while this runs is `closeProject`'s to stop** — it waits for this
 * to finish and then reads the engine off the project, so everything an attempt started
 * has to be on the project by the time it returns.
 */
const startOnce = async (project: Project): Promise<void> => {
  const { root, home } = project
  // A stop in its grace still binds the port and may still hold `daemon.json`, so
  // `startEngine` would attach to it; wait for it to be gone and start afresh.
  await stopping.get(root)
  const refusal = projectRefusal(root, kindOf)
  if (refusal === undefined) {
    try {
      // Electron's own Node, so nothing has to be installed; the login shell's `PATH`,
      // which the engine and everything it spawns inherit.
      const engine = await startEngine(
        root,
        nodeLaunch(ENGINE_ENTRY, process.execPath, {
          PATH: await pathFor(root),
          ELECTRON_RUN_AS_NODE: "1",
        }),
      )
      project.engine = engine
      // Removed, or its window closed, while the engine booted: `closeProject` is waiting
      // on this attempt and stops the engine as soon as it returns.
      if (projects.get(root) !== project || home.window.isDestroyed()) return
      project.state = "started"
      openView(project, engine)
      project.unwatch = watchEngine(engine, {
        notify: (notice) => notify(project, notice),
        refused: (reason) => new Notification({ title: basename(root), body: reason }).show(),
        listed: (traks) => {
          project.traks = traks
          pushState(home)
        },
        log: (line) => console.error(line),
      })
      await rememberOpened(root)
    } catch (e) {
      project.state = "failed"
      project.failure = failureOf(e)
    }
  } else {
    project.state = "refused"
    project.failure = { reason: refusal.reason, output: undefined }
    await forget(root)
  }
  layout(home)
  pushState(home)
}

/**
 * Take `root` out of `projects` and stop its engine — the one way a project leaves, so
 * the rule that it is in `stopping` first holds at every site. A start still in flight is
 * waited for, since the engine it is booting is not on the project until it returns.
 */
const closeProject = (root: string): Promise<void> => {
  const project = projects.get(root)
  if (project === undefined) return stopping.get(root) ?? Promise.resolve()
  const starting = opening.get(root)
  const stop = (async () => {
    await starting
    project.unwatch?.()
    dropView(project)
    if (project.engine !== undefined) await stopEngine(project.engine)
  })().finally(() => stopping.delete(root))
  stopping.set(root, stop)
  projects.delete(root)
  return stop
}

/** Put `root` on the foot of `win`'s rail, not started: selecting it is what starts it. */
const addProject = (win: Win, root: string): void => {
  const project: Project = {
    root,
    state: "off",
    failure: undefined,
    icon: undefined,
    traks: undefined,
    home: win,
    engine: undefined,
    view: undefined,
    host: undefined,
    visible: false,
    unwatch: undefined,
    leaving: [],
    notices: new Map(),
  }
  projects.set(root, project)
  win.projects = [...win.projects, root]
  void (async () => {
    const icon = await findIcon(root)
    if (icon === undefined || projects.get(root) !== project) return
    project.icon = icon
    pushState(win)
  })()
}

/**
 * Show `root` on `win`'s pane. A tile that has never been selected starts its engine
 * here, and only here: one that failed or was refused shows why and waits for a press.
 */
const select = (win: Win, root: string | undefined): void => {
  win.selected = root
  save()
  const project = root === undefined ? undefined : projects.get(root)
  if (project?.state === "off") void start(project)
  layout(win)
  pushState(win)
}

/**
 * Take a project off its window: the engine this app started for it stops, after the
 * question when a turn is running, and the tile that takes its place is selected.
 */
const removeProject = async (win: Win, root: string): Promise<void> => {
  const project = projects.get(root)
  if (project === undefined || project.home !== win) return
  const engines = project.engine === undefined ? [] : [project.engine]
  if (!(await confirmStop(started(engines), "Remove"))) return
  // The question was up for as long as the person took; the tile may have gone meanwhile.
  if (projects.get(root) !== project) return
  const next = afterRemoval(savedOf(win), root)
  win.projects = next.projects
  void closeProject(root)
  select(win, next.selected)
}

/* -------------------------------------------------------------------------- */
/* Windows.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Closing a window closes every project on its rail: their engines go with it, after
 * the same question quitting asks, and the window leaves `windows.json` — a closed
 * window is forgotten, and only a quit keeps one for the next launch. `destroy` skips
 * the `close` handler, so the window goes at once and the engines finish stopping behind it.
 */
const closeWindow = async (win: Win): Promise<void> => {
  if (win.closing) return
  win.closing = true
  const engines = win.projects.flatMap((root) => projects.get(root)?.engine ?? [])
  if (!(await confirmStop(started(engines), "Close"))) {
    win.closing = false
    return
  }
  windows.delete(win)
  save()
  // The views first, while the window they sit on is still there to take them off.
  for (const root of win.projects) {
    const project = projects.get(root)
    if (project !== undefined) dropView(project)
  }
  const stops = win.projects.map(closeProject)
  win.window.destroy()
  await Promise.all(stops)
}

/**
 * A window, with `saved` on its rail. Only the selected project is started — the rest
 * are tiles until they are pressed.
 *
 * The page is the rail, loaded off disk with the rail's own bridge. `show: false` until
 * it has painted, so a dark scheme does not flash white.
 */
const openWindow = (saved: SavedWindow): Win => {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "Orkestra",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: RAIL_PRELOAD,
    },
  })
  const [width = 0, height = 0] = window.getContentSize()
  const win: Win = {
    window,
    projects: [],
    selected: undefined,
    pane: { x: RAIL_WIDTH, y: 0, width: Math.max(1, width - RAIL_WIDTH), height },
    closing: false,
  }
  windows.add(win)
  window.once("ready-to-show", () => window.show())
  window.on("page-title-updated", (event) => event.preventDefault())
  window.on("focus", () => {
    windows.delete(win)
    windows.add(win)
  })
  window.on("resize", () => resized(win))
  window.on("close", (event) => {
    if (quitting) return
    event.preventDefault()
    void closeWindow(win)
  })
  guardLinks(window.webContents)
  void window.loadFile(RAIL_ENTRY)
  for (const root of saved.projects) {
    if (!projects.has(root)) addProject(win, root)
  }
  select(
    win,
    saved.selected !== undefined && win.projects.includes(saved.selected)
      ? saved.selected
      : win.projects[0],
  )
  return win
}

/**
 * `chosen` as the engine will name it. The port pair is hashed from the canonical
 * spelling and `/api/health` reports it, so a picker's `/tmp/x` has to become the
 * engine's `/private/tmp/x` before either is compared — `projectDir` is the one place
 * that spelling is decided.
 *
 * Every way in — the picker, the recents menu, the launch window, an empty window's own
 * list, the dock, `open-file`, the command line — comes through here, so this is where
 * the routing lives (`routeOpen`): a project a window already holds brings that window
 * forward on its tile, and any other joins `into`, the window the press came from, or
 * the window last focused, or a new one when none is up. Nothing opens before
 * `initialised` has settled, so a project the last session had open is found on its rail
 * rather than added a second time.
 */
const openProject = async (chosen: string, into?: Win): Promise<void> => {
  // Once the quit has passed its question, an engine started now would be one it never
  // asked about and never stops.
  if (quitting) return
  asked += 1
  try {
    await initialised
  } finally {
    asked -= 1
  }
  const root = projectDir(["--dir", chosen]).root
  const up = [...windows]
  const route = routeOpen(up.map(savedOf), root, into === undefined ? undefined : up.indexOf(into))
  const win =
    route.to === "new" ? openWindow({ projects: [], selected: undefined }) : up[route.window]
  if (win === undefined) return
  if (route.to !== "held") addProject(win, root)
  select(win, root)
  bringForward(win.window)
  // The launch window's job is done once a window with the project on it is on screen.
  closeLauncherBehind(win.window)
}

/**
 * The picker — a sheet on the window the press came from, else on the launch window
 * while that is up, else on the window last focused, and a free dialog with none of them.
 */
const pickProject = async (into?: Win): Promise<void> => {
  const options = {
    title: "Open a repository",
    message: "Choose a git repository that has an .orkestra/ directory.",
    properties: ["openDirectory" as const],
  }
  const over =
    into?.window ??
    (launcher !== undefined && !launcher.isDestroyed() ? launcher : [...windows].at(-1)?.window)
  const { canceled, filePaths } = await (over === undefined || over.isDestroyed()
    ? dialog.showOpenDialog(options)
    : dialog.showOpenDialog(over, options))
  const chosen = filePaths[0]
  if (canceled || chosen === undefined) return
  await openProject(chosen, into)
}

/**
 * The launch window: the recent projects, one press each, and the button for a folder
 * that is not on the list. Shown at a launch with no window to put back, on the dock icon
 * with no window open, and from the File menu — never by itself when the last window closes.
 *
 * The page runs to the top edge and the traffic lights sit over it, which is what the
 * page's own 80px header inset is for. `show: false` until it has painted, so a dark
 * scheme does not flash white.
 */
const showLauncher = (): void => {
  if (launcher !== undefined && !launcher.isDestroyed()) {
    bringForward(launcher)
    return
  }
  const window = new BrowserWindow({
    width: 480,
    height: 520,
    minWidth: 380,
    minHeight: 360,
    title: "Orkestra",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 13, y: 16 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD,
    },
  })
  window.once("ready-to-show", () => window.show())
  window.on("closed", () => {
    launcher = undefined
  })
  guardLinks(window.webContents)
  void window.loadFile(LAUNCHER_ENTRY)
  launcher = window
}

const buildMenu = (): void => {
  const recentItems: MenuItemConstructorOptions[] = recents.map((root) => ({
    label: root,
    click: () => void openProject(root),
  }))
  const template: MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            openWindow({ projects: [], selected: undefined })
            save()
          },
        },
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: () => void pickProject() },
        { label: "Recent Projects…", accelerator: "Shift+CmdOrCtrl+O", click: showLauncher },
        {
          label: "Open Recent",
          submenu: [
            ...recentItems,
            ...(recentItems.length > 0 ? [{ type: "separator" as const }] : []),
            {
              label: "Clear Menu",
              enabled: recentItems.length > 0,
              click: () => {
                recents = []
                app.clearRecentDocuments()
                void writeRecents(RECENTS_FILE, recents).then(recentsChanged)
              },
            },
          ],
        },
        { type: "separator" },
        {
          // The focused window's selected project; with no window or no project it does nothing.
          label: "Remove Project from Window",
          click: () => {
            const win = [...windows].find((w) => w.window.isFocused())
            if (win?.selected !== undefined) void removeProject(win, win.selected)
          },
        },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * The engines this app started, which are the only ones a stop acts on. An attached
 * engine has no `child`, `stopEngine` leaves it running, and a question about a turn on
 * it would warn of a death that is not going to happen — so the set asked about and
 * the set stopped are this one set, at both callers.
 */
const started = (engines: readonly Engine[]): readonly Engine[] =>
  engines.filter((e) => e.child !== undefined)

/**
 * Wait until no open and no stop is in flight, including any that began while waiting. Recursive
 * for `pickPair`'s reason: the next look is worth taking only once this round has
 * finished.
 *
 * Outcomes, not values: a start never rejects and a stop that did is a failure in
 * stopping, and neither may cancel a quit — `before-quit` has
 * been cancelled by the time this runs, so a rejection here would lose the keypress
 * silently.
 */
const settled = async (): Promise<void> => {
  if (opening.size === 0 && stopping.size === 0) return
  await Promise.allSettled([...opening.values(), ...stopping.values()])
  return settled()
}

/**
 * Stop every engine this app started, asking first if any has a turn in flight.
 * `before-quit` is cancelled on the first pass so the question can be asked; the second
 * pass, with `quitting` set, lets the windows close.
 *
 * **A start or a stop still in flight is awaited before `projects` is read**, both before
 * the question and again after it — the person can start or close one while the dialog
 * is up. An engine whose start has not finished, or whose stop is in its grace, is
 * otherwise in no set: the app exits, and the child, which nothing ties to this process,
 * keeps serving its port with no window and no record naming it as ours.
 *
 * `windows.json` is left as the last change wrote it — `save` refuses once `quitting` is
 * set — and that write is waited for, so the windows up now are the ones a launch restores.
 */
const stopAllThenQuit = async (): Promise<void> => {
  await settled()
  const engines = [...projects.values()].flatMap((p) => p.engine ?? [])
  if (!(await confirmStop(started(engines), "Quit"))) return
  quitting = true
  await saving
  await settled()
  await Promise.all([...projects.keys()].map(closeProject))
  app.quit()
}

/**
 * Where `dist/serve.js` is: beside this package in the checkout, or under the app's
 * resources once packaged. Checked to exist before the first window.
 */
const ENGINE_ENTRY = app.isPackaged
  ? join(process.resourcesPath, "engine", "serve.js")
  : join(app.getAppPath(), "..", "dist", "serve.js")
/**
 * The launch window's page, beside the engine in both layouts: the root `pnpm build`
 * copies `client/dist` next to `dist/serve.js`, and the packager carries that directory
 * whole. One rule rather than one per layout, and it means the page the shell shows is
 * the one the engine was built with.
 */
const LAUNCHER_ENTRY = join(dirname(ENGINE_ENTRY), "client", "dist", "launcher.html")
/** A window's own page — the rail — beside it, for the same reason. */
const RAIL_ENTRY = join(dirname(ENGINE_ENTRY), "client", "dist", "rail.html")
/** This package's own second build output, beside `main.js`. */
const PRELOAD = join(app.getAppPath(), "dist", "preload.cjs")
/** Its third: a project's bridge to the native page view. */
const PAGE_PRELOAD = join(app.getAppPath(), "dist", "page-preload.cjs")
/** And its fourth: the bridges a window's rail page is given. */
const RAIL_PRELOAD = join(app.getAppPath(), "dist", "rail-preload.cjs")

/** The window whose own page — its rail — sent a message, or `undefined` for any other sender. */
const railOf = (sender: WebContents): Win | undefined =>
  [...windows].find((win) => win.window.webContents === sender)

// What the launch window can ask for, and a window's rail page with it — the empty pane
// lists the same recents. Registered once, here, rather than per window: `ipcMain.handle`
// refuses a second handler on a channel. A press from a rail goes to that rail's window.
ipcMain.handle(CHANNELS.recents, async () => {
  await initialised
  return rowsOf(await reachable(), HOME)
})
ipcMain.handle(CHANNELS.open, async (event, path: unknown) => {
  if (typeof path !== "string") throw new TypeError("open wants a path")
  await openProject(path, railOf(event.sender))
})
ipcMain.handle(CHANNELS.pick, (event) => pickProject(railOf(event.sender)))

// What a window's rail page can ask for, about its own window and no other: every
// handler finds the window by its sender, and a path has to be on that window's rail.
ipcMain.handle(RAIL_CHANNELS.state, (event) => {
  const win = railOf(event.sender)
  if (win === undefined) throw new Error("only a window's rail can ask for its state")
  return stateOf(win)
})
/** The sender's window and the project `path` names on its rail, or `undefined`. */
const pressed = (sender: WebContents, path: unknown): [Win, Project] | undefined => {
  const win = railOf(sender)
  const project = typeof path === "string" ? projects.get(path) : undefined
  return win === undefined || project?.home !== win ? undefined : [win, project]
}
ipcMain.on(RAIL_CHANNELS.select, (event, path: unknown) => {
  const found = pressed(event.sender, path)
  if (found !== undefined) select(found[0], found[1].root)
})
ipcMain.on(RAIL_CHANNELS.retry, (event, path: unknown) => {
  const project = pressed(event.sender, path)?.[1]
  // Only a start that failed is tried again; a refused folder would be refused again.
  if (project?.state === "failed") void start(project)
})
ipcMain.on(RAIL_CHANNELS.remove, (event, path: unknown) => {
  const found = pressed(event.sender, path)
  if (found !== undefined) void removeProject(found[0], found[1].root)
})
ipcMain.on(RAIL_CHANNELS.menu, (event, path: unknown) => {
  const found = pressed(event.sender, path)
  if (found === undefined) return
  const [win, project] = found
  Menu.buildFromTemplate([
    {
      label: "Reload Project Files",
      // Only once an engine has answered, started here or attached to alike.
      enabled: project.engine !== undefined,
      click: () => void reloadFiles(project),
    },
    { type: "separator" },
    { label: "Remove from Window", click: () => void removeProject(win, project.root) },
  ]).popup({ window: win.window })
})
ipcMain.on(RAIL_CHANNELS.place, (event, bounds: unknown) => {
  const win = railOf(event.sender)
  const box =
    win === undefined ? undefined : placement(bounds, win.window.webContents.getZoomFactor())
  if (win === undefined || box === undefined) return
  win.pane = box
  fit(win)
})
// What a project's page can ask for: its own page views, and nothing about another project.
installPageView(
  (sender) => [...projects.values()].find((p) => p.view?.webContents === sender)?.host,
  (message) => console.error(message),
)

app.on("before-quit", (event) => {
  if (quitting) return
  event.preventDefault()
  void stopAllThenQuit()
})

// macOS keeps an app alive with no windows; the menu and the dock offer Open.
app.on("window-all-closed", () => undefined)
app.on("activate", () => {
  if (windows.size === 0 && asked === 0) showLauncher()
})
app.on("open-file", (event, path) => {
  event.preventDefault()
  void openProject(path)
})

/**
 * Everything a first open depends on: the build's pieces, the recents, the menu, and the
 * windows the last session had up. `openProject` awaits this first, so an `open-file`
 * dispatched at launch — the dock's recent documents — neither races the recents read
 * nor adds a second tile for a project a restored window already holds.
 */
const initialise = async (): Promise<void> => {
  await app.whenReady()
  // Packaged, the bundle's `.icns` is the dock icon. From the checkout Electron's own
  // would be, so the dock is pointed at the artwork that icon is generated from.
  if (!app.isPackaged)
    app.dock?.setIcon(join(app.getAppPath(), "..", "client", "public", "icon-512.png"))
  // Checked before the first window rather than at the first open, so a build that
  // forgot a piece fails at launch with the path it wanted. The client bundle has to
  // exist before the engine's build copies it, which is the order `pnpm app` runs in.
  const missing = [
    ENGINE_ENTRY,
    LAUNCHER_ENTRY,
    RAIL_ENTRY,
    PRELOAD,
    PAGE_PRELOAD,
    RAIL_PRELOAD,
  ].filter((path) => !existsSync(path))
  if (missing.length > 0) {
    dialog.showErrorBox(
      "The build is incomplete",
      `${missing.join("\n")}\n\ndoes not exist. From the checkout, \`pnpm --filter @orkestra/client build && pnpm build && pnpm --filter @orkestra/desktop build\` writes everything.`,
    )
    throw new Error("the build is incomplete")
  }
  recents = await readRecents(RECENTS_FILE)
  buildMenu()
  for (const saved of await readWindows(WINDOWS_FILE)) openWindow(saved)
}

const initialised = initialise()

const main = async (): Promise<void> => {
  await initialised
  // A path on the command line opens that project: `electron . /path/to/repo`.
  const argued = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith("-"))
  // An `open-file` at launch may already be opening one; then the launch window stays
  // away, or it would flash up in front of the window that project is about to get.
  if (argued !== undefined) await openProject(argued)
  else if (windows.size === 0 && asked === 0) showLauncher()
}

void main().catch((e: unknown) => {
  console.error(String(e))
  app.exit(1)
})
