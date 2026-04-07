import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockWorkflowConfig, createMockWorkflowTaskView } from "../test/mocks/fixtures";
import { resetMocks } from "../test/mocks/tauri";
import { Orkestra } from "./Orkestra";

const mockConfig = createMockWorkflowConfig();

vi.mock("./Feed", () => ({
  FeedView: ({
    tasks,
    serviceProjectName,
  }: {
    tasks: Array<{ id: string }>;
    serviceProjectName?: string;
  }) => (
    <div data-testid="feed-view">
      Feed: {tasks.length} tasks{serviceProjectName ? `, project: ${serviceProjectName}` : ""}
    </div>
  ),
}));

vi.mock("../providers", () => ({
  useWorkflowConfig: vi.fn(() => mockConfig),
  useWorkflowConfigState: vi.fn(() => ({
    config: mockConfig,
    loading: false,
    error: null,
    retry: vi.fn(),
  })),
  useTasks: vi.fn(() => ({
    tasks: [],
    archivedTasks: [],
    loading: false,
    error: null,
    createTask: vi.fn(),
    createSubtask: vi.fn(),
    deleteTask: vi.fn(),
    refetch: vi.fn(),
  })),
}));

vi.mock("../hooks/useNotificationPermission", () => ({
  useNotificationPermission: () => {},
}));

vi.mock("../hooks/useBrowserNotifications", () => ({
  useBrowserNotifications: () => {},
}));

import { useTasks } from "../providers";

const mockUseTasks = useTasks as ReturnType<typeof vi.fn>;

describe("Orkestra", () => {
  it("renders FeedView", async () => {
    resetMocks();
    await act(async () => {
      render(<Orkestra />);
    });
    expect(screen.getByTestId("feed-view")).toBeInTheDocument();
  });

  it("threads serviceProjectName to FeedView", async () => {
    resetMocks();
    await act(async () => {
      render(<Orkestra serviceProjectName="MyProject" />);
    });
    expect(screen.getByText(/project: MyProject/)).toBeInTheDocument();
  });

  it("passes tasks to FeedView", async () => {
    resetMocks();
    mockUseTasks.mockReturnValue({
      tasks: [createMockWorkflowTaskView({ id: "t1" }), createMockWorkflowTaskView({ id: "t2" })],
      archivedTasks: [],
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

    expect(screen.getByText("Feed: 2 tasks")).toBeInTheDocument();
  });
});
