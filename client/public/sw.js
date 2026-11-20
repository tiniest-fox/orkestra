// The service worker: a push handler and a click handler, nothing else.
//
// **It caches nothing, on purpose.** The client ships as one large chunk (see
// client/vite.config.ts), so precaching it would make the first launch on cellular
// worse, and with the engine unreachable the app shows skeletons exactly as it does in
// a browser. It also never calls /api/: the guard reads `sec-fetch-site` on
// cookie-authenticated writes, and a worker-initiated fetch is a question this file
// avoids ever having to answer.
//
// The payload is what src/app/push.ts sends: { title, body, url, tag }. The tag names the
// trak or goal, so a newer notification for it replaces the last, and the page that opens
// it closes what is left — client/src/hooks/useClearNotifications.ts.
//
// **Everything here resolves against the worker's scope**, which is the page's prefix —
// `/` with none, `/p/x/` behind a host that serves this engine there. The engine knows no
// prefix, so its `url` is root-relative: the leading `/` is dropped and the rest resolved
// under the scope, or a click behind a host opens the host's root instead of the trak.
const inScope = (path) => new URL(path.replace(/^\//, ""), self.registration.scope).href

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Orkestra", {
      body: data.body ?? "",
      tag: data.tag,
      icon: inScope("icon-192.png"),
      data: { url: inScope(data.url ?? "/") },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? self.registration.scope
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((open) => {
      // An open window is focused and asked to go there rather than a second one opened —
      // the installed app is a single window, and iOS refuses openWindow from one.
      // Matched on the scope rather than the origin: behind a host the origin is shared,
      // and the first window on it can be another project's.
      //
      // Asked by message rather than steered with `navigate`, which reloads the page and
      // pushes an entry: the page routes the click by its own back-stack rule —
      // client/src/api/worker.ts and client/src/backStack.ts.
      const ours = open.find((w) => w.url.startsWith(self.registration.scope))
      if (ours === undefined) return self.clients.openWindow(url)
      return ours.focus().then((w) => (w ?? ours).postMessage({ type: "orkestra:open", url }))
    }),
  )
})
