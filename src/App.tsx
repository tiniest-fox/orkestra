import { Orkestra } from "./components/Orkestra";
import {
  GitHistoryProvider,
  PrStatusProvider,
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
      <TasksProvider>
        <PrStatusProvider>
          <GitHistoryProvider>
            <Orkestra />
          </GitHistoryProvider>
        </PrStatusProvider>
      </TasksProvider>
    </WorkflowConfigProvider>
  );
}

export default App;
