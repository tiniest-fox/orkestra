import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { Orkestra } from "./components/Orkestra";
import {
  AutoTaskTemplatesProvider,
  DisplayContextProvider,
  TasksProvider,
  WorkflowConfigProvider,
} from "./providers";
import type { ProjectInfo } from "./types/project";

/**
 * Root component with all providers.
 * Initialization now happens in main.tsx before React mounts.
 */
function App() {
  // Set window title with project name on mount
  useEffect(() => {
    async function setTitle() {
      try {
        const info = await invoke<ProjectInfo>("get_project_info");
        await getCurrentWindow().setTitle(`${info.display_name} - Orkestra`);
      } catch (err) {
        console.error("Failed to set window title:", err);
        // Non-fatal - window already has a default title
      }
    }
    setTitle();
  }, []);

  return (
    <WorkflowConfigProvider>
      <AutoTaskTemplatesProvider>
        <TasksProvider>
          <DisplayContextProvider>
            <Orkestra />
          </DisplayContextProvider>
        </TasksProvider>
      </AutoTaskTemplatesProvider>
    </WorkflowConfigProvider>
  );
}

export default App;
