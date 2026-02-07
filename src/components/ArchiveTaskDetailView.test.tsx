import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockArtifact,
  createMockWorkflowConfig,
  createMockWorkflowTaskView,
} from "../test/mocks/fixtures";
import { resetMocks } from "../test/mocks/tauri";
import { ArchiveTaskDetailView } from "./ArchiveTaskDetailView";

const mockConfig = createMockWorkflowConfig();

// Mock the providers
vi.mock("../providers", () => ({
  useWorkflowConfig: () => mockConfig,
}));

// Mock useLogs hook
vi.mock("../hooks/useLogs", () => ({
  useLogs: () => ({
    logs: [],
    isLoading: false,
    error: null,
    stagesWithLogs: [],
    activeLogStage: null,
    setActiveLogStage: vi.fn(),
    reset: vi.fn(),
  }),
}));

describe("ArchiveTaskDetailView", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("renders task details without action buttons", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "archived" },
      derived: { is_archived: true },
    });

    await act(async () => {
      render(<ArchiveTaskDetailView task={task} onClose={() => {}} />);
    });

    expect(screen.getByText("Test Task")).toBeInTheDocument();

    // Verify no action buttons
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reject/i })).not.toBeInTheDocument();
  });

  it("shows all tabs", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "archived" },
      artifacts: {
        plan: createMockArtifact("plan", "Plan content"),
        summary: createMockArtifact("summary", "Summary content"),
      },
      derived: { is_archived: true },
    });

    await act(async () => {
      render(<ArchiveTaskDetailView task={task} onClose={() => {}} />);
    });

    // Should have Details, Activity, Logs, Artifacts tabs
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Artifacts" })).toBeInTheDocument();
  });

  it("renders tabs correctly", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "archived" },
      artifacts: {
        plan: createMockArtifact("plan", "Plan content"),
      },
      derived: { is_archived: true },
    });

    await act(async () => {
      render(<ArchiveTaskDetailView task={task} onClose={() => {}} />);
    });

    // Click Details tab (should be default)
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();

    // Click Activity tab
    await act(async () => {
      screen.getByRole("button", { name: "Activity" }).click();
    });
    expect(screen.getByText("No iterations recorded yet.")).toBeInTheDocument();

    // Click Artifacts tab
    await act(async () => {
      screen.getByRole("button", { name: "Artifacts" }).click();
    });
    expect(screen.getByRole("button", { name: "Plan" })).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "archived" },
      derived: { is_archived: true },
    });
    const onClose = vi.fn();

    await act(async () => {
      render(<ArchiveTaskDetailView task={task} onClose={onClose} />);
    });

    // Find and click the close button
    const closeButton = screen.getByRole("button", { name: /close/i });
    await act(async () => {
      closeButton.click();
    });

    expect(onClose).toHaveBeenCalled();
  });
});
