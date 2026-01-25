import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, render } from "@testing-library/react";
import { resetMocks, mockInvoke } from "../test/mocks/tauri";
import {
  createMockWorkflowTask,
  createMockArtifact,
  createMockWorkflowConfig,
} from "../test/mocks/fixtures";
import { WorkflowTaskDetailSidebar } from "./WorkflowTaskDetailSidebar";

// Mock the workflow hooks
vi.mock("../hooks/useWorkflow", () => ({
  useWorkflowActions: () => ({
    approve: vi.fn(() => Promise.resolve()),
    reject: vi.fn(() => Promise.resolve()),
    answerQuestions: vi.fn(() => Promise.resolve()),
  }),
  useWorkflowQueries: () => ({
    getIterations: vi.fn(() => Promise.resolve([])),
  }),
}));

describe("WorkflowTaskDetailSidebar", () => {
  const config = createMockWorkflowConfig();

  beforeEach(() => {
    resetMocks();
    // Default mock for iterations query
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "workflow_get_iterations") return Promise.resolve([]);
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });
  });

  it("renders task in planning stage", () => {
    const task = createMockWorkflowTask({
      status: { type: "active", stage: "planning" },
      phase: "idle",
    });

    render(
      <WorkflowTaskDetailSidebar
        task={task}
        config={config}
        onClose={() => {}}
        onTaskUpdated={() => {}}
      />
    );

    expect(screen.getByText("Test Task")).toBeInTheDocument();
    expect(screen.getByText("Planning")).toBeInTheDocument();
  });

  it("renders task awaiting review with approve button", () => {
    const task = createMockWorkflowTask({
      status: { type: "active", stage: "planning" },
      phase: "awaiting_review",
      artifacts: { plan: createMockArtifact("plan", "Plan content") },
    });

    render(
      <WorkflowTaskDetailSidebar
        task={task}
        config={config}
        onClose={() => {}}
        onTaskUpdated={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
  });

  it("renders done task with Done status", () => {
    const task = createMockWorkflowTask({
      status: { type: "done" },
      phase: "idle",
      artifacts: {
        plan: createMockArtifact("plan", "Plan"),
        summary: createMockArtifact("summary", "Summary"),
      },
    });

    render(
      <WorkflowTaskDetailSidebar
        task={task}
        config={config}
        onClose={() => {}}
        onTaskUpdated={() => {}}
      />
    );

    expect(screen.getByText("Test Task")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("renders failed task with error message", () => {
    const task = createMockWorkflowTask({
      status: { type: "failed", error: "Something went wrong" },
      phase: "idle",
    });

    render(
      <WorkflowTaskDetailSidebar
        task={task}
        config={config}
        onClose={() => {}}
        onTaskUpdated={() => {}}
      />
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders blocked task with reason", () => {
    const task = createMockWorkflowTask({
      status: { type: "blocked", reason: "Waiting for dependencies" },
      phase: "idle",
    });

    render(
      <WorkflowTaskDetailSidebar
        task={task}
        config={config}
        onClose={() => {}}
        onTaskUpdated={() => {}}
      />
    );

    expect(screen.getByText(/waiting for dependencies/i)).toBeInTheDocument();
    // "Blocked" appears in both status badge and section heading
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
  });

  it("renders artifact tabs when task has artifacts", () => {
    const task = createMockWorkflowTask({
      status: { type: "active", stage: "work" },
      phase: "idle",
      artifacts: {
        plan: createMockArtifact("plan", "Plan content"),
      },
    });

    render(
      <WorkflowTaskDetailSidebar
        task={task}
        config={config}
        onClose={() => {}}
        onTaskUpdated={() => {}}
      />
    );

    // Should have Details, Plan, Iterations, Logs tabs
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iterations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logs" })).toBeInTheDocument();
  });
});
