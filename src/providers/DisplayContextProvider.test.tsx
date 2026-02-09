import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DisplayContextProvider, useDisplayContext } from "./DisplayContextProvider";

function TestComponent() {
  const {
    layout,
    switchToArchive,
    switchToActive,
    showTask,
    showSubtask,
    toggleGitHistory,
    selectCommit,
    toggleAssistant,
    closeDiff,
    showTaskDiff,
    showSubtaskDiff,
    navigateToTask,
  } = useDisplayContext();

  return (
    <div>
      <div data-testid="preset">{layout.preset}</div>
      <div data-testid="is-archive">{String(layout.isArchive)}</div>
      <div data-testid="task-id">{layout.taskId ?? "null"}</div>
      <div data-testid="subtask-id">{layout.subtaskId ?? "null"}</div>
      <div data-testid="commit-hash">{layout.commitHash ?? "null"}</div>
      <button type="button" onClick={switchToArchive}>
        Switch to Archived
      </button>
      <button type="button" onClick={switchToActive}>
        Switch to Active
      </button>
      <button type="button" onClick={() => showTask("task-1")}>
        Show Task
      </button>
      <button type="button" onClick={() => showSubtask("parent-1", "sub-1")}>
        Show Subtask
      </button>
      <button type="button" onClick={toggleGitHistory}>
        Toggle Git History
      </button>
      <button type="button" onClick={() => selectCommit("abc123")}>
        Select Commit
      </button>
      <button type="button" onClick={toggleAssistant}>
        Toggle Assistant
      </button>
      <button type="button" onClick={() => showTaskDiff("task-1")}>
        Show Task Diff
      </button>
      <button type="button" onClick={() => showSubtaskDiff("parent-1", "sub-1")}>
        Show Subtask Diff
      </button>
      <button type="button" onClick={closeDiff}>
        Close Diff
      </button>
      <button type="button" onClick={() => navigateToTask("task-2")}>
        Navigate to Task (no parent)
      </button>
      <button type="button" onClick={() => navigateToTask("sub-2", "parent-2")}>
        Navigate to Task (with parent)
      </button>
    </div>
  );
}

