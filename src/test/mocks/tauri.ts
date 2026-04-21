import { invoke } from "@tauri-apps/api/core";
import type { vi } from "vitest";
import type { ProjectInfo } from "../../types/project";
import type { WorkflowConfig, WorkflowTask, WorkflowTaskView } from "../../types/workflow";

export const mockInvoke = invoke as ReturnType<typeof vi.fn>;

type InvokeCommand =
  | "workflow_get_tasks"
  | "workflow_create_task"
  | "workflow_approve"
  | "workflow_answer_questions"
  | "workflow_get_config"
  | "get_project_info"
  | "start_run_script"
  | "stop_run_script"
  | "get_run_status"
  | "get_run_logs";

interface MockResponseMap {
  workflow_get_tasks: WorkflowTaskView[];
  workflow_create_task: WorkflowTask;
  workflow_approve: WorkflowTask;
  workflow_answer_questions: WorkflowTask;
  workflow_get_config: WorkflowConfig;
  get_project_info: ProjectInfo;
  start_run_script: undefined;
  stop_run_script: undefined;
  get_run_status: { running: boolean; pid: number | null; exit_code: number | null };
  get_run_logs: { lines: string[]; total_lines: number };
}

export function mockInvokeResponses(
  responses: Partial<{ [K in InvokeCommand]: MockResponseMap[K] }>,
): void {
  mockInvoke.mockImplementation((cmd: string) => {
    const command = cmd as InvokeCommand;
    if (command in responses) {
      return Promise.resolve(responses[command]);
    }
    return Promise.reject(new Error(`Unmocked command: ${cmd}`));
  });
}

export function resetMocks(): void {
  mockInvoke.mockReset();
  // Default implementation so invoke() always returns a Promise.
  // Without this, callers that chain .then() on invoke() would throw
  // "Cannot read properties of undefined (reading 'then')".
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_project_info") {
      return Promise.resolve({
        project_root: "/mock/project",
        has_git: true,
        has_gh_cli: true,
        has_run_script: false,
      } satisfies ProjectInfo);
    }
    if (cmd === "get_run_status") {
      return Promise.resolve({ running: false, pid: null, exit_code: null });
    }
    if (cmd === "get_run_logs") {
      return Promise.resolve({ lines: [], total_lines: 0 });
    }
    if (cmd === "start_run_script" || cmd === "stop_run_script") {
      return Promise.resolve();
    }
    return Promise.reject(new Error(`Unmocked command: ${cmd}`));
  });
}
