import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useDisplayContext } from "../providers";

/**
 * Listens for "focus-task" events emitted by the backend (when a
 * notification fires for a task needing review) and opens the task
 * in the side panel via DisplayContext.
 *
 * Events are window-targeted via emit_to(), so only the project
 * window that owns the task receives the event.
 */
export function useFocusTaskListener() {
  const { focusTask } = useDisplayContext();

  useEffect(() => {
    const unlistenPromise = listen<string>("focus-task", (event) => {
      focusTask(event.payload);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [focusTask]);
}
