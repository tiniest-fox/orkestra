import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockTransport, mockTransportCallResponses } from "../test/mocks/transport";
import type { WorkflowTaskView } from "../types/workflow";
import { PrStatusProvider, usePrStatus } from "./PrStatusProvider";
import { useTasks } from "./TasksProvider";

// Mock the TasksProvider
vi.mock("./TasksProvider", () => ({
  useTasks: vi.fn(),
}));

const mockUseTasks = vi.mocked(useTasks);

function createMockTask(id: string, prUrl?: string): WorkflowTaskView {
  return {
    id,
    title: `Task ${id}`,
    description: "Test task",
    state: { type: "done" },
    artifacts: {},
    resources: {},
    depends_on: [],
    base_branch: "main",
    base_commit: "",
    auto_mode: false,
    flow: "default",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    pr_url: prUrl,
    iterations: [],
    stage_sessions: [],
    derived: {
      current_stage: null,
      is_working: false,
      is_system_active: false,
      is_preparing: false,
      phase_icon: null,
      is_interrupted: false,
      is_failed: false,
      is_blocked: false,
      is_done: true,
      is_archived: false,
      is_terminal: true,
      is_waiting_on_children: false,
      needs_review: false,
      has_questions: false,
      pending_questions: [],
      rejection_feedback: null,
      pending_rejection: null,
      pending_approval: false,
      stages_with_logs: [],
      subtask_progress: null,
      is_chatting: false,
      chat_agent_active: false,
      is_interactive: false,
      can_bypass: false,
    },
  };
}

function createMockTasksValue(tasks: WorkflowTaskView[]) {
  return {
    tasks,
    archivedTasks: [],
    loading: false,
    error: null,
    isStale: false,
    createTask: vi.fn(),
    createSubtask: vi.fn(),
    deleteTask: vi.fn(),
    applyOptimistic: vi.fn(),
    refetch: vi.fn(),
  };
}

// Test consumer component to interact with the context
function TestConsumer({ taskId = "task-1" }: { taskId?: string }) {
  const api = usePrStatus();

  return (
    <div>
      <div data-testid="status">{api.getPrStatus(taskId)?.state ?? "none"}</div>
      <div data-testid="loading">{String(api.isLoading(taskId))}</div>
    </div>
  );
}

describe("PrStatusProvider", () => {
  beforeEach(() => {
    // Don't replace mockTransport.call — global beforeEach in setup.ts already calls
    // resetTransportMocks() which sets the default rejection implementation on mockTransportCall.
    // Replacing it here would sever the shared reference that mockTransportCallResponses updates.
    mockUseTasks.mockReturnValue(createMockTasksValue([]));
    // Mock visibility API - always visible for tests
    Object.defineProperty(document, "visibilityState", {
      writable: true,
      value: "visible",
    });
  });

  it("fetches PR status for tasks with pr_url on mount", async () => {
    const task = createMockTask("task-1", "https://github.com/test/repo/pull/1");
    mockUseTasks.mockReturnValue(createMockTasksValue([task]));

    mockTransportCallResponses({
      get_pr_status: {
        url: "https://github.com/test/repo/pull/1",
        state: "open",
        checks: [],
        reviews: [],
        fetched_at: new Date().toISOString(),
      },
    });

    render(
      <PrStatusProvider>
        <TestConsumer />
      </PrStatusProvider>,
    );

    await waitFor(() => {
      expect(mockTransport.call).toHaveBeenCalledWith("get_pr_status", {
        pr_url: "https://github.com/test/repo/pull/1",
      });
    });
  });

  it("updates status after fetch completes", async () => {
    const task = createMockTask("task-1", "https://github.com/test/repo/pull/1");
    mockUseTasks.mockReturnValue(createMockTasksValue([task]));

    mockTransportCallResponses({
      get_pr_status: {
        url: "https://github.com/test/repo/pull/1",
        state: "merged",
        checks: [],
        reviews: [],
        fetched_at: new Date().toISOString(),
      },
    });

    render(
      <PrStatusProvider>
        <TestConsumer />
      </PrStatusProvider>,
    );

    // Initially no status
    expect(screen.getByTestId("status")).toHaveTextContent("none");

    // Wait for status to update
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("merged");
    });
  });

  it("does not fetch for tasks without pr_url", async () => {
    const task = createMockTask("task-1"); // no pr_url
    mockUseTasks.mockReturnValue(createMockTasksValue([task]));

    render(
      <PrStatusProvider>
        <TestConsumer />
      </PrStatusProvider>,
    );

    // Give it time to potentially make a call
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should not have called transport.call since task has no pr_url
    expect(mockTransport.call).not.toHaveBeenCalled();
  });

  it("handles fetch errors gracefully", async () => {
    const task = createMockTask("task-1", "https://github.com/test/repo/pull/1");
    mockUseTasks.mockReturnValue(createMockTasksValue([task]));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockTransport.call = vi
      .fn()
      .mockRejectedValue(new Error("Network error")) as typeof mockTransport.call;

    render(
      <PrStatusProvider>
        <TestConsumer />
      </PrStatusProvider>,
    );

    // Wait for error to be logged
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[PrStatusProvider] Failed to fetch PR status"),
        expect.any(Error),
      );
    });

    // Status should remain undefined (none)
    expect(screen.getByTestId("status")).toHaveTextContent("none");

    consoleSpy.mockRestore();
  });
});
