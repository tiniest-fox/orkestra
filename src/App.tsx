// Root component with transport provider and PWA connection gate.
//
// In Tauri, renders directly into the main app tree.
// In PWA mode, shows the ConnectionPage until a project is configured,
// then a loading screen while the WebSocket connects for the first time.
// After the first successful connection, the provider tree stays mounted
// during reconnects — a ReconnectingBanner overlay shows instead.

import { useEffect } from "react";
import { ConnectionPage } from "./components/ConnectionPage/ConnectionPage";
import { FeedLoadingSkeleton } from "./components/Feed/FeedLoadingSkeleton";
import { Orkestra } from "./components/Orkestra";
import { ReconnectingBanner } from "./components/ReconnectingBanner";
import { Button } from "./components/ui";
import {
  GitHistoryProvider,
  ProjectsProvider,
  PrStatusProvider,
  TasksProvider,
  useProjects,
  WorkflowConfigProvider,
} from "./providers";
import { TransportProvider, useConnectionState, useHasConnected, useTransport } from "./transport";

// ============================================================================
// Root
// ============================================================================

/**
 * Root component with all providers.
 * TransportProvider is outermost since all providers call useTransport().
 * ProjectsProvider is inside TransportProvider so it can call useTransport()
 * to populate project names after first connection.
 */
function App() {
  return (
    <TransportProvider>
      <ProjectsProvider>
        <AppContent />
      </ProjectsProvider>
    </TransportProvider>
  );
}

export default App;

// ============================================================================
// Content (inside TransportProvider and ProjectsProvider boundary)
// ============================================================================

/**
 * Inner component that can access the transport and projects contexts.
 *
 * Handles the PWA connection gate:
 * - No stored project OR actively adding a new project → show ConnectionPage
 * - Project present, never connected yet → show loading skeleton
 * - Has connected before → keep provider tree mounted, show ReconnectingBanner overlay
 * - Tauri → renders directly (useHasConnected returns true immediately)
 */
function AppContent() {
  const transport = useTransport();
  const connectionState = useConnectionState();
  const hasConnected = useHasConnected();
  const { currentProject, addingProject, cancelAddProject, removeProject } = useProjects();

  // All hooks must run unconditionally before any early returns.
  useEffect(() => {
    if (!currentProject) {
      document.title = "Orkestra";
      return;
    }
    if (currentProject.projectName) {
      document.title = `Orkestra | ${currentProject.projectName}`;
      return;
    }
    try {
      const host = new URL(currentProject.url).host;
      document.title = `Orkestra | ${host}`;
    } catch {
      document.title = "Orkestra";
    }
  }, [currentProject]);

  // PWA path: gate access behind pairing and WebSocket connection.
  if (transport.requiresAuthentication) {
    // No project or actively adding one → show pairing flow.
    if (!currentProject || addingProject) {
      return <ConnectionPage onCancel={addingProject ? cancelAddProject : undefined} />;
    }

    // First-time connecting (never connected yet) → show skeleton.
    if (!hasConnected) {
      if (connectionState === "disconnected") {
        // Failed to connect initially — show skeleton with Disconnect button.
        return (
          <FeedLoadingSkeleton
            statusText="Reconnecting to daemon…"
            projectName={currentProject.projectName || undefined}
          >
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => removeProject(currentProject.id)}
            >
              Disconnect
            </Button>
          </FeedLoadingSkeleton>
        );
      }
      return (
        <FeedLoadingSkeleton
          statusText="Connecting to daemon…"
          projectName={currentProject.projectName || undefined}
        />
      );
    }

    // Has connected before → fall through to render provider tree with banner.
  }

  // Tauri path or PWA (post-first-connection): render the full app tree.
  // ReconnectingBanner appears as an overlay during WebSocket disconnects
  // without unmounting the provider tree.
  return (
    <WorkflowConfigProvider>
      <TasksProvider>
        <PrStatusProvider>
          <GitHistoryProvider>
            <ReconnectingBanner />
            <Orkestra />
          </GitHistoryProvider>
        </PrStatusProvider>
      </TasksProvider>
    </WorkflowConfigProvider>
  );
}
