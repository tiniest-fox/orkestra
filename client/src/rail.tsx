import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import RailPage from "./features/rail/RailPage"
import "./styles.css"

/**
 * A desktop window's own page, and a host's root — `rail.html`'s script, the way
 * `launcher.tsx` is `launcher.html`'s, and for its reasons: one page, one `QueryClient`,
 * no router, no stream and no persistence. The projects on the rail are each the app
 * itself, in a view the shell lays over this page's pane or a frame the page draws; of
 * theirs, only the trak list a host's tile counts from is fetched here.
 */
const queryClient = new QueryClient()

const container = document.getElementById("root")
if (container === null) throw new Error("rail.html is missing #root")

createRoot(container).render(
  <QueryClientProvider client={queryClient}>
    <RailPage />
  </QueryClientProvider>,
)
