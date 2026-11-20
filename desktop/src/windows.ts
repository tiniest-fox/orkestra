// The windows the app had open, each with its projects in rail order and the one its pane
// showed — what a launch puts back.
//
// Pure: what a stored file reads as, what is written, and what a window's set becomes
// when a project leaves it. `windows-file.ts` does the reading and writing.

export interface SavedWindow {
  /** Canonical project roots, top of the rail first. */
  readonly projects: readonly string[]
  /** One of `projects`, or absent for a window that holds none. */
  readonly selected: string | undefined
}

const strings = (raw: unknown): readonly string[] =>
  Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : []

/**
 * The file's text as a list of windows, or empty — `parseRecents`'s rule for a file this
 * app did not write.
 *
 * **A project sits in one window only**, and the file is held to that as it is read: a
 * root a second window names is dropped from the second, since two tiles for one project
 * would be two views on one engine and two answers to which window a notification opens.
 * A `selected` that is not among the window's projects reads as its first.
 */
export const parseWindows = (text: string): readonly SavedWindow[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof parsed !== "object" || parsed === null || !("windows" in parsed)) return []
  const list: unknown = parsed.windows
  if (!Array.isArray(list)) return []
  const taken = new Set<string>()
  return list.flatMap((entry: unknown): readonly SavedWindow[] => {
    if (typeof entry !== "object" || entry === null) return []
    const projects = strings("projects" in entry ? entry.projects : undefined).filter(
      (root) => !taken.has(root),
    )
    for (const root of projects) taken.add(root)
    const chosen: unknown = "selected" in entry ? entry.selected : undefined
    const selected = typeof chosen === "string" && projects.includes(chosen) ? chosen : projects[0]
    return [{ projects: [...new Set(projects)], selected }]
  })
}

export const serializeWindows = (windows: readonly SavedWindow[]): string =>
  `${JSON.stringify({ windows }, undefined, 2)}\n`

/**
 * A window's set once `root` has left it. Removing the selected project selects the tile
 * that takes its place on the rail, or the one above when it was the last; removing any
 * other leaves the selection alone.
 */
export const afterRemoval = (window: SavedWindow, root: string): SavedWindow => {
  const at = window.projects.indexOf(root)
  if (at === -1) return window
  const projects = window.projects.filter((p) => p !== root)
  if (window.selected !== root) return { projects, selected: window.selected }
  return { projects, selected: projects[at] ?? projects[at - 1] }
}

/** Where a project a person asked to open goes. */
export type OpenRoute =
  /** A window already holds it: that window comes forward on its tile. */
  | { readonly to: "held"; readonly window: number }
  /** It joins the rail of the window at this index. */
  | { readonly to: "add"; readonly window: number }
  /** No window is open, so it gets one. */
  | { readonly to: "new" }

/**
 * Route an open over the windows that are up. A window that holds `root` wins over the
 * one asked for, because a project sits in one window only and a second tile would start
 * nothing new. Otherwise it joins `asked` — the window the press came from — or, for a
 * press with no window of its own, the last of `windows`, which the caller keeps in the
 * order they were last focused.
 */
export const routeOpen = (
  windows: readonly SavedWindow[],
  root: string,
  asked: number | undefined,
): OpenRoute => {
  const holder = windows.findIndex((w) => w.projects.includes(root))
  if (holder !== -1) return { to: "held", window: holder }
  if (asked !== undefined && windows[asked] !== undefined) return { to: "add", window: asked }
  return windows.length === 0 ? { to: "new" } : { to: "add", window: windows.length - 1 }
}
