import type { ReactNode } from "react"
import { RouterProvider } from "@tanstack/react-router"
import { router } from "./routes"
import "./styles.css"

/**
 * The shell: what the app *is*, which is the route tree and the stylesheet. Mounting —
 * finding `#root`, the `QueryClientProvider` — is `main.tsx`'s, so a test can render
 * this without a real DOM root.
 *
 * **Nothing else is here, and everything that was is the root route's component now.**
 * The bar went first: a `Link` reads router context and finds null outside the provider,
 * and the whole app rendered blank. The gate went with it, because the login is drawn
 * *under* the bar with the bar's slot empty, so whatever knows whether this browser is in
 * has to be what draws the bar. The stream goes where the gate goes — an `EventSource`
 * answered 401 closes for good, so it must not be mounted while logged out. See
 * `AppChrome`.
 */
const App = (): ReactNode => <RouterProvider router={router} />

export default App
