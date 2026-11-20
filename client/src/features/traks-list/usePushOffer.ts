/**
 * Whether to offer turning notifications on, and the two answers a person can give.
 *
 * The offer is drawn once per browser, ever: it is open only while the permission is
 * still `default` and nothing has said *Not now* — which is remembered in
 * `localStorage`, because the point of an ask-once band is that dismissing it settles
 * it. A browser that cannot push (no `Notification`, no service worker, no
 * `PushManager` — happy-dom included) never opens it.
 *
 * `turnOn` does the whole subscription in the tap's own handler, because iOS refuses a
 * permission request made anywhere else: ask, wait for the worker, fetch the engine's
 * key, subscribe, and hand the engine the result to keep. A failure anywhere leaves the
 * band open with a sentence, so the press can be tried again.
 */

import { useCallback, useState } from "react"
import { pushKey, subscribeToPush } from "../../api/engine"
import { storageKey } from "../../base"

/** A function rather than a constant: the base is the page's, read once it has one. */
const dismissed = (): string => storageKey("orkestra_push_dismissed", document.baseURI)

/** base64url, as VAPID keys are written, to the bytes `subscribe` takes. */
const applicationServerKey = (key: string): Uint8Array<ArrayBuffer> => {
  const padded = key.padEnd(key.length + ((4 - (key.length % 4)) % 4), "=")
  const raw = atob(padded.replaceAll("-", "+").replaceAll("_", "/"))
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

const canAsk = (): boolean =>
  "Notification" in window &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  Notification.permission === "default" &&
  window.localStorage.getItem(dismissed()) === null

export interface PushOfferState {
  readonly open: boolean
  readonly failed: boolean
  readonly turnOn: () => void
  readonly dismiss: () => void
}

export const usePushOffer = (): PushOfferState => {
  const [open, setOpen] = useState(canAsk)
  const [failed, setFailed] = useState(false)

  const turnOn = useCallback(() => {
    void (async () => {
      try {
        const permission = await Notification.requestPermission()
        // Denied is an answer: the permission is no longer `default`, so the band
        // never opens again. Nothing to remember.
        if (permission !== "granted") {
          setOpen(false)
          return
        }
        const registration = await navigator.serviceWorker.ready
        const key = (await pushKey()).publicKey
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(key),
        })
        const json = subscription.toJSON()
        const endpoint = json.endpoint
        const p256dh = json.keys?.["p256dh"]
        const auth = json.keys?.["auth"]
        if (endpoint === undefined || p256dh === undefined || auth === undefined) {
          throw new Error("the browser returned a subscription with no keys")
        }
        await subscribeToPush({ endpoint, keys: { p256dh, auth } })
        setOpen(false)
      } catch {
        setFailed(true)
      }
    })()
  }, [])

  const dismiss = useCallback(() => {
    window.localStorage.setItem(dismissed(), "1")
    setOpen(false)
  }, [])

  return { open, failed, turnOn, dismiss }
}
