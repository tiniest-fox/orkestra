// Pushes a browser history sentinel when a drawer opens so the back button closes it instead of navigating.

import { useEffect, useRef } from "react";

const IS_TAURI = Boolean(import.meta.env.TAURI_ENV_PLATFORM);

/**
 * When `drawerOpen` becomes true, pushes a sentinel history entry so the browser
 * back button closes the drawer instead of navigating away. When the drawer closes
 * via UI (Escape, X, swipe), removes the sentinel via `history.back()`.
 *
 * No-ops in Tauri desktop mode where there is no browser back button.
 */
export function useDrawerHistory(drawerOpen: boolean, closeAll: () => void): void {
  const historyPushedRef = useRef(false);

  // Push/pop sentinel on drawer open/close.
  useEffect(() => {
    if (IS_TAURI) return;

    if (drawerOpen && !historyPushedRef.current) {
      history.pushState({ orkestra_drawer: true }, "");
      historyPushedRef.current = true;
    } else if (!drawerOpen && historyPushedRef.current) {
      // Drawer was closed via UI — remove the sentinel entry.
      // Clear the ref first so the resulting popstate event is ignored.
      historyPushedRef.current = false;
      history.back();
    }
  }, [drawerOpen]);

  // Handle browser back button pressing the sentinel entry off the stack.
  useEffect(() => {
    if (IS_TAURI) return;

    function onPopState() {
      if (!historyPushedRef.current) {
        // Ref is already false: either UI already closed (we called history.back())
        // or no sentinel was pushed. Either way, let normal navigation proceed.
        return;
      }
      // Back button was pressed while drawer is open — close the drawer.
      historyPushedRef.current = false;
      closeAll();
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [closeAll]);
}
