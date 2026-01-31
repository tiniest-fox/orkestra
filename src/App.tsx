import { Orkestra } from "./components/Orkestra";
import { StartupErrorScreen } from "./components/StartupErrorScreen";
import { StartupSplashScreen } from "./components/StartupSplashScreen";
import { useStartup } from "./hooks/useStartup";
import { DisplayContextProvider, TasksProvider, WorkflowConfigProvider } from "./providers";

/**
 * Root component that coordinates startup before rendering the main app.
 */
function App() {
  const { isReady, loading: startupLoading, errors: startupErrors, retry } = useStartup();

  if (startupLoading) {
    return <StartupSplashScreen />;
  }

  if (!isReady) {
    return <StartupErrorScreen errors={startupErrors} onRetry={retry} />;
  }

  return (
    <WorkflowConfigProvider>
      <TasksProvider>
        <DisplayContextProvider>
          <Orkestra />
        </DisplayContextProvider>
      </TasksProvider>
    </WorkflowConfigProvider>
  );
}

export default App;
