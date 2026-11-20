/**
 * The seam between a host's page and the project frames it draws over its pane — the one
 * file in `client/` that calls `postMessage` across them.
 *
 * **One phone header has to span two documents.** The project picker is the host page's,
 * since the page holds every project and the sheet; search is the frame's, since the
 * palette searches that project's traks and files. So the page draws the whole header
 * and the frame draws none, and the two say what each needs here: the frame tells the
 * page it is there, and the page tells the frame whether it is drawing that header and
 * asks it to open search.
 *
 * **The frame stands its bar down on the page's word, never on its own width.** The page
 * draws its header below its own breakpoint, and beside the rail the frame is 48px
 * narrower than the page — so a frame that judged by itself would draw no bar in a window
 * 640–687px wide, where the page draws none either and the list loses search.
 *
 * **The frames share one back stack with the page, and each other.** A frame's history is
 * joined to the top window's, so two frames each holding a screen over their list would
 * be two steps back, the first one moving a frame nobody can see. So each frame says
 * whether it holds that entry (`held`), and the page tells each whether it is shown: a
 * hidden frame gives its entry up (`release` in `backStack.ts`), and the shown one takes
 * one only once no other frame holds one (`reclaim`). The page waits for the release
 * because both are moves on one history, and a push landing before a pending back would
 * be the entry that back removes.
 *
 * Both ends are this origin's own client, so every message is sent to and accepted from
 * this origin alone, and decoded before it is believed.
 */

import { Schema } from "effect"
import { basePath } from "../base"

const ScreenMessage = Schema.Struct({
  type: Schema.Literal("orkestra:screen"),
  base: Schema.String,
  // Optional: each project's engine serves its own client, which can be older than the
  // host's page, and a frame that never says it holds an entry is read as holding none.
  held: Schema.optional(Schema.Boolean),
})
const SearchMessage = Schema.Struct({
  type: Schema.Literal("orkestra:search"),
})
const HeaderMessage = Schema.Struct({
  type: Schema.Literal("orkestra:header"),
  drawn: Schema.Boolean,
})

const ShownMessage = Schema.Struct({
  type: Schema.Literal("orkestra:shown"),
  shown: Schema.Boolean,
})

const isScreen = Schema.is(ScreenMessage)
const isShown = Schema.is(ShownMessage)
const isSearch = Schema.is(SearchMessage)
const isHeader = Schema.is(HeaderMessage)

/** Whether this page is drawn inside another — a host's frame. */
export const framed = (): boolean => window.parent !== window

/**
 * Whether the host's page shows this frame. `true` until the page says otherwise, which is
 * also the answer for a page that is not framed: a frame is mounted only once its project
 * is selected, so it opens shown.
 */
let shown = true

/** Whether this page is on screen, as the back stack reads it — `backStack.ts`. */
export const frameShown = (): boolean => shown

/**
 * Tell the host's page this frame is there, and whether it holds an entry over the list on
 * the shared back stack. An older frame also sends `list`, which decoding ignores.
 */
export const tellScreen = (held: boolean): void => {
  const message: typeof ScreenMessage.Type = {
    type: "orkestra:screen",
    base: basePath(document.baseURI),
    held,
  }
  window.parent.postMessage(message, window.location.origin)
}

/**
 * Every message from the host's page: a request to open search, whether the page is
 * drawing its phone header over this frame, and whether it shows this frame — reported
 * only when that changes, and recorded for `frameShown` before `onShown` runs, since the
 * moves `onShown` makes read it. The page repeats itself, and a repeated hide must not
 * go back twice. Returns the unsubscribe.
 */
export const watchHost = (
  onSearch: () => void,
  onHeader: (drawn: boolean) => void,
  onShown: (shown: boolean) => void,
): (() => void) => {
  const listener = (event: MessageEvent<unknown>): void => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return
    if (isSearch(event.data)) onSearch()
    if (isHeader(event.data)) onHeader(event.data.drawn)
    if (isShown(event.data) && event.data.shown !== shown) {
      shown = event.data.shown
      onShown(shown)
    }
  }
  window.addEventListener("message", listener)
  return () => {
    window.removeEventListener("message", listener)
  }
}

/** One frame that has spoken: its prefix — `frameBase` of its project's `href`. */
export interface FrameScreen {
  readonly base: string
  /** Whether it holds an entry over its list on the back stack the frames share. */
  readonly held: boolean
  /** The frame's window, which a search request is sent to. */
  readonly frame: Window
}

/** Every screen a frame reports, on the host's page. Returns the unsubscribe. */
export const watchScreens = (onScreen: (screen: FrameScreen) => void): (() => void) => {
  const listener = (event: MessageEvent<unknown>): void => {
    const source = event.source
    // `in` rather than `instanceof Window`: a frame's window is from another realm.
    if (event.origin !== window.location.origin || source === null || !("location" in source))
      return
    if (isScreen(event.data))
      onScreen({ base: event.data.base, held: event.data.held ?? false, frame: source })
  }
  window.addEventListener("message", listener)
  return () => {
    window.removeEventListener("message", listener)
  }
}

/**
 * The prefix a project's frame reports itself under: its `href`, which the host writes
 * relative to its own page, resolved against that page.
 */
export const frameBase = (href: string): string => basePath(new URL(href, document.baseURI).href)

/** Ask one frame to open its search. */
export const askSearch = (frame: Window): void => {
  const message: typeof SearchMessage.Type = { type: "orkestra:search" }
  frame.postMessage(message, window.location.origin)
}

/** Tell one frame whether this page is drawing its phone header over it. */
export const tellHeader = (frame: Window, drawn: boolean): void => {
  const message: typeof HeaderMessage.Type = { type: "orkestra:header", drawn }
  frame.postMessage(message, window.location.origin)
}

/** Tell one frame whether this page shows it, which decides whether it may hold a back step. */
export const tellShown = (frame: Window, visible: boolean): void => {
  const message: typeof ShownMessage.Type = { type: "orkestra:shown", shown: visible }
  frame.postMessage(message, window.location.origin)
}
