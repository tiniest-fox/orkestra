// Tests for App.tsx — title useEffect branches, Tauri setTitle integration, and serviceProjectName prop.

import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockSetTitle } from "./test/mocks/tauri-window";
import { mockTransportCall } from "./test/mocks/transport";
import type { ProjectInfo } from "./types/project";

// ============================================================================
// Mock setup
// ============================================================================

const mockUseProjects = vi.fn();

vi.mock("./providers", () => ({
  ProjectsProvider: ({ children }: { children: ReactNode }) => children,
  WorkflowConfigProvider: ({ children }: { children: ReactNode }) => children,
  TasksProvider: ({ children }: { children: ReactNode }) => children,
  ToastProvider: ({ children }: { children: ReactNode }) => children,
  PrStatusProvider: ({ children }: { children: ReactNode }) => children,
  GitHistoryProvider: ({ children }: { children: ReactNode }) => children,
  useProjects: () => mockUseProjects(),
}));

vi.mock("./components/Orkestra", () => ({
  Orkestra: ({ serviceProjectName }: { serviceProjectName?: string }) => (
    <div data-testid="orkestra" data-service-project-name={serviceProjectName ?? ""} />
  ),
}));

vi.mock("./components/ReconnectingBanner", () => ({
  ReconnectingBanner: () => null,
}));

vi.mock("./components/ConnectionPage/ConnectionPage", () => ({
  ConnectionPage: () => null,
}));

vi.mock("./components/Feed/FeedLoadingSkeleton", () => ({
  FeedLoadingSkeleton: () => null,
}));

// Static import so IS_TAURI=false is locked in for non-Tauri tests.
import App from "./App";

// ============================================================================
// Helpers
// ============================================================================

const defaultProjectsState = {
  projects: [],
  currentProject: null,
  addingProject: false,
  addProject: vi.fn(),
  removeProject: vi.fn(),
  switchProject: vi.fn(),
  startAddProject: vi.fn(),
  cancelAddProject: vi.fn(),
};

beforeEach(() => {
  mockUseProjects.mockReturnValue(defaultProjectsState);
});

// ============================================================================
// Non-Tauri mode
// ============================================================================

describe("App — non-Tauri mode", () => {
  it("sets default title when no current project", async () => {
    await act(async () => {
      render(<App />);
    });
    expect(document.title).toBe("Orkestra");
    expect(mockSetTitle).not.toHaveBeenCalled();
  });

  it("sets title with project name in PWA mode", async () => {
    mockUseProjects.mockReturnValue({
      ...defaultProjectsState,
      currentProject: {
        id: "1",
        url: "ws://localhost:3847/ws",
        token: "t",
        projectName: "dewey",
        projectRoot: "/path/dewey",
      },
    });
    await act(async () => {
      render(<App />);
    });
    expect(document.title).toBe("Orkestra · dewey");
    expect(mockSetTitle).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tauri mode
// ============================================================================

describe("App — Tauri mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fetches project name and sets native title", async () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
    vi.resetModules();
    const { default: TauriApp } = await import("./App");

    (mockTransportCall as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "get_project_info") {
        return Promise.resolve({
          project_root: "/Users/chris/repos/dewey",
          has_git: true,
          has_gh_cli: false,
          has_run_script: false,
        } satisfies ProjectInfo);
      }
      return Promise.reject(new Error(`Unmocked transport method: ${method}`));
    });

    await act(async () => {
      render(<TauriApp />);
    });

    await waitFor(() => expect(document.title).toBe("Orkestra · dewey"));
    expect(mockSetTitle).toHaveBeenCalledWith("Orkestra · dewey");
  });

  it("gracefully degrades when fetch fails", async () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
    vi.resetModules();
    const { default: TauriApp } = await import("./App");

    (mockTransportCall as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "get_project_info") {
        return Promise.reject(new Error("network error"));
      }
      return Promise.reject(new Error(`Unmocked transport method: ${method}`));
    });

    await act(async () => {
      render(<TauriApp />);
    });

    await waitFor(() => expect(mockSetTitle).toHaveBeenCalled());
    expect(document.title).toBe("Orkestra");
    expect(mockSetTitle).toHaveBeenCalledWith("Orkestra");
  });

  it("threads serviceProjectName to Orkestra after fetch", async () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
    vi.resetModules();
    const { default: TauriApp } = await import("./App");

    (mockTransportCall as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "get_project_info") {
        return Promise.resolve({
          project_root: "/Users/chris/repos/dewey",
          has_git: true,
          has_gh_cli: false,
          has_run_script: false,
        } satisfies ProjectInfo);
      }
      return Promise.reject(new Error(`Unmocked transport method: ${method}`));
    });

    await act(async () => {
      render(<TauriApp />);
    });

    await waitFor(() => {
      const el = screen.getByTestId("orkestra");
      expect(el).toHaveAttribute("data-service-project-name", "dewey");
    });
  });
});
