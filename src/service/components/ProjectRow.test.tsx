// Tests for ProjectRow — display-only row component with lifted action state.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Project actions" }));
}

describe("ProjectRow", () => {
  beforeEach(() => {
    mockFetchLogs.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
    vi.restoreAllMocks();
  });

  // -- Rendering --

  it("renders project name and status", () => {
    renderRow(runningProject());
    expect(screen.getByText("my-repo")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows error message when status is error", () => {
    renderRow(errorProject());
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
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
});
