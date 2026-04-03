//! Tests for ProjectPage — render paths for loading, error, not-found, not-running, and missing-token states.

import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { ProjectPage } from "./ProjectPage";

vi.mock("./api", () => ({
  fetchProjects: vi.fn(),
}));

// Mock WebSocketTransport to avoid real WS connections. Uses a class so it is
// constructable (arrow functions cannot be used with `new` in Vitest spy internals).
vi.mock("../transport/WebSocketTransport", () => {
  class MockWebSocketTransport {
    close = vi.fn();
  }
  return { WebSocketTransport: MockWebSocketTransport };
});

// Hoisted mock controls so individual tests can override connection state.
const { mockConnectionState, mockHasConnected } = vi.hoisted(() => ({
  mockConnectionState: { current: "connecting" as string },
  mockHasConnected: { current: false },
}));

// Mock the transport module so TransportProvider doesn't try to wire a real
// WebSocket connection and useConnectionState doesn't need a real context.
vi.mock("../transport", () => ({
  TransportProvider: ({ children }: { children: ReactNode }) => children,
  useConnectionState: () => mockConnectionState.current,
  useHasConnected: () => mockHasConnected.current,
  useTransport: () => ({ call: () => new Promise(() => {}) }),
  useTransportListener: () => {},
}));

vi.mock("../components/ReconnectingBanner", () => ({
  ReconnectingBanner: () => <div data-testid="reconnecting-banner" />,
}));

// WorkflowConfigProvider and TasksProvider import src/startup.ts — mock to
// provide controlled startupData/startupError values without real signal handler setup.
vi.mock("../startup", () => ({
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
    mockConnectionState.current = "connecting";
    mockHasConnected.current = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.title = "";
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

  it("does not modify document.title in the not-found path", async () => {
    // ProjectAppShell never mounts when the project ID doesn't match — title stays unset.
    mockFetchProjects.mockResolvedValue([
      { id: "other-id", name: "Other", status: "running", token: "tok" },
    ]);
    const { unmount } = renderProjectPage("test-id");
    await waitFor(() => {
      expect(screen.getByText("Project not found")).toBeInTheDocument();
    });
    unmount();
    expect(document.title).toBe("");
  });

  it("sets document.title when ProjectAppShell mounts and resets it on unmount", async () => {
    // The document.title effect in ProjectAppShell depends only on project.name —
    // it fires on first render regardless of transport connection state.
    mockFetchProjects.mockResolvedValue([
      { id: "test-id", name: "MyProject", status: "running", token: "tok" },
    ]);
    const { unmount } = renderProjectPage("test-id");
    await waitFor(() => {
      expect(document.title).toBe("Orkestra | MyProject");
    });
    unmount();
    expect(document.title).toBe("Orkestra | Service");
  });

  it("renders children when hasConnected is true and connected", async () => {
    mockHasConnected.current = true;
    mockConnectionState.current = "connected";
    mockFetchProjects.mockResolvedValue([
      { id: "test-id", name: "MyProject", status: "running", token: "tok" },
    ]);
    renderProjectPage();
    await waitFor(() => {
      expect(document.title).toBe("Orkestra | MyProject");
    });
    // Skeleton should NOT be showing
    expect(screen.queryByText("Connecting to daemon…")).not.toBeInTheDocument();
    expect(screen.queryByText("Reconnecting to daemon…")).not.toBeInTheDocument();
  });

  it("keeps children mounted during disconnect when hasConnected is true", async () => {
    mockHasConnected.current = true;
    mockConnectionState.current = "disconnected";
    mockFetchProjects.mockResolvedValue([
      { id: "test-id", name: "MyProject", status: "running", token: "tok" },
    ]);
    renderProjectPage();
    await waitFor(() => {
      expect(document.title).toBe("Orkestra | MyProject");
    });
    // App stays mounted — no full skeleton shown
    expect(screen.queryByText("Connecting to daemon…")).not.toBeInTheDocument();
    // ReconnectingBanner renders (mocked to avoid framer-motion issues)
    expect(screen.getByTestId("reconnecting-banner")).toBeInTheDocument();
  });
});
