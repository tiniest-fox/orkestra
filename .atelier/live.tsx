/**
 * The client, mounted the way the app mounts it — shared by every round that needs
 * a real screen rather than a drawing of one.
 *
 * This file is **context, not subject**, and it is deliberately not frozen. A round
 * that reaches into live code should see today's version of it: a mockup rendering
 * live components inside a provider stack copied months ago is the worst of both,
 * because the components move and the plumbing does not. So when `main.tsx` grows a
 * provider, this grows one too, and the rounds follow.
 *
 * The cost, stated plainly because nothing else states it: **old rounds will stop
 * rendering.** A round that imports from here is alive, not archived — it holds up
 * until the app moves far enough, and then it fails. What survives is its
 * `saved/*.json` and its notes. That is the price of it having been accurate on the
 * day it was made, which is the only thing that made it worth looking at.
 *
 * Rounds import this by alias — `@atelier/live`, wired in `atelier.config.json` —
 * because a round sits at whatever depth the month and study put it, and counting
 * `../../..` back to here would break the moment anything is renamed.
 */

import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { routeTree } from '@client/routes'

/** URL fragment → what the endpoint answers with. Replaced on every `serve()`. */
let table: Record<string, unknown> = {}

/**
 * Answer the engine's endpoints from fixtures, and let everything else through.
 *
 * Mock the wire, not the hook. The client decodes every response through its DTO
 * schemas (`api/`), and that decode is worth keeping: it is what caught a
 * round arguing about `Failed — checks never passed` when the wire only permits
 * `agent | provider | worktree | engine`. Stub a hook instead and a design can show
 * a state the engine cannot produce, indefinitely, with nothing to say so.
 *
 * Not MSW, which is what the tests use. Theirs is `setupServer` — Node interceptors,
 * no use in a browser — and MSW's browser half wants a service worker served from
 * this frame's origin, which belongs to atelier rather than to orkestra.
 *
 * Seeding the query cache instead of this looks equivalent and is not: `useTraks`
 * sets `refetchInterval`, so a polling screen re-asks within seconds and starts
 * truthfully reporting that the engine is unreachable.
 *
 * **Delegate everything unmatched.** Vite's HMR and module graph go through `fetch`
 * too, so a stub that answers or swallows anything it does not recognise takes the
 * dev server down with it.
 */
export function serve(routes: Record<string, unknown>): void {
  table = routes
}

const passthrough = globalThis.fetch.bind(globalThis)
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const hit = Object.entries(table).find(([path]) => url.includes(path))
  if (hit === undefined) return passthrough(input, init)
  return Promise.resolve(
    new Response(JSON.stringify(hit[1]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}) as typeof globalThis.fetch

/**
 * The real route tree under a memory history, which is how the page tests mount it
 * and for the reason `routes.ts` gives: a page is a route component, so rendering
 * one outside the tree it belongs to is showing something else.
 *
 * A fresh `QueryClient` per render, `retry: false` — the rule `client-style` holds
 * the tests to, and here it also stops a knob change leaving the last fixture behind.
 *
 * `at` is the address to open, so one wrapper serves every screen: `/` for the list,
 * `/traks/<id>` for the detail.
 *
 * **`keep` holds the client and the router beyond this mount**, for a round whose knobs do
 * *not* change what the wire answers. Without it a knob change mints a new client, so the
 * screen blanks to its loading state and redraws — a flicker under a moving slider, and a
 * knob sweep that compares two loading states. Kept, the answer is already in the cache
 * when the page mounts again and it draws straight away.
 *
 * It is module-level rather than a ref, because a round that needs this usually also
 * needs to *remount* the page on a knob change: a route component behind
 * `RouterProvider` does not re-render because its parent did, so the injected replacement
 * would go on closing over the knob values it was created with. Give `<App>` a `key` off
 * the knobs and this is what stops the remount costing a fetch.
 *
 * Opt-in, because the default is what a round that *does* change its fixture needs: a
 * kept client holds the last answer under the same key and would go on drawing it. `at`
 * is read on the first kept mount only.
 */
type Kept = { client: QueryClient; router: ReturnType<typeof createRouter> }

const mount = (at: string): Kept => ({
  client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  router: createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [at] }) }),
})

let kept: Kept | undefined

export function App({ at = '/', keep = false }: { at?: string; keep?: boolean }): ReactNode {
  if (keep && kept === undefined) kept = mount(at)
  const { client, router } = keep && kept !== undefined ? kept : mount(at)

  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
