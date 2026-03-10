//! Tests for ProjectPage — render paths for loading, error, not-found, not-running, and missing-token states.

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { ProjectPage } from "./ProjectPage";

vi.mock("./api", () => ({
  fetchProjects: vi.fn(),
}));

// Mock WebSocketTransport to avoid real WS connections in jsdom.
vi.mock("../transport/WebSocketTransport", () => ({
  WebSocketTransport: vi.fn(),
}));

// WorkflowConfigProvider and TasksProvider import src/main.tsx, which calls
// ReactDOM.createRoot() at module level — that crashes in jsdom without a #root element.
vi.mock("../main", () => ({
  startupData: { value: null },
  startupError: { value: null },
}));

const mockFetchProjects = vi.mocked(api.fetchProjects);

function renderProjectPage(id = "test-id") {
  return render(
    <MemoryRouter initialEntries={[`/project/${id}`]}>
      <Routes>
        <Route path="/project/:id" element={<ProjectPage />} />
        <Route path="/" element={<div>Portal</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectPage", () => {
  beforeEach(() => {
    mockFetchProjects.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading skeleton before fetchProjects resolves", () => {
    // Never resolves — stays in loading state
    mockFetchProjects.mockReturnValue(new Promise(() => {}));
    renderProjectPage();
    expect(screen.getByText("Loading project…")).toBeInTheDocument();
  });

  it("shows error message when fetchProjects rejects", async () => {
    mockFetchProjects.mockRejectedValue(new Error("Network failure"));
    renderProjectPage();
    await waitFor(() => {
      expect(screen.getByText("Network failure")).toBeInTheDocument();
    });
    expect(screen.getByText("Back to projects")).toBeInTheDocument();
  });

  it("shows project not found when no project matches the ID", async () => {
    mockFetchProjects.mockResolvedValue([
      { id: "other-id", name: "Other", status: "running", token: "tok" },
    ]);
    renderProjectPage("test-id");
    await waitFor(() => {
      expect(screen.getByText("Project not found")).toBeInTheDocument();
    });
    expect(screen.getByText("Back to projects")).toBeInTheDocument();
  });

  it("shows not-running message when project status is stopped", async () => {
    mockFetchProjects.mockResolvedValue([{ id: "test-id", name: "MyProject", status: "stopped" }]);
    renderProjectPage();
    await waitFor(() => {
      expect(screen.getByText(/MyProject.*stopped/)).toBeInTheDocument();
    });
    expect(screen.getByText("Back to projects")).toBeInTheDocument();
  });

  it("shows token error when project is running but has no token", async () => {
    mockFetchProjects.mockResolvedValue([
      {
        id: "test-id",
        name: "MyProject",
        status: "running",
        token_error: "Token generation failed",
      },
    ]);
    renderProjectPage();
    await waitFor(() => {
      expect(screen.getByText("Token generation failed")).toBeInTheDocument();
    });
    expect(screen.getByText("Back to projects")).toBeInTheDocument();
  });

  it("shows fallback token message when project is running with no token and no token_error", async () => {
    mockFetchProjects.mockResolvedValue([{ id: "test-id", name: "MyProject", status: "running" }]);
    renderProjectPage();
    await waitFor(() => {
      expect(screen.getByText("Waiting for daemon token…")).toBeInTheDocument();
    });
    expect(screen.getByText("Back to projects")).toBeInTheDocument();
  });
});
