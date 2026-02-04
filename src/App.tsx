import { Orkestra } from "./components/Orkestra";
import {
  AutoTaskTemplatesProvider,
  DisplayContextProvider,
  TasksProvider,
  WorkflowConfigProvider,
} from "./providers";

/**
 * Root component with all providers.
 * Initialization now happens in main.tsx before React mounts.
 */
function App() {
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
