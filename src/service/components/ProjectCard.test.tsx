//! Tests for ProjectCard — project lifecycle actions and status display.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { ProjectCard } from "./ProjectCard";

vi.mock("../api", () => ({
  startProject: vi.fn(),
  stopProject: vi.fn(),
  rebuildProject: vi.fn(),
  removeProject: vi.fn(),
}));

const mockStart = vi.mocked(api.startProject);
const mockStop = vi.mocked(api.stopProject);
const mockRebuild = vi.mocked(api.rebuildProject);
const mockRemove = vi.mocked(api.removeProject);

function runningProject() {
  return {
    id: "proj-1",
    name: "my-repo",
    status: "running" as api.ProjectStatus,
  };
}

function stoppedProject() {
  return {
    id: "proj-2",
    name: "other-repo",
    status: "stopped" as api.ProjectStatus,
  };
}

function errorProject() {
  return {
    id: "proj-3",
    name: "broken-repo",
    status: "error" as api.ProjectStatus,
    error_message: "Something went wrong",
  };
}

describe("ProjectCard", () => {
  beforeEach(() => {
    mockStart.mockReset();
    mockStop.mockReset();
    mockRebuild.mockReset();
    mockRemove.mockReset();
    vi.restoreAllMocks();
  });

  // -- Rendering --

  it("renders project name and status", () => {
    render(<ProjectCard project={runningProject()} onRefresh={vi.fn()} />);
    expect(screen.getByText("my-repo")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows error message when status is error", () => {
    render(<ProjectCard project={errorProject()} onRefresh={vi.fn()} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  // -- Action buttons --

  it("shows Stop and Rebuild buttons when running", () => {
    render(<ProjectCard project={runningProject()} onRefresh={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rebuild" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });

  it("shows Start and Rebuild buttons when stopped", () => {
    render(<ProjectCard project={stoppedProject()} onRefresh={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rebuild" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("always shows Remove button", () => {
    render(<ProjectCard project={runningProject()} onRefresh={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  // -- Action handlers --

  it("calls startProject and refreshes on Start click", async () => {
    mockStart.mockResolvedValueOnce(undefined);
    const onRefresh = vi.fn();
    render(<ProjectCard project={stoppedProject()} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(mockStart).toHaveBeenCalledWith("proj-2"));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("calls stopProject and refreshes on Stop click", async () => {
    mockStop.mockResolvedValueOnce(undefined);
    const onRefresh = vi.fn();
    render(<ProjectCard project={runningProject()} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(mockStop).toHaveBeenCalledWith("proj-1"));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("calls rebuildProject on Rebuild click", async () => {
    mockRebuild.mockResolvedValueOnce(undefined);
    const onRefresh = vi.fn();
    render(<ProjectCard project={runningProject()} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Rebuild" }));
    await waitFor(() => expect(mockRebuild).toHaveBeenCalledWith("proj-1"));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("calls removeProject after confirm and refreshes", async () => {
    mockRemove.mockResolvedValueOnce(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onRefresh = vi.fn();
    render(<ProjectCard project={runningProject()} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith("proj-1"));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("does not call removeProject when confirm is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onRefresh = vi.fn();
    render(<ProjectCard project={runningProject()} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(mockRemove).not.toHaveBeenCalled();
  });

  // -- Error handling --

  it("shows inline error and reverts status on action failure", async () => {
    mockStart.mockRejectedValueOnce(new Error("Failed to start"));
    render(<ProjectCard project={stoppedProject()} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Failed to start")).toBeInTheDocument();
    // Status should revert to stopped
    expect(screen.getByText("Stopped")).toBeInTheDocument();
  });
});
