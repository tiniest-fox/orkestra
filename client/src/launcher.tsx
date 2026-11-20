import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import LauncherPage from "./features/launcher/LauncherPage"
import "./styles.css"

/**
 * The launch window's entry — `launcher.html`'s script, the way `main.tsx` is
 * `index.html`'s. It mounts one page and the one `QueryClient` the page's hooks share,
 * and nothing else: no router, because the window has one screen, no stream, because
 * no engine is running yet, and no persistence, because the list is the shell's file.
 *
 * The stylesheet is imported here rather than through `App`, since `App` is the router
 * and this window has none. Same file, same tokens — that is the whole reason the
 * page is in this package.
 */
const queryClient = new QueryClient()

const container = document.getElementById("root")
if (container === null) throw new Error("launcher.html is missing #root")

createRoot(container).render(
  <QueryClientProvider client={queryClient}>
    <LauncherPage />
  </QueryClientProvider>,
)
