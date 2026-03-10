//! Root component with transport provider and PWA connection gate.
//!
//! In Tauri, renders directly into the main app tree.
//! In PWA mode, shows the ConnectionPage until a project is configured,
//! then a loading screen while the WebSocket connects.

import { useEffect } from "react";
import { ConnectionPage } from "./components/ConnectionPage/ConnectionPage";
import { FeedLoadingSkeleton } from "./components/Feed/FeedLoadingSkeleton";
import { Orkestra } from "./components/Orkestra";
import { Button } from "./components/ui";
import {
  GitHistoryProvider,
  ProjectsProvider,
  PrStatusProvider,
  TasksProvider,
  useProjects,
  WorkflowConfigProvider,
} from "./providers";
import { TransportProvider, useConnectionState, useTransport } from "./transport";

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
 * - Project present but WebSocket connecting → show loading screen
 * - Connected (or Tauri) → show the main app
 */
function AppContent() {
  const transport = useTransport();
  const connectionState = useConnectionState();
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
    if (!currentProject || addingProject) {
      return <ConnectionPage onCancel={addingProject ? cancelAddProject : undefined} />;
    }

    if (connectionState === "connecting") {
      return (
        <FeedLoadingSkeleton
          statusText="Connecting to daemon…"
          projectName={currentProject.projectName || undefined}
        />
      );
    }

    if (connectionState === "disconnected") {
      return (
        <FeedLoadingSkeleton
          statusText="Reconnecting to daemon…"
          projectName={currentProject.projectName || undefined}
        >
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => {
              removeProject(currentProject.id);
            }}
          >
            Disconnect
          </Button>
        </FeedLoadingSkeleton>
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
