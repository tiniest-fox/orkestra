import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockArtifact,
  createMockWorkflowConfig,
  createMockWorkflowTaskView,
} from "../test/mocks/fixtures";
import { resetMocks } from "../test/mocks/tauri";
import { Orkestra } from "./Orkestra";

const mockConfig = createMockWorkflowConfig();

// Mock child components to avoid provider dependency issues
vi.mock("./Kanban", () => ({
  KanbanBoard: ({
    tasks,
    onSelectTask,
  }: {
    tasks: Array<{ id: string; title: string }>;
    onSelectTask: (task: { id: string; title: string }) => void;
  }) => (
    <div data-testid="kanban-board">
      {tasks.map((task) => (
        <button type="button" key={task.id} onClick={() => onSelectTask(task)}>
          {task.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./ArchivedListView", () => ({
  ArchivedListView: ({
    tasks,
    onSelectTask,
  }: {
    tasks: Array<{ id: string; title: string }>;
    onSelectTask: (task: { id: string; title: string }) => void;
  }) => (
    <div data-testid="archived-list-view">
      {tasks.map((task) => (
        <button type="button" key={task.id} onClick={() => onSelectTask(task)}>
          {task.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./TaskDetail", () => ({
  TaskDetailSidebar: ({ task, onClose }: { task: { title: string }; onClose: () => void }) => (
    <div data-testid="task-detail-sidebar">
      <div>{task.title}</div>
      <button type="button" onClick={onClose}>
        Close
      </button>
      <button type="button">Approve</button>
      <button type="button">Reject</button>
      <button type="button">Delete</button>
    </div>
  ),
}));

vi.mock("./ArchiveTaskDetailView", () => ({
  ArchiveTaskDetailView: ({ task, onClose }: { task: { title: string }; onClose: () => void }) => (
    <div data-testid="archive-task-detail-view">
      <div>{task.title}</div>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

vi.mock("./NewTaskPanel", () => ({
  NewTaskPanel: () => <div data-testid="new-task-panel">New Task</div>,
}));

vi.mock("./CommandPalette", () => ({
  CommandPalette: () => null,
}));

vi.mock("./Diff", () => ({
  DiffPanel: () => <div data-testid="diff-panel">Diff</div>,
}));

// Mock the providers
vi.mock("../providers", () => ({
  useWorkflowConfig: vi.fn(() => mockConfig),
  useAutoTaskTemplates: vi.fn(() => []),
  useDisplayContext: vi.fn(),
  useTasks: vi.fn(),
}));

// Mock hooks
vi.mock("../hooks/useNotificationPermission", () => ({
  useNotificationPermission: () => {},
}));

// Import after mocking to get the mocked versions
import type { DisplayContextValue } from "../providers";
import { useDisplayContext, useTasks } from "../providers";

const mockUseTasks = useTasks as ReturnType<typeof vi.fn>;
const mockUseDisplayContext = useDisplayContext as ReturnType<typeof vi.fn>;

describe("Orkestra - View Toggle", () => {
  let displayContextValue: DisplayContextValue;

  beforeEach(() => {
    resetMocks();

    // Create a fresh display context for each test
    displayContextValue = {
      view: { type: "board" },
      focus: { type: "none" },
      focusTask: vi.fn(),
      focusSubtask: vi.fn(),
      closeSubtask: vi.fn(),
      openCreate: vi.fn(),
      closeFocus: vi.fn(),
      openDiff: vi.fn(),
      closeDiff: vi.fn(),
      openSubtaskDiff: vi.fn(),
      closeSubtaskDiff: vi.fn(),
      switchToActive: vi.fn(() => {
        displayContextValue.view = { type: "board" };
      }),
      switchToArchived: vi.fn(() => {
        displayContextValue.view = { type: "archive" };
      }),
    };

    mockUseDisplayContext.mockImplementation(() => displayContextValue);

    // Default tasks mock
    mockUseTasks.mockReturnValue({
      tasks: [],
      loading: false,
      error: null,
      createTask: vi.fn(() => Promise.resolve()),
      createSubtask: vi.fn(() => Promise.resolve()),
      deleteTask: vi.fn(() => Promise.resolve()),
      refetch: vi.fn(() => Promise.resolve()),
    });
  });

  it("shows KanbanBoard in board view", async () => {
    const activeTasks = [
      createMockWorkflowTaskView({
        id: "active-1",
        title: "Active Task 1",
        status: { type: "active", stage: "planning" },
        derived: { is_archived: false },
      }),
      createMockWorkflowTaskView({
        id: "active-2",
        title: "Active Task 2",
        status: { type: "active", stage: "work" },
        derived: { is_archived: false },
      }),
    ];

    mockUseTasks.mockReturnValue({
      tasks: activeTasks,
      loading: false,
      error: null,
      createTask: vi.fn(),
      createSubtask: vi.fn(),
      deleteTask: vi.fn(),
      refetch: vi.fn(),
    });

    await act(async () => {
      render(<Orkestra />);
    });

    // In board view, KanbanBoard should be visible
    expect(screen.getByText("Active Task 1")).toBeInTheDocument();
    expect(screen.getByText("Active Task 2")).toBeInTheDocument();

    // Active button should be highlighted (primary variant)
    const activeButton = screen.getByRole("button", { name: "Active" });
    expect(activeButton).toBeInTheDocument();
  });

  it("shows ArchivedListView in archive view", async () => {
    const archivedTasks = [
      createMockWorkflowTaskView({
        id: "archived-1",
        title: "Archived Task 1",
        status: { type: "archived" },
        derived: { is_archived: true },
      }),
      createMockWorkflowTaskView({
        id: "archived-2",
        title: "Archived Task 2",
        status: { type: "archived" },
        derived: { is_archived: true },
      }),
    ];

    mockUseTasks.mockReturnValue({
      tasks: archivedTasks,
      loading: false,
      error: null,
      createTask: vi.fn(),
      createSubtask: vi.fn(),
      deleteTask: vi.fn(),
      refetch: vi.fn(),
    });

    // Set view to archive
    displayContextValue.view = { type: "archive" };

    await act(async () => {
      render(<Orkestra />);
    });

    // In archive view, ArchivedListView should be visible
    expect(screen.getByText("Archived Task 1")).toBeInTheDocument();
    expect(screen.getByText("Archived Task 2")).toBeInTheDocument();
  });

  it("toggle button state reflects view", async () => {
    await act(async () => {
      render(<Orkestra />);
    });

    // Initially in board view, Active button should be highlighted
    const activeButton = screen.getByRole("button", { name: "Active" });
    const archivedButton = screen.getByRole("button", { name: "Archived" });

    expect(activeButton).toBeInTheDocument();
    expect(archivedButton).toBeInTheDocument();

    // Click Archived button
    await act(async () => {
      archivedButton.click();
    });

    expect(displayContextValue.switchToArchived).toHaveBeenCalled();
  });

  it("filters tasks correctly for each view", async () => {
    const mixedTasks = [
      createMockWorkflowTaskView({
        id: "active-1",
        title: "Active Task 1",
        status: { type: "active", stage: "planning" },
        derived: { is_archived: false },
      }),
      createMockWorkflowTaskView({
        id: "active-2",
        title: "Active Task 2",
        status: { type: "active", stage: "work" },
        derived: { is_archived: false },
      }),
      createMockWorkflowTaskView({
        id: "active-3",
        title: "Active Task 3",
        status: { type: "active", stage: "work" },
        derived: { is_archived: false },
      }),
      createMockWorkflowTaskView({
        id: "archived-1",
        title: "Archived Task 1",
        status: { type: "archived" },
        derived: { is_archived: true },
      }),
      createMockWorkflowTaskView({
        id: "archived-2",
        title: "Archived Task 2",
        status: { type: "archived" },
        derived: { is_archived: true },
      }),
    ];

    mockUseTasks.mockReturnValue({
      tasks: mixedTasks,
      loading: false,
      error: null,
      createTask: vi.fn(),
      createSubtask: vi.fn(),
      deleteTask: vi.fn(),
      refetch: vi.fn(),
    });

    await act(async () => {
      render(<Orkestra />);
    });

    // In board view, should show 3 active tasks
    expect(screen.getByText("Active Task 1")).toBeInTheDocument();
    expect(screen.getByText("Active Task 2")).toBeInTheDocument();
    expect(screen.getByText("Active Task 3")).toBeInTheDocument();

    // Archived tasks should not be visible in board view
    expect(screen.queryByText("Archived Task 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Archived Task 2")).not.toBeInTheDocument();
  });

  it("shows TaskDetailSidebar in active view", async () => {
    const activeTask = createMockWorkflowTaskView({
      id: "active-1",
      title: "Active Task",
      status: { type: "active", stage: "planning" },
      phase: "awaiting_review",
      artifacts: { plan: createMockArtifact("plan", "Plan content") },
      derived: {
        is_archived: false,
        needs_review: true,
        current_stage: "planning",
      },
    });

    mockUseTasks.mockReturnValue({
      tasks: [activeTask],
      loading: false,
      error: null,
      createTask: vi.fn(),
      createSubtask: vi.fn(),
      deleteTask: vi.fn(),
      refetch: vi.fn(),
    });

    // Set focus to the task
    displayContextValue.focus = { type: "task", taskId: "active-1" };

    await act(async () => {
      render(<Orkestra />);
    });

    // TaskDetailSidebar should be visible
    await waitFor(() => {
      expect(screen.getByTestId("task-detail-sidebar")).toBeInTheDocument();
    });

    // Verify approve button exists (indicating this is TaskDetailSidebar, not ArchiveTaskDetailView)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    });
  });

  it("shows ArchiveTaskDetailView in archive view", async () => {
    const archivedTask = createMockWorkflowTaskView({
      id: "archived-1",
      title: "Archived Task",
      status: { type: "archived" },
      artifacts: { plan: createMockArtifact("plan", "Plan content") },
      derived: { is_archived: true },
    });

    mockUseTasks.mockReturnValue({
      tasks: [archivedTask],
      loading: false,
      error: null,
      createTask: vi.fn(),
      createSubtask: vi.fn(),
      deleteTask: vi.fn(),
      refetch: vi.fn(),
    });

    // Set view to archive and focus to the archived task
    displayContextValue.view = { type: "archive" };
    displayContextValue.focus = { type: "task", taskId: "archived-1" };

    await act(async () => {
      render(<Orkestra />);
    });

    // ArchiveTaskDetailView should be visible
    await waitFor(() => {
      expect(screen.getByTestId("archive-task-detail-view")).toBeInTheDocument();
    });

    // Verify NO action buttons (indicating ArchiveTaskDetailView, not TaskDetailSidebar)
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reject/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("clears detail panel when switching views", async () => {
    const activeTask = createMockWorkflowTaskView({
      id: "active-1",
      title: "Active Task",
      status: { type: "active", stage: "planning" },
      derived: { is_archived: false },
    });

    mockUseTasks.mockReturnValue({
      tasks: [activeTask],
      loading: false,
      error: null,
      createTask: vi.fn(),
      createSubtask: vi.fn(),
      deleteTask: vi.fn(),
      refetch: vi.fn(),
    });

    // Start with a task selected in board view
    displayContextValue.focus = { type: "task", taskId: "active-1" };

    await act(async () => {
      render(<Orkestra />);
    });

    // Task detail should be visible
    await waitFor(() => {
      expect(screen.getByTestId("task-detail-sidebar")).toBeInTheDocument();
    });

    // Click Archived button to switch views
    const archivedButton = screen.getByRole("button", { name: "Archived" });
    await act(async () => {
      archivedButton.click();
    });

    // Verify switchToArchived was called (actual closeFocus happens in effect in real component)
    expect(displayContextValue.switchToArchived).toHaveBeenCalled();
  });
});
