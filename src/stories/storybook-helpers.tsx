// Shared helpers for Storybook stories: mock transport, provider wrapper, and global decorator.

import type { Decorator } from "@storybook/react";
import type { ReactNode } from "react";
import { AppProviders } from "../providers/AppProviders";
import { useWorkflowConfigState } from "../providers/WorkflowConfigProvider";
import { createMockWorkflowConfig } from "../test/mocks/fixtures";
import { TransportProvider } from "../transport/TransportProvider";
import type { Transport } from "../transport/types";

// Creates a mock Transport suitable for Storybook stories.
// supportsLocalOperations is false to disable Tauri fast paths and useRunScript.
export function createMockTransport(): Transport {
  return {
    connectionState: "connected",
    supportsLocalOperations: false,
    requiresAuthentication: false,
    onConnectionStateChange: () => () => {},
    on: () => () => {},
    call: <T,>(method: string): Promise<T> => {
      const resolve = (value: unknown): Promise<T> => Promise.resolve(value as T);
      switch (method) {
        case "get_startup_data":
          return resolve({ config: createMockWorkflowConfig(), tasks: [] });
        case "list_tasks":
          return resolve([]);
        case "get_project_info":
          return resolve({ project_root: "/mock/project", project_name: "mock-project" });
        case "get_commit_log":
          return resolve([]);
        case "list_branches":
          return resolve({ current: "main", branches: ["main"] });
        case "git_sync_status":
          return resolve({ ahead: 0, behind: 0 });
        case "get_logs":
          return resolve([]);
        case "get_diff":
          return resolve({ files: [] });
        case "get_branch_commits":
          return resolve([]);
        case "get_batch_file_counts":
          return resolve({});
        default:
          return new Promise(() => {});
      }
    },
  };
}

// Gates rendering until the workflow config is loaded, preventing null-config throws.
function ConfigGate({ children }: { children: ReactNode }) {
  const { config } = useWorkflowConfigState();
  if (!config) return null;
  return <>{children}</>;
}

// Wraps children in the full provider stack required by Orkestra components.
export function StorybookProviders({
  children,
  transport,
}: {
  children: ReactNode;
  transport?: Transport;
}) {
  return (
    <TransportProvider transport={transport ?? createMockTransport()}>
      <AppProviders>
        <ConfigGate>{children}</ConfigGate>
      </AppProviders>
    </TransportProvider>
  );
}

// Global Storybook decorator that wraps every story in StorybookProviders.
export const storybookDecorator: Decorator = (Story) => (
  <StorybookProviders>
    <Story />
  </StorybookProviders>
);
