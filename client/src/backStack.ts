/**
 * The back stack an installed app keeps: the traks list, and at most one screen over it,
 * so back from a trak goes to the list and back again leaves the app.
 *
 * **One rule, applied to the history rather than at every call site.** A move from the
 * list to anything else pushes one entry and marks it `overList`; every other move
 * replaces the current entry and carries the mark along; a move to the list from a marked
 * entry goes back, which drops the entry instead of stacking a second list on it. Every
 * `Link`, `navigate` and raw `history.push` reaches the router's history, so a door added
 * later obeys the rule without anyone remembering it.
 *
 * **`shown` is for a host's frames**, which share one back stack with the host's page and
 * with each other — `api/frame.ts` says how the page keeps one entry over home among them.
 * A frame that is hidden never pushes, so a notification steering it adds no step the
 * person cannot see.
 *
 * Top-level rather than in a feature, for `base.ts`'s reason: the router, the frame hook
 * and the notification hook all read it. Kind `pure`: every function acts only on the
 * history it is handed.
 */

import type { HistoryState, RouterHistory } from "@tanstack/react-router"

export type Move = "push" | "replace" | "back"

export interface Step {
  readonly move: Move
  /** Whether the entry the move leaves current sits over the list. */
  readonly overList: boolean
}

/** Which move one navigation makes, from where the history is to where it is going. */
export const stackStep = (
  at: { readonly home: boolean; readonly overList: boolean },
  toHome: boolean,
  shown: boolean,
): Step => {
  if (at.home)
    return toHome || !shown
      ? { move: "replace", overList: false }
      : { move: "push", overList: true }
  if (toHome) return { move: at.overList ? "back" : "replace", overList: false }
  return { move: "replace", overList: at.overList && shown }
}

const trimmed = (path: string): string => path.replace(/\/+$/, "")

/** Whether a path — with or without its search — is the list, at the page's prefix. */
const isHome = (home: string, path: string): boolean =>
  trimmed(new URL(path, "http://h").pathname) === trimmed(home)

const marked = (history: RouterHistory): boolean => history.location.state.overList === true

/**
 * The history with the rule laid over its `push` and `replace` — the caller's choice
 * between the two is overruled, since it is the rule's to make. `home` is the list's
 * path under the page's prefix; `shown` says whether the page is on screen.
 */
export const withBackStack = (
  history: RouterHistory,
  home: string,
  shown: () => boolean,
): RouterHistory => {
  const { push, replace, back } = history
  const move = (path: string, state?: HistoryState, opts?: { ignoreBlocker?: boolean }): void => {
    const step = stackStep(
      { home: isHome(home, history.location.pathname), overList: marked(history) },
      isHome(home, path),
      shown(),
    )
    if (step.move === "back") {
      back(opts)
      return
    }
    const next: HistoryState = { ...state, overList: step.overList }
    if (step.move === "push") push(path, next, opts)
    else replace(path, next, opts)
  }
  history.push = move
  history.replace = move
  return history
}

/**
 * Give up the entry this page holds over the list, staying on the screen it shows — for a
 * frame being hidden. Goes back, then replaces the list with the screen again once the
 * history has arrived there; `shown` must already answer `false`, so the replace drops
 * the mark. Does nothing on an unmarked entry.
 */
export const release = (history: RouterHistory, home: string): void => {
  const here = history.location
  if (here.state.overList !== true) return
  const unsubscribe = history.subscribe(({ location }) => {
    unsubscribe()
    if (isHome(home, location.pathname)) history.replace(here.href, here.state)
  })
  history.back()
}

/**
 * Take back an entry over the list for the screen this page shows — for a frame being
 * shown again after `release`. Replaces the screen with the list, then pushes the screen,
 * so back from it goes to the list. `shown` must already answer `true`. Does nothing on
 * the list or on an entry already marked.
 */
export const reclaim = (history: RouterHistory, home: string): void => {
  const here = history.location
  if (isHome(home, here.pathname) || here.state.overList === true) return
  history.replace(home)
  // The browser history batches a microtask's moves into one, which would turn this
  // replace and the push after it into a single push.
  history.flush()
  history.push(here.href, here.state)
}

/**
 * Steer the page to a URL the service worker was asked to open — a notification click —
 * by the same rule as any other move. A URL on another origin is not this page's.
 */
export const open = (history: RouterHistory, url: string, origin: string): void => {
  const target = new URL(url)
  if (target.origin !== origin) return
  history.push(`${target.pathname}${target.search}${target.hash}`)
}
