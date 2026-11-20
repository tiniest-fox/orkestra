/**
 * Close this device's notifications about the item a page shows, as the page opens it.
 *
 * `tag` is what `src/app/push.ts` stamps on a payload and `public/sw.js` hands to
 * `showNotification` — `trak:<id>` or `goal:<id>` — so the worker's registration can
 * find them again. Run on mount and again whenever the tag changes, since a route that
 * moves from one id to the next keeps its page mounted. `undefined` closes nothing, for a
 * page that does not yet know which item it shows.
 *
 * **Best effort, as the worker's registration in `main.tsx` is.** A browser with no
 * service worker or no `getNotifications` — happy-dom, an insecure origin, the desktop
 * shell's own windows — does nothing, and a failure is swallowed: a notification left
 * standing costs nothing the page needs.
 */

import { useEffect } from "react"

const close = async (tag: string): Promise<void> => {
  const registration = await navigator.serviceWorker.ready
  if (typeof registration.getNotifications !== "function") return
  for (const shown of await registration.getNotifications({ tag })) shown.close()
}

export const useClearNotifications = (tag: string | undefined): void => {
  useEffect(() => {
    if (tag === undefined || !("serviceWorker" in navigator)) return
    close(tag).catch(() => {})
  }, [tag])
}
