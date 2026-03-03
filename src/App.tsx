//! Root component with transport provider and PWA connection gate.
//!
//! In Tauri, renders directly into the main app tree.
//! In PWA mode, shows the ConnectionPage until credentials are stored,
//! then a loading screen while the WebSocket connects.

import { ConnectionPage } from "./components/ConnectionPage/ConnectionPage";
import { LoadingScreen } from "./components/LoadingScreen";
import { Orkestra } from "./components/Orkestra";
import { Button } from "./components/ui";
import { STORAGE_AUTH_TOKEN, STORAGE_REMOTE_URL } from "./constants";
import {
  GitHistoryProvider,
  PrStatusProvider,
  TasksProvider,
  WorkflowConfigProvider,
} from "./providers";
import { TransportProvider, useConnectionState, useTransport } from "./transport";

// ============================================================================
// Root
// ============================================================================

/**
 * Root component with all providers.
 * TransportProvider is outermost since all providers call useTransport().
 */
function App() {
  return (
    <TransportProvider>
      <AppContent />
    </TransportProvider>
  );
}

export default App;

// ============================================================================
// Content (inside TransportProvider boundary)
// ============================================================================

/**
 * Inner component that can access the transport context.
 *
 * Handles the PWA connection gate:
 * - No stored token → show ConnectionPage (pairing flow)
 * - Token present but WebSocket connecting → show loading screen
 * - Connected (or Tauri) → show the main app
 */
function AppContent() {
  const transport = useTransport();
  const connectionState = useConnectionState();

  // PWA path: gate access behind pairing and WebSocket connection.
  if (transport.requiresAuthentication) {
    const hasStoredToken = !!localStorage.getItem(STORAGE_AUTH_TOKEN);

    if (!hasStoredToken) {
      return <ConnectionPage />;
    }

    if (connectionState === "connecting") {
      return <LoadingScreen message="Connecting to daemon…" />;
    }

    if (connectionState === "disconnected") {
      return (
        <LoadingScreen message="Reconnecting to daemon…">
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => {
              localStorage.removeItem(STORAGE_AUTH_TOKEN);
              localStorage.removeItem(STORAGE_REMOTE_URL);
              window.location.reload();
            }}
          >
            Disconnect
          </Button>
        </LoadingScreen>
      );
    }
  }

  // Tauri path or PWA connected: render the full app tree.
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
