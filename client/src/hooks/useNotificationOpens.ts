/**
 * Route a notification click the service worker hands this page by the back-stack rule —
 * `api/worker.ts` says why the worker sends a message rather than steering the page.
 *
 * Kind `hook`: no JSX, and nothing fetched.
 */

import { useEffect } from "react"
import { useRouter } from "@tanstack/react-router"
import { watchOpens } from "../api/worker"
import { open } from "../backStack"

export const useNotificationOpens = (): void => {
  const router = useRouter()
  useEffect(() => watchOpens((url) => open(router.history, url, window.location.origin)), [router])
}
