// Tests for ResourceLimitsDrawer — rendering states driven by useResourceLimits hook.

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { ResourceLimitsDrawer } from "./ResourceLimitsDrawer";

vi.mock("../api", () => ({
  fetchResourceLimits: vi.fn(),
  updateResourceLimits: vi.fn(),
}));

vi.mock("../../hooks/useIsMobile", () => ({
  useIsMobile: vi.fn(() => false),
}));

const mockFetch = vi.mocked(api.fetchResourceLimits);

const LIMITS: api.ResourceLimits = {
  cpu_limit: 2.0,
  memory_limit_mb: 4096,
  effective_cpu: 2.0,
  effective_memory_mb: 4096,
};

function renderDrawer(overrides?: { projectStatus?: api.ProjectStatus }) {
  return render(
    <ResourceLimitsDrawer
      onClose={vi.fn()}
      projectId="proj-1"
      projectName="my-project"
      projectStatus={overrides?.projectStatus ?? "stopped"}
    />,
  );
}

describe("ResourceLimitsDrawer", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("renders the drawer title", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    renderDrawer();
    expect(screen.getByText("Resource Limits — my-project")).toBeInTheDocument();
  });

  it("shows loading state while fetching", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    renderDrawer();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows form after limits load", async () => {
    mockFetch.mockResolvedValue(LIMITS);
    renderDrawer();
    await waitFor(() => expect(screen.getByLabelText("CPU Limit")).toBeInTheDocument());
    expect(screen.getByLabelText("Memory Limit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset to Defaults" })).toBeInTheDocument();
  });

  it("shows error banner when fetch fails", async () => {
    mockFetch.mockRejectedValue(new Error("connection refused"));
    renderDrawer();
    await waitFor(() => expect(screen.getByText("Error: connection refused")).toBeInTheDocument());
  });

  it("does not show restart banner when project is stopped", async () => {
    mockFetch.mockResolvedValue(LIMITS);
    renderDrawer({ projectStatus: "stopped" });
    await waitFor(() => expect(screen.getByLabelText("CPU Limit")).toBeInTheDocument());
    expect(screen.queryByText(/Restart the project to apply changes/)).not.toBeInTheDocument();
  });

  it("does not show loading state after limits load", async () => {
    mockFetch.mockResolvedValue(LIMITS);
    renderDrawer();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
  });
});
