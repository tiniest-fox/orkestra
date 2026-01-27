import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockArtifact,
  createMockWorkflowConfig,
  createMockWorkflowTask,
} from "../test/mocks/fixtures";
import { mockInvoke, resetMocks } from "../test/mocks/tauri";
import { WorkflowTaskDetailSidebar } from "./WorkflowTaskDetailSidebar";

// Create stable mock functions outside the factory
const mockApprove = vi.fn(() => Promise.resolve());
const mockReject = vi.fn(() => Promise.resolve());
const mockAnswerQuestions = vi.fn(() => Promise.resolve());
const mockRetry = vi.fn(() => Promise.resolve());
const mockGetIterations = vi.fn(() => Promise.resolve([]));
const mockGetArtifact = vi.fn(() => Promise.resolve(null));
const mockGetPendingQuestions = vi.fn(() => Promise.resolve([]));
const mockGetCurrentStage = vi.fn(() => Promise.resolve(null));
const mockGetRejectionFeedback = vi.fn(() => Promise.resolve(null));
const mockGetLogs = vi.fn(() => Promise.resolve([]));
const mockGetStagesWithLogs = vi.fn(() => Promise.resolve([]));

// Mock the workflow hooks with stable references
vi.mock("../hooks/useWorkflow", () => ({
  useWorkflowActions: () => ({
    approve: mockApprove,
    reject: mockReject,
    answerQuestions: mockAnswerQuestions,
    retry: mockRetry,
  }),
  useWorkflowQueries: () => ({
    getIterations: mockGetIterations,
    getArtifact: mockGetArtifact,
    getPendingQuestions: mockGetPendingQuestions,
    getCurrentStage: mockGetCurrentStage,
    getRejectionFeedback: mockGetRejectionFeedback,
    getLogs: mockGetLogs,
    getStagesWithLogs: mockGetStagesWithLogs,
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
      />,
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
      />,
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
      />,
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
      />,
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
      />,
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
      />,
    );

    // Should have Details, Plan, Activity, Logs tabs
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logs" })).toBeInTheDocument();
  });
});
