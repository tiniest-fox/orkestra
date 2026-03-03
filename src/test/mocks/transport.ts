//! Mock transport for tests — replaces invoke() mocking with transport.call() mocking.

import { vi } from "vitest";
import type { Transport } from "../../transport/types";
import type { ProjectInfo } from "../../types/project";
import type { WorkflowConfig, WorkflowTask, WorkflowTaskView } from "../../types/workflow";

// ============================================================================
// Mock transport implementation
// ============================================================================

export const mockTransportCall = vi.fn<Transport["call"]>();
export const mockTransportOn = vi.fn<Transport["on"]>();

mockTransportOn.mockReturnValue(() => {});

export const mockTransport: Transport = {
  call: mockTransportCall as Transport["call"],
  on: mockTransportOn as Transport["on"],
  connectionState: "connected",
  onConnectionStateChange: vi.fn(() => () => {}),
  supportsLocalOperations: true,
  requiresAuthentication: false,
};

// ============================================================================
// Typed response map
// ============================================================================

type TransportMethod =
  | "list_tasks"
  | "get_archived_tasks"
  | "create_task"
  | "create_subtask"
  | "delete_task"
  | "get_startup_data"
  | "get_pr_status"
  | "get_project_info"
  | "start_run_script"
  | "stop_run_script"
  | "get_run_status"
  | "get_run_logs";

interface ResponseMap {
  list_tasks: WorkflowTaskView[];
  get_archived_tasks: WorkflowTaskView[];
  create_task: WorkflowTask;
  create_subtask: WorkflowTask;
  delete_task: undefined;
  get_startup_data: { config: WorkflowConfig; tasks: WorkflowTaskView[] } | null;
  get_pr_status: {
    url: string;
    state: string;
    checks: unknown[];
    reviews: unknown[];
    fetched_at: string;
  };
  get_project_info: ProjectInfo;
  start_run_script: undefined;
  stop_run_script: undefined;
  get_run_status: { running: boolean; pid: number | null; exit_code: number | null };
  get_run_logs: { lines: string[]; total_lines: number };
}

/**
 * Set up per-method mock return values.
 * Unrecognized methods reject with an error.
 */
export function mockTransportCallResponses(
  responses: Partial<{ [K in TransportMethod]: ResponseMap[K] }>,
): void {
  (mockTransportCall as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
    const key = method as TransportMethod;
    if (key in responses) {
      return Promise.resolve(responses[key]);
    }
    return Promise.reject(new Error(`Unmocked transport method: ${method}`));
  });
}

/**
 * Reset transport mocks with sensible defaults.
 *
 * Tauri-only methods (run_script, etc.) retain their defaults so tests for
 * non-transport code paths continue working.
 */
export function resetTransportMocks(): void {
  (mockTransportCall as ReturnType<typeof vi.fn>).mockReset();
  (mockTransportOn as ReturnType<typeof vi.fn>).mockReset();
  (mockTransportOn as ReturnType<typeof vi.fn>).mockReturnValue(() => {});

  (mockTransportCall as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
    if (method === "get_project_info") {
      return Promise.resolve({
        project_root: "/mock/project",
        has_git: true,
        has_gh_cli: true,
        has_run_script: false,
      } satisfies ProjectInfo);
    }
    if (method === "get_run_status") {
      return Promise.resolve({ running: false, pid: null, exit_code: null });
    }
    if (method === "get_run_logs") {
      return Promise.resolve({ lines: [], total_lines: 0 });
    }
    if (method === "start_run_script" || method === "stop_run_script") {
      return Promise.resolve(undefined);
    }
    return Promise.reject(new Error(`Unmocked transport method: ${method}`));
  });
}
