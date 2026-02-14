import { Orkestra } from "./components/Orkestra";
import {
  AssistantProvider,
  AutoTaskTemplatesProvider,
  DisplayContextProvider,
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
      <AutoTaskTemplatesProvider>
        <TasksProvider>
          <PrStatusProvider>
            <AssistantProvider>
              <GitHistoryProvider>
                <DisplayContextProvider>
                  <Orkestra />
                </DisplayContextProvider>
              </GitHistoryProvider>
            </AssistantProvider>
          </PrStatusProvider>
        </TasksProvider>
      </AutoTaskTemplatesProvider>
    </WorkflowConfigProvider>
  );
}

export default App;
