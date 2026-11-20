/**
 * What every catalogue entry is rendered inside — the context the client's components
 * assume and none of them create.
 *
 * Without this, any component reaching a router hook dies on `useLinkProps`, which reads a
 * context that is null outside a router. That is not a fault in the component and not
 * something a props type could have warned about: it is a fact about the app that only
 * shows up when something runs.
 *
 * **It supplies context and draws nothing.** Every entry in the catalogue renders inside
 * it, so anything visible here reframes all of them at once, and showing a component
 * unadorned is what the catalogue is for.
 *
 * Three things this deliberately does not do, each of which is the obvious first move:
 *
 *   - **It does not import `routeTree`.** `RouterProvider` renders the *router's* tree, so
 *     the real one would draw the whole application and discard the entry entirely. Worse,
 *     `routes.ts` roots that tree at `AppChrome` — so borrowing it would wrap all sixty
 *     entries in the app's chrome, which is the exact thing the paragraph above forbids.
 *   - **It does not mount `EngineStream`.** `App` puts it above the router; here it would
 *     open a live event stream to the engine from a gallery, once per entry.
 *   - **It does not import `styles.css`.** `.atelier/atelier.config.json` already loads it
 *     for every frame the harness draws.
 *
 * The history is in memory, so a `Link` renders and resolves and clicking one changes
 * nothing — right for a harness, where navigation would take you away from the thing you
 * are looking at.
 */

import { useMemo, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router"

/**
 * One client for the whole gallery, at module scope.
 *
 * Every entry renders inside the same wrapper, so building this per entry would throw the
 * cache away on each move through the catalogue. `retry: false` because a failed request
 * here should surface as one failure rather than three — the same reason the page tests
 * set it.
 */
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

export default function AtelierWrapper({ children }: { children: ReactNode }) {
  /*
   * Rebuilt when `children` changes, which is every knob turn.
   *
   * A router cannot render arbitrary children — it renders its own matched route — so the
   * children have to *be* the route, and the route is baked into the router at creation.
   * The cost is that the entry remounts as you turn a knob, which is invisible for a
   * static specimen and would reset anything holding internal state. A version that keeps
   * the router stable and passes children through a context is the fix if that ever bites.
   */
  const router = useMemo(() => {
    // The component has to close over `children`, so it cannot be hoisted; the remount this
    // rule warns about is the cost the comment above already accepts.
    // oxlint-disable-next-line react/no-unstable-nested-components -- see above
    const rootRoute = createRootRoute({ component: () => <>{children}</> })
    return createRouter({ routeTree: rootRoute, history: createMemoryHistory() })
  }, [children])

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
