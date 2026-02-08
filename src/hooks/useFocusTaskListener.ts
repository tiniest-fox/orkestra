import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useDisplayContext } from "../providers";

/**
 * Listens for "review-ready" events emitted by the backend when tasks need
 * human review and intelligently navigates to the task.
 *
 * Only auto-navigates when the window is backgrounded (not focused). This way,
 * when the user clicks the OS notification and switches back to the app, the
 * right task is already focused. If they're actively working in the window,
 * we don't disrupt them.
 */
export function useFocusTaskListener() {
  const { navigateToTask } = useDisplayContext();

  useEffect(() => {
    const unlistenPromise = listen<{ task_id: string; parent_id: string | null }>(
      "review-ready",
      (event) => {
        // Only auto-navigate when the window is backgrounded.
        // This way, when the user clicks the OS notification and switches
        // back to the app, the right task is already focused.
        // If they're actively working in the window, we don't disrupt them.
        if (!document.hasFocus()) {
          navigateToTask(event.payload.task_id, event.payload.parent_id ?? undefined);
        }
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [navigateToTask]);
}
