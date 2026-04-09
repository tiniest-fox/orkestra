// Tests for ProjectRow — display-only row component with lifted action state.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "../../hooks/useIsMobile";
import * as api from "../api";
import type { ProjectRowProps } from "./ProjectRow";
import { ProjectRow } from "./ProjectRow";

vi.mock("../api", () => ({
  startProject: vi.fn(),
  stopProject: vi.fn(),
  rebuildProject: vi.fn(),
  removeProject: vi.fn(),
  fetchProjectLogs: vi.fn(),
}));

vi.mock("../../hooks/useIsMobile", () => ({
  useIsMobile: vi.fn(() => false),
}));

vi.mock("../../hooks/useAutoScroll", () => ({
  useAutoScroll: () => ({
    containerRef: vi.fn(),
    handleScroll: vi.fn(),
    resetAutoScroll: vi.fn(),
  }),
}));

const mockFetchLogs = vi.mocked(api.fetchProjectLogs);

function renderRow(project: api.Project, overrides?: Partial<ProjectRowProps>) {
  const defaultProps: ProjectRowProps = {
    project,
    effectiveStatus: project.status,
    busy: false,
    actionError: null,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onRebuild: vi.fn(),
    onRemove: vi.fn(),
    onOpen: vi.fn(),
    onGitFetch: vi.fn(),
    onGitPull: vi.fn(),
    onGitPush: vi.fn(),
    onCancel: vi.fn(),
    onManageSecrets: vi.fn(),
    isFocused: false,
    onMouseEnter: vi.fn(),
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <ProjectRow {...defaultProps} />
    </MemoryRouter>,
  );
}

function runningProject(): api.Project {
  return {
    id: "proj-1",
    name: "my-repo",
    status: "running" as api.ProjectStatus,
  };
}

function stoppedProject(): api.Project {
  return {
    id: "proj-2",
    name: "other-repo",
    status: "stopped" as api.ProjectStatus,
  };
}

function errorProject(): api.Project {
  return {
    id: "proj-3",
    name: "broken-repo",
    status: "error" as api.ProjectStatus,
    error_message: "Something went wrong",
  };
}

function projectWithGitStatus(): api.Project {
  return {
    id: "proj-4",
    name: "git-repo",
    status: "running" as api.ProjectStatus,
    git_status: {
      branch: "main",
      sync_status: { ahead: 2, behind: 3 },
    },
  };
}

function projectWithGitStatusNoSync(): api.Project {
  return {
    id: "proj-5",
    name: "git-repo-no-sync",
    status: "running" as api.ProjectStatus,
    git_status: {
      branch: "feature-branch",
    },
  };
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Project actions" }));
}