describe("DisplayContextProvider", () => {
  it("defaults to board view", () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    expect(screen.getByTestId("preset")).toHaveTextContent("Board");
    expect(screen.getByTestId("is-archive")).toHaveTextContent("false");
  });

  it("switchToArchive changes isArchive flag", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    expect(screen.getByTestId("is-archive")).toHaveTextContent("false");

    await act(async () => {
      screen.getByText("Switch to Archived").click();
    });

    expect(screen.getByTestId("is-archive")).toHaveTextContent("true");
    expect(screen.getByTestId("preset")).toHaveTextContent("Board");
  });

  it("switchToActive changes isArchive back to false", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    // Switch to archive first
    await act(async () => {
      screen.getByText("Switch to Archived").click();
    });

    expect(screen.getByTestId("is-archive")).toHaveTextContent("true");

    // Switch back to active
    await act(async () => {
      screen.getByText("Switch to Active").click();
    });

    expect(screen.getByTestId("is-archive")).toHaveTextContent("false");
  });

  it("showTask sets Task preset with taskId", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    await act(async () => {
      screen.getByText("Show Task").click();
    });

    expect(screen.getByTestId("preset")).toHaveTextContent("Task");
    expect(screen.getByTestId("task-id")).toHaveTextContent("task-1");
    expect(screen.getByTestId("subtask-id")).toHaveTextContent("null");
  });

  it("showSubtask sets Subtask preset with taskId and subtaskId", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    await act(async () => {
      screen.getByText("Show Subtask").click();
    });

    expect(screen.getByTestId("preset")).toHaveTextContent("Subtask");
    expect(screen.getByTestId("task-id")).toHaveTextContent("parent-1");
    expect(screen.getByTestId("subtask-id")).toHaveTextContent("sub-1");
  });

  it("toggleGitHistory toggles between Board and GitHistory", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    expect(screen.getByTestId("preset")).toHaveTextContent("Board");

    // First toggle: Board → GitHistory
    await act(async () => {
      screen.getByText("Toggle Git History").click();
    });

    expect(screen.getByTestId("preset")).toHaveTextContent("GitHistory");

    // Second toggle: GitHistory → Board
    await act(async () => {
      screen.getByText("Toggle Git History").click();
    });

    expect(screen.getByTestId("preset")).toHaveTextContent("Board");
  });

  it("selectCommit sets GitCommit preset with hash", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    await act(async () => {
      screen.getByText("Select Commit").click();
    });

    expect(screen.getByTestId("preset")).toHaveTextContent("GitCommit");
    expect(screen.getByTestId("commit-hash")).toHaveTextContent("abc123");
  });

  it("toggleAssistant toggles between Board and Assistant", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    expect(screen.getByTestId("preset")).toHaveTextContent("Board");

    // First toggle: Board → Assistant
    await act(async () => {
      screen.getByText("Toggle Assistant").click();
    });

    expect(screen.getByTestId("preset")).toHaveTextContent("Assistant");

    // Second toggle: Assistant → Board
    await act(async () => {
      screen.getByText("Toggle Assistant").click();
    });

    expect(screen.getByTestId("preset")).toHaveTextContent("Board");
  });

  it("closeDiff from TaskDiff returns to Task", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    // Set up TaskDiff state
    await act(async () => {
      screen.getByText("Show Task Diff").click();
    });

    expect(screen.getByTestId("preset")).toHaveTextContent("TaskDiff");
    expect(screen.getByTestId("task-id")).toHaveTextContent("task-1");

    // Close diff
    await act(async () => {
      screen.getByText("Close Diff").click();
    });

    expect(screen.getByTestId("preset")).toHaveTextContent("Task");
    expect(screen.getByTestId("task-id")).toHaveTextContent("task-1");
  });

  it("closeDiff from SubtaskDiff returns to Subtask", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    // Set up SubtaskDiff state
    await act(async () => {
      screen.getByText("Show Subtask Diff").click();
    });

    expect(screen.getByTestId("preset")).toHaveTextContent("SubtaskDiff");
    expect(screen.getByTestId("task-id")).toHaveTextContent("parent-1");
    expect(screen.getByTestId("subtask-id")).toHaveTextContent("sub-1");

    // Close diff
    await act(async () => {
      screen.getByText("Close Diff").click();
    });

    expect(screen.getByTestId("preset")).toHaveTextContent("Subtask");
    expect(screen.getByTestId("task-id")).toHaveTextContent("parent-1");
    expect(screen.getByTestId("subtask-id")).toHaveTextContent("sub-1");
  });

  it("navigateToTask with parentId sets Subtask preset", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    await act(async () => {
      screen.getByText("Navigate to Task (with parent)").click();
    });

    expect(screen.getByTestId("preset")).toHaveTextContent("Subtask");
    expect(screen.getByTestId("task-id")).toHaveTextContent("parent-2");
    expect(screen.getByTestId("subtask-id")).toHaveTextContent("sub-2");
  });

  it("navigateToTask without parentId sets Task preset", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    await act(async () => {
      screen.getByText("Navigate to Task (no parent)").click();
    });

    expect(screen.getByTestId("preset")).toHaveTextContent("Task");
    expect(screen.getByTestId("task-id")).toHaveTextContent("task-2");
    expect(screen.getByTestId("subtask-id")).toHaveTextContent("null");
  });

  it("archive flag is preserved across preset changes", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    // Switch to archive
    await act(async () => {
      screen.getByText("Switch to Archived").click();
    });

    expect(screen.getByTestId("is-archive")).toHaveTextContent("true");

    // Navigate to a task
    await act(async () => {
      screen.getByText("Show Task").click();
    });

    // Archive flag should be preserved
    expect(screen.getByTestId("is-archive")).toHaveTextContent("true");
    expect(screen.getByTestId("preset")).toHaveTextContent("Task");
  });
});
