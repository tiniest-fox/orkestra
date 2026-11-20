import { createRoot } from "react-dom/client"
import { defaultShouldDehydrateQuery, QueryClient } from "@tanstack/react-query"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import App from "./App"
import { storageKey } from "./base"
import { forgeAnswerKey, MEMORY_MS, worthRemembering } from "./forgeMemory"

// The entry mounts; `App` holds the router. Splitting them is what lets a test render
// the shell without a real DOM root, and it keeps the one `QueryClient` the whole app
// shares at the outermost layer — every hook's cache, including the polling.
const queryClient = new QueryClient()

// **`localStorage` and not `sessionStorage`**: what this is for is the tab being closed and
// opened again, which is exactly what a session store forgets. It is synchronous and it is
// written on every cache change, which is why the allow-list below matters — see
// `forgeMemory`. The key is the library's own default, kept to this page's prefix.
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: storageKey("REACT_QUERY_OFFLINE_CACHE", document.baseURI),
})

// `getElementById` returns `HTMLElement | null`, and the engine's rules ban both `!`
// and `as`, so the narrowing is a real check. It is also the more useful failure:
// a thrown error names the missing element, where `!` would fail later inside React.
const container = document.getElementById("root")
if (container === null) throw new Error("index.html is missing #root")

// The push handlers, registered at load so a subscription has a worker to attach to —
// iOS refuses to subscribe before one is active. The worker caches nothing, so failing
// to register costs notifications and nothing else; `catch` because an insecure origin
// (the `--host` LAN address) rejects here and the app is otherwise fine there.
//
// Relative to the page's `<base>`, so under a host's `/p/x/` the worker is `/p/x/sw.js`
// and its default scope is `/p/x/` — one worker, and one push subscription, per project.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(new URL("sw.js", document.baseURI)).catch(() => {})
}

createRoot(container).render(
  // **Only the forge's answers are written down, and only for an hour.** Everything else
  // this app holds — a trak's log, its transcript, a diff — is the engine's and is a replay
  // away, so persisting it would be a browser writing megabytes on every poll to save a
  // read that costs no I/O. The forge is the one thing behind a process the engine spawns,
  // and the one thing a cold page cannot say anything about.
  //
  // `shouldDehydrateQuery` composes with TanStack's own default rather than replacing it, so
  // a failed or still-pending query stays out for the reason it always did.
  //
  // **`shouldDehydrateMutation` is turned off outright, and it is not covered by the key
  // allow-list above** — a mutation has no query key for one to read. The library's default
  // persists any *paused* mutation, and `networkMode: "online"` pauses one whenever
  // `navigator.onLine` goes false — which says nothing about the engine, since it is on
  // localhost. So wifi dropping while somebody presses Approve or Send would write that
  // press into `localStorage` with its variables, under the same store the hour is measured
  // over. Every press in this client either spends real money or moves a trak, and neither
  // is a thing to replay out of storage with nobody at the keyboard.
  <PersistQueryClientProvider
    client={queryClient}
    persistOptions={{
      persister,
      maxAge: MEMORY_MS,
      dehydrateOptions: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) &&
          forgeAnswerKey(query.queryKey) &&
          worthRemembering(query.state.data),
        shouldDehydrateMutation: () => false,
      },
    }}
  >
    <App />
  </PersistQueryClientProvider>,
)