describe("ProjectRow", () => {
  beforeEach(() => {
    mockFetchLogs.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
    vi.restoreAllMocks();
    vi.mocked(useIsMobile).mockReturnValue(false); // reset to desktop default after restoreAllMocks
    // Resolve immediately so usePolling's run() completes — a never-resolving promise
    // leaves an unresolved async operation that causes Vitest to wait indefinitely.
    // Must be after vi.restoreAllMocks() which would otherwise clear this mock implementation.
    mockFetchLogs.mockResolvedValue([]);
  });

  // -- Rendering --

  it("renders project name", () => {
    renderRow(runningProject());
    expect(screen.getByText("my-repo")).toBeInTheDocument();
  });

  it("shows error message when status is error", () => {
    renderRow(errorProject());
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows focus treatment when isFocused", () => {
    const { container } = renderRow(runningProject(), { isFocused: true });
    const rowButton = container.querySelector(".border-l-accent");
    expect(rowButton).toBeInTheDocument();
  });

  it("does not show focus treatment when not focused", () => {
    const { container } = renderRow(runningProject(), { isFocused: false });
    const rowButton = container.querySelector(".border-l-accent");
    expect(rowButton).not.toBeInTheDocument();
  });

  it("shows actionError when provided", () => {
    renderRow(stoppedProject(), { actionError: "Failed to start" });
    expect(screen.getByText("Failed to start")).toBeInTheDocument();
  });

  it("hides project error_message when actionError is set", () => {
    renderRow(errorProject(), { actionError: "API error" });
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    expect(screen.getByText("API error")).toBeInTheDocument();
  });

  // -- Inline actions --

  it("shows Open and Stop buttons inline for running projects", () => {
    renderRow(runningProject());
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("does not show Open button for stopped projects", () => {
    renderRow(stoppedProject());
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
  });

  it("shows Start button inline for stopped projects", () => {
    renderRow(stoppedProject());
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("shows Start button inline for error projects", () => {
    renderRow(errorProject());
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("shows no inline action buttons for transitioning projects", () => {
    renderRow(
      { id: "p1", name: "transitioning-repo", status: "starting" },
      { effectiveStatus: "starting" },
    );
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Starting...").length).toBeGreaterThan(0);
  });

  it("shows latest log line in Col 3 for transitioning projects after poll resolves", async () => {
    vi.useFakeTimers();
    mockFetchLogs.mockResolvedValue(["Fetching base image..."]);
    renderRow(
      { id: "p1", name: "transitioning-repo", status: "starting" },
      { effectiveStatus: "starting" },
    );

    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText("Fetching base image...")).toBeInTheDocument();
    vi.useRealTimers();
  });

  // -- Overflow menu --

  it("shows Rebuild, View Logs, Remove in overflow menu", () => {
    renderRow(runningProject());
    openMenu();
    expect(screen.getByRole("button", { name: "Rebuild" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Logs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("does not show Stop in overflow menu — only inline for running", () => {
    renderRow(runningProject());
    openMenu();
    // Stop appears inline but not as a menu item; only one Stop button total
    expect(screen.getAllByRole("button", { name: "Stop" })).toHaveLength(1);
  });

  it("does not show Start in overflow menu — only inline for stopped", () => {
    renderRow(stoppedProject());
    openMenu();
    // Start appears inline but not as a menu item; only one Start button total
    expect(screen.getAllByRole("button", { name: "Start" })).toHaveLength(1);
  });

  it("always shows Remove in menu", () => {
    renderRow(stoppedProject());
    openMenu();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("always shows View Logs in menu and opens the logs modal", async () => {
    mockFetchLogs.mockResolvedValue([]);
    renderRow(runningProject());
    openMenu();
    const viewLogsBtn = screen.getByRole("button", { name: "View Logs" });
    expect(viewLogsBtn).toBeInTheDocument();
    fireEvent.click(viewLogsBtn);
    expect(await screen.findByText("my-repo — Logs")).toBeInTheDocument();
  });

  // -- Action callbacks --

  it("calls onStart when Start clicked", () => {
    const onStart = vi.fn();
    renderRow(stoppedProject(), { onStart });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("calls onStop when Stop clicked", () => {
    const onStop = vi.fn();
    renderRow(runningProject(), { onStop });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("calls onRebuild when Rebuild clicked from overflow menu", async () => {
    const onRebuild = vi.fn();
    renderRow(runningProject(), { onRebuild });
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Rebuild" }));
    await waitFor(() => expect(onRebuild).toHaveBeenCalledOnce());
  });

  it("calls onRemove when Remove clicked from overflow menu", async () => {
    const onRemove = vi.fn();
    renderRow(runningProject(), { onRemove });
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledOnce());
  });

  it("opens logs modal when View Logs clicked", async () => {
    mockFetchLogs.mockResolvedValue([]);
    renderRow(runningProject());
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "View Logs" }));
    expect(await screen.findByText("my-repo — Logs")).toBeInTheDocument();
  });

  it("calls onOpen when Open button clicked", () => {
    const onOpen = vi.fn();
    renderRow(runningProject(), { onOpen });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("calls onGitFetch when Fetch clicked from overflow menu", async () => {
    const onGitFetch = vi.fn();
    renderRow(projectWithGitStatus(), { onGitFetch });
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => expect(onGitFetch).toHaveBeenCalledOnce());
  });

  it("calls onGitPull when Pull clicked from overflow menu", async () => {
    const onGitPull = vi.fn();
    renderRow(projectWithGitStatus(), { onGitPull });
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: /^Pull/ }));
    await waitFor(() => expect(onGitPull).toHaveBeenCalledOnce());
  });

  it("calls onGitPush when Push clicked from overflow menu", async () => {
    const onGitPush = vi.fn();
    renderRow(projectWithGitStatus(), { onGitPush });
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: /^Push/ }));
    await waitFor(() => expect(onGitPush).toHaveBeenCalledOnce());
  });

  // -- Git status rendering --

  it("shows branch name when project has git_status", () => {
    renderRow(projectWithGitStatusNoSync());
    expect(screen.getByText("feature-branch")).toBeInTheDocument();
  });

  it("shows ahead indicator when git sync_status.ahead > 0", () => {
    renderRow(projectWithGitStatus());
    expect(screen.getByText("↑2")).toBeInTheDocument();
  });

  it("shows behind indicator when git sync_status.behind > 0", () => {
    renderRow(projectWithGitStatus());
    expect(screen.getByText("↓3")).toBeInTheDocument();
  });

  it("does not show git info when project has no git_status", () => {
    renderRow(runningProject());
    expect(screen.queryByText("main")).not.toBeInTheDocument();
    expect(screen.queryByText(/↑/)).not.toBeInTheDocument();
    expect(screen.queryByText(/↓/)).not.toBeInTheDocument();
  });

  // -- Git action items in overflow menu --

  it("shows Fetch, Pull, Push in overflow menu when project has git_status", () => {
    renderRow(projectWithGitStatus());
    openMenu();
    expect(screen.getByRole("button", { name: "Fetch" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Pull/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Push/ })).toBeInTheDocument();
  });

  it("shows Pull with behind suffix when git sync_status.behind > 0", () => {
    renderRow(projectWithGitStatus());
    openMenu();
    expect(screen.getByRole("button", { name: "Pull ↓3" })).toBeInTheDocument();
  });

  it("shows Push with ahead suffix when git sync_status.ahead > 0", () => {
    renderRow(projectWithGitStatus());
    openMenu();
    expect(screen.getByRole("button", { name: "Push ↑2" })).toBeInTheDocument();
  });

  it("shows git items in overflow menu for running project without git_status", () => {
    renderRow(runningProject());
    openMenu();
    expect(screen.getByRole("button", { name: "Fetch" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Pull/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Push/ })).toBeInTheDocument();
  });

  it("does not show git items in overflow menu for cloning project", () => {
    renderRow({ ...runningProject(), status: "cloning" as api.ProjectStatus });
    openMenu();
    expect(screen.queryByRole("button", { name: "Fetch" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pull/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Push/ })).not.toBeInTheDocument();
  });

  it("shows only Cancel, View Logs, and Remove in overflow menu for transitioning project", () => {
    renderRow(
      { id: "p1", name: "transitioning-repo", status: "starting" },
      { effectiveStatus: "starting" },
    );
    // Menu trigger should be enabled (not disabled) during transitions
    const menuButton = screen.getByRole("button", { name: "Project actions" });
    expect(menuButton).not.toBeDisabled();
    // Open menu
    openMenu();
    // Git operations and Rebuild should be hidden
    expect(screen.queryByRole("button", { name: "Fetch" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pull/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Push/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rebuild" })).not.toBeInTheDocument();
    // Cancel, View Logs, and Remove should be present
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Logs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("shows Cancel in overflow menu for starting project and calls onCancel", () => {
    const onCancel = vi.fn();
    renderRow(
      { id: "p1", name: "starting-repo", status: "starting" },
      { effectiveStatus: "starting", onCancel },
    );
    openMenu();
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    expect(cancelBtn).toBeInTheDocument();
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not show Cancel in overflow menu for running project", () => {
    renderRow(runningProject());
    openMenu();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  // -- Mobile layout --

  it("shows mobile log row below project info for transitioning project on mobile", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    renderRow(
      { id: "p1", name: "transitioning-repo", status: "starting" },
      { effectiveStatus: "starting" },
    );
    // On mobile, the log is rendered in the mobile log row *below* the main row button,
    // not inside the role="button" grid (which is how non-mobile renders it).
    const startingText = screen.getByText("Starting...");
    expect(startingText.closest('[role="button"]')).toBeNull();
  });
});
