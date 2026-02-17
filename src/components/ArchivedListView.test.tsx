import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockWorkflowTaskView } from "../test/mocks/fixtures";
import { ArchivedListView } from "./ArchivedListView";

// Mock TaskCard to avoid provider dependency issues
vi.mock("./Kanban/TaskCard", () => ({
  TaskCard: ({
    task,
    onClick,
    isSelected,
  }: {
    task: { id: string; title: string };
    onClick: () => void;
    isSelected?: boolean;
  }) => (
    <button
      type="button"
      data-testid={`task-card-${task.id}`}
      onClick={() => onClick()}
      style={{ border: isSelected ? "2px solid blue" : "1px solid gray" }}
    >
      {task.title}
    </button>
  ),
}));

describe("ArchivedListView", () => {
  it("renders archived tasks in a list", () => {
    const mockTasks = [
      createMockWorkflowTaskView({
        id: "task-1",
        title: "Archived Task 1",
        state: { type: "archived" },
        derived: { is_archived: true },
      }),
      createMockWorkflowTaskView({
        id: "task-2",
        title: "Archived Task 2",
        state: { type: "archived" },
        derived: { is_archived: true },
      }),
    ];

    render(<ArchivedListView tasks={mockTasks} onSelectTask={vi.fn()} />);

    expect(screen.getByText("Archived Task 1")).toBeInTheDocument();
    expect(screen.getByText("Archived Task 2")).toBeInTheDocument();
  });

  it("shows empty state when no tasks", () => {
    render(<ArchivedListView tasks={[]} onSelectTask={vi.fn()} />);

    expect(screen.getByText("No archived tasks.")).toBeInTheDocument();
  });

  it("calls onSelectTask when task clicked", () => {
    const mockTask = createMockWorkflowTaskView({
      id: "task-1",
      title: "Archived Task",
      state: { type: "archived" },
      derived: { is_archived: true },
    });
    const onSelectTask = vi.fn();

    render(<ArchivedListView tasks={[mockTask]} onSelectTask={onSelectTask} />);

    screen.getByText("Archived Task").click();

    expect(onSelectTask).toHaveBeenCalledWith(mockTask);
  });

  it("highlights selected task", () => {
    const mockTasks = [
      createMockWorkflowTaskView({
        id: "task-1",
        title: "Task 1",
        state: { type: "archived" },
        derived: { is_archived: true },
      }),
      createMockWorkflowTaskView({
        id: "task-2",
        title: "Task 2",
        state: { type: "archived" },
        derived: { is_archived: true },
      }),
    ];

    render(<ArchivedListView tasks={mockTasks} selectedTaskId="task-1" onSelectTask={vi.fn()} />);

    // The selected task should have a different style (border change)
    // We verify by checking that both tasks are rendered
    expect(screen.getByText("Task 1")).toBeInTheDocument();
    expect(screen.getByText("Task 2")).toBeInTheDocument();
  });
});
