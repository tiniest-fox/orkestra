// Shared provider stack mounted in every app entry point (Tauri, PWA, service).
//
// Contains providers that are required regardless of entry point:
//   ToastProvider → WorkflowConfigProvider → TasksProvider → PrStatusProvider → GitHistoryProvider
//
// Providers that stay OUTSIDE this wrapper:
//   - TransportProvider: must be outermost; injected transport differs per entry point
//   - ProjectsProvider (App.tsx only): PWA pairing state, not needed in service mode
//   - ProjectDetailProvider (ProjectPage.tsx only): service-mode project metadata
//   - Connection gates (ReconnectingBanner, ProjectConnectionGate): entry-point-specific UX
//
// Placement relative to connection gates:
//   AppProviders must be INSIDE the connection gate (ProjectConnectionGate in service mode,
//   the hasConnected early-return in App.tsx). The data providers inside make transport
//   calls immediately on mount — mounting them before a connection is established will
//   throw because useTransport() has no context yet.
//
// When adding a new provider, ask:
//   "Does every entry point need this, inside TransportProvider?"
//   → Yes: add it here, in dependency order (dependencies closer to root).
//   → No: add it at the specific entry point that needs it.
//
// Exception — Tauri-only hooks:
//   useOrchestratorWatchdog() is called here despite being Tauri-only. It early-returns
//   immediately in non-Tauri environments (one no-op call per render), which is acceptable
//   to avoid duplicating the call at every Tauri entry point. Apply this exception only for
//   hooks that are truly no-ops outside Tauri — entry-point-specific providers still belong
//   at their specific call site.

import type { ReactNode } from "react";
import { useOrchestratorWatchdog } from "../hooks/useOrchestratorWatchdog";
import { GitHistoryProvider } from "./GitHistoryProvider";
import { PrStatusProvider } from "./PrStatusProvider";
import { TasksProvider } from "./TasksProvider";
import { ToastProvider } from "./ToastProvider";
import { WorkflowConfigProvider } from "./WorkflowConfigProvider";

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  useOrchestratorWatchdog();
  return (
    <ToastProvider>
      <WorkflowConfigProvider>
        <TasksProvider>
          <PrStatusProvider>
            <GitHistoryProvider>{children}</GitHistoryProvider>
          </PrStatusProvider>
        </TasksProvider>
      </WorkflowConfigProvider>
    </ToastProvider>
  );
}
