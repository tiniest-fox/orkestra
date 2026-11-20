/**
 * The URL-to-component map, and nothing else. Kind `routing` in `client-style`'s
 * admission table: the router, the pages and the history the router is given — no data,
 * no loaders, no JSX of its own — the root route's default component is an `<Outlet />`, which is the only
 * reason this file can be a `.ts` at all.
 *
 * **No loaders, deliberately.** Data comes from each feature's hook, so there is
 * exactly one place a trak is fetched and one cache keying it. A loader here would be
 * a second, with its own idea of when to re-ask.
 *
 * Code-based rather than file-based: a few routes do not need a second directory layout
 * competing with the feature-first one, and `createRoute` puts them all in front of you.
 *
 * **The trak route is a child of the list**, which is what makes the detail a drawer
 * *over* the list rather than a page instead of it: the list renders, and `TraksListPage`
 * puts an `<Outlet />` beside it for whatever is open. Flat routes would have meant one
 * feature's page importing another's to draw it behind — the first cross-feature import,
 * for a layout reason. The router is the right place to compose two features.
 */

import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { frameShown } from "./api/frame"
import { withBackStack } from "./backStack"
import AppChrome from "./AppChrome"
import TraksListPage from "./features/traks-list/TraksListPage"
import NewChatPage from "./features/new-trak/NewChatPage"
import NewTrakPage from "./features/new-trak/NewTrakPage"
import TrakDetailPage from "./features/trak-detail/TrakDetailPage"
import GoalPage from "./features/goal/GoalPage"
import NewGoalPage from "./features/goal/NewGoalPage"

/**
 * The app's chrome, and the outlet everything else renders into.
 *
 * A component here rather than the default bare `<Outlet />`, because the bar contains
 * a link and a link needs router context — outside the provider `useLinkProps` reads
 * null and the app renders nothing at all.
 */
const rootRoute = createRootRoute({ component: AppChrome })

/**
 * A **pathless layout route** — `id` rather than `path`, so it contributes nothing to
 * the URL and its children carry their own full paths. That is what lets the list be
 * rendered by a parent of `/traks/$id` without also owning `/`: giving it `path: "/"`
 * and an index child at `"/"` collides, because both resolve to the same id.
 */
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: TraksListPage,
})

/** The list on its own. The parent already drew it; the outlet is simply empty. */
const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  component: () => null,
})

/**
 * The one search param in the app, and the reason there is one.
 *
 * A spawn's piece has no drawer of its own — it is read and acted on inside its parent's —
 * so *which piece* has to survive a link, a reload and a paste, which state in the page
 * cannot. `family.ts` says what the value may be: a position key the rail or the map handed
 * back, or a bare child trak id, which is all the list can name.
 *
 * **Validated rather than trusted.** `validateSearch` is the router's own seam and this is
 * the whole of what goes through it — a string or nothing. It is not a loader and fetches
 * nothing; the value is matched against the family the page already holds.
 */
const trakRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/traks/$id",
  component: TrakDetailPage,
  validateSearch: (search: Record<string, unknown>): { readonly spot?: string } => {
    const spot = search["spot"]
    return typeof spot === "string" && spot !== "" ? { spot } : {}
  },
})

/**
 * A trak that does not exist yet, in the drawer the real one will appear in.
 *
 * Static, and declared beside the dynamic one it would otherwise collide with — the
 * router ranks static segments above parameters, so `/traks/new` never resolves as a
 * trak whose id is `new`. Order here is not the hazard; declaring only one of them
 * would be.
 */
const newTrakRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/traks/new",
  component: NewTrakPage,
})

/** The other door to a trak that does not exist yet — static, for the reason above. */
const newChatRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/traks/chat",
  component: NewChatPage,
})

/** A goal that does not exist yet — static, so it is never read as a goal named `new`. */
const newGoalRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/goals/new",
  component: NewGoalPage,
})

/**
 * A goal, in the drawer a trak opens in — over the list, which holds its banner. Its own
 * path rather than a trak's, because a goal is not a trak.
 */
const goalRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/goals/$id",
  component: GoalPage,
})

/**
 * Exported for the page tests, which mount it under a memory history — a page is a
 * route component, and `TrakDetailPage` reads its id through `getRouteApi`, so
 * rendering one outside the tree it belongs to would be testing something else.
 */
export const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([
    indexRoute,
    newTrakRoute,
    newChatRoute,
    trakRoute,
    newGoalRoute,
    goalRoute,
  ]),
])

/**
 * Under the page's `<base>`, so a host's `/p/x/` is stripped before a route is matched and
 * written back onto every link — `base.ts` says where the prefix comes from. The path is
 * read here rather than through `basePath`, because this file imports the router, the
 * pages and the history and nothing else. With no prefix it is `/`, which the router treats as none.
 */
const basepath = new URL(document.baseURI).pathname

/**
 * The browser's history under the back-stack rule — `backStack.ts` has it — so every link
 * and every `navigate` in the app pushes or replaces by the rule rather than by its own
 * choice.
 */
export const router = createRouter({
  routeTree,
  basepath,
  history: withBackStack(createBrowserHistory(), basepath, frameShown),
})

/**
 * What makes `to="/traks/$id"` and `getRouteApi("/traks/$id")` typed rather than
 * stringly: the router's own types, registered globally. A renamed path is then a
 * compile error at every link and every param read.
 */
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
  /**
   * What one screen hands the next without putting it in the address. `description` is
   * the New Trak page's field filled in ahead of the person — the git bar's request for
   * a merge, which is a paragraph and a list of files, and nothing a link should carry.
   */
  interface HistoryState {
    description?: string
    /** This entry sits over the list, so back — or a close — returns to it. `backStack.ts`. */
    overList?: boolean
  }
}
