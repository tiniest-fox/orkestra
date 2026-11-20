/**
 * The native page view's seam — the one file in `client/` that reads `window.orkestraPage`.
 *
 * Orkestra.app's project windows carry a `PageBridge` there, put on by the shell's
 * preload; a browser has none. Unlike `launcher.ts`, whose page has no use without its
 * bridge, the absence here is an ordinary answer rather than a failure: a hosted process's
 * page is drawn by the shell's native view where the bridge exists and in an `<iframe>`
 * everywhere else. So `pageBridge` hands back `undefined` rather than throwing, and the
 * caller picks the fallback.
 *
 * Every call is one-way. The one thing that comes back is the pull request view's login
 * state, which is `unknown` by contract and decoded here, `launcher.ts`'s rule.
 */

import { Schema } from "effect"
import type { PageBridge, PageLogin } from "@orkestra/shared/page"
import { PageLogin as PageLoginSchema } from "@orkestra/shared/page"

declare global {
  interface Window {
    /** Present only inside an Orkestra.app project window; the preload puts it here. */
    orkestraPage?: PageBridge
  }
}

/** The shell's native page view, or `undefined` outside Orkestra.app. */
export const pageBridge = (): PageBridge | undefined => window.orkestraPage

const decodeLogin = Schema.decodeUnknownSync(PageLoginSchema)

/**
 * Every login state the shell reports for the pull request view, decoded. Returns the
 * unsubscribe; with no bridge there is nothing to hear.
 */
export const watchLogin = (listener: (login: PageLogin) => void): (() => void) => {
  const bridge = pageBridge()
  return bridge === undefined ? () => {} : bridge.onLogin((raw) => listener(decodeLogin(raw)))
}
