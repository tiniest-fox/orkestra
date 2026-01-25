import { vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { WorkflowTask, WorkflowConfig } from "../../types/workflow";

export const mockInvoke = invoke as ReturnType<typeof vi.fn>;

type InvokeCommand =
  | "workflow_get_tasks"
  | "workflow_create_task"
  | "workflow_approve"
  | "workflow_reject"
  | "workflow_answer_questions"
  | "workflow_get_config"
  | "workflow_get_iterations";

interface MockResponseMap {
  workflow_get_tasks: WorkflowTask[];
  workflow_create_task: WorkflowTask;
  workflow_approve: WorkflowTask;
  workflow_reject: WorkflowTask;
  workflow_answer_questions: WorkflowTask;
  workflow_get_config: WorkflowConfig;
  workflow_get_iterations: unknown[];
}

export function mockInvokeResponses(
  responses: Partial<{ [K in InvokeCommand]: MockResponseMap[K] }>
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
}
