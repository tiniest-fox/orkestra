// Hook that tracks document visibility state for polling control.

import { useEffect, useState } from "react";

/**
 * Returns true when the page is visible, false when hidden.
 * Used to pause polling when the app is in the background.
 */
export function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(() => document.visibilityState === "visible");

  useEffect(() => {
    const handler = () => setIsVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  return isVisible;
}
