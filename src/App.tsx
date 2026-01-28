import { Orkestra } from "./components/Orkestra";
import { StartupErrorScreen } from "./components/StartupErrorScreen";
import { StartupSplashScreen } from "./components/StartupSplashScreen";
import { useStartup } from "./hooks/useStartup";

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

  return <Orkestra />;
}

export default App;
