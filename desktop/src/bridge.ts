// The names the windows and the main process meet on — the IPC channels and the
// globals the preloads put on their pages. Spelled once, so the preloads and the handlers
// cannot drift.

export const BRIDGE_NAME = "orkestra"

export const CHANNELS = {
  /** invoke → the rows as they are now */
  recents: "launcher:recents",
  /** main → window, the rows after every change */
  recentsChanged: "launcher:recents-changed",
  /** invoke with a path → settles once the project is open or refused */
  open: "launcher:open",
  /** invoke → the folder picker, then the same as `open` */
  pick: "launcher:pick",
} as const

/** The global a project window's preload puts on the page — `page-preload.ts`. */
export const PAGE_BRIDGE_NAME = "orkestraPage"

/** Between a project window and main, each one-way: nothing on the page waits for the shell. */
export const PAGE_CHANNELS = {
  /** send with a run, a URL and the pane's bounds → load it if the run is new, place, show */
  show: "page:show",
  /** send → take the view off the window until the next `show` */
  hide: "page:hide",
  /** send → reload what the view holds */
  reload: "page:reload",
  /** send → copy the default browser's GitHub login into the pull request view now */
  copyLogin: "page:copy-login",
  /** send → open GitHub's sign-in in the default browser */
  signIn: "page:sign-in",
  /** main → window, a `PageLogin` after every copy and every sign-in handed out */
  login: "page:login",
} as const

/** The global a window's own page — the project rail — is given, by `rail-preload.ts`. */
export const RAIL_BRIDGE_NAME = "orkestraRail"

/** Between a window's rail page and main. Everything but `state` is one-way. */
export const RAIL_CHANNELS = {
  /** invoke → the window's rail as it is now */
  state: "rail:state",
  /** main → window, the rail after every change, whole */
  stateChanged: "rail:state-changed",
  /** send with a path → show that project, starting its engine the first time */
  select: "rail:select",
  /** send with a path → start a project whose engine failed */
  retry: "rail:retry",
  /** send with a path → take the project off the window and stop its engine */
  remove: "rail:remove",
  /** send with a path → the tile's native menu */
  menu: "rail:menu",
  /** send with the pane's bounds → where the selected project's view goes */
  place: "rail:place",
} as const
