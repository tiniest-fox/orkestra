//! Subscribe to a Tauri event with automatic safe cleanup.
//!
//! Handles the race condition where Tauri's IPC resolves the eventId before the
//! injected listen_js_script adds it to the JS-side listener registry. If React
//! unmounts quickly (StrictMode or fast navigation), unlisten() fires against a
//! missing entry. safeUnlisten catches that.

import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { safeUnlisten } from "../utils/safeUnlisten";

/**
 * Subscribe to a Tauri event. Cleans up safely on unmount.
 *
 * The handler is captured by ref so callers don't need to memoize it.
 * Pass `null` as event to disable the listener.
 */
export function useTauriListener<T>(
  event: string | null,
  handler: (payload: T) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!event) return;

    const promise = listen<T>(event, ({ payload }) => {
      handlerRef.current(payload);
    });

    return () => {
      safeUnlisten(promise);
    };
  }, [event]);
}
