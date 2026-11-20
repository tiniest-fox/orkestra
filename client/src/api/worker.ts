/**
 * The service worker's half of a notification click — the one file in `client/` that
 * hears `public/sw.js`.
 *
 * **The worker asks the open page to go somewhere rather than steering it.**
 * `WindowClient.navigate` reloads the page and pushes an entry; a message lets the page
 * route the click by its own back-stack rule (`backStack.ts`). The worker still opens a
 * window itself when none is open.
 */

import { Schema } from "effect"

const OpenMessage = Schema.Struct({
  type: Schema.Literal("orkestra:open"),
  url: Schema.String,
})

const isOpen = Schema.is(OpenMessage)

/**
 * Every URL the worker asks this page to open. Returns the unsubscribe; a browser with no
 * service worker has nothing to hear.
 */
export const watchOpens = (onOpen: (url: string) => void): (() => void) => {
  if (!("serviceWorker" in navigator)) return () => {}
  const container = navigator.serviceWorker
  const listener = (event: MessageEvent<unknown>): void => {
    if (isOpen(event.data)) onOpen(event.data.url)
  }
  container.addEventListener("message", listener)
  // Messages wait until the page says it is listening, which an `addEventListener` does
  // not say by itself.
  container.startMessages()
  return () => {
    container.removeEventListener("message", listener)
  }
}
