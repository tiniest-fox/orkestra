import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock constructors via prototype so instances get the right properties
// when called with `new`. Using vi.fn() directly is safe as a constructor
// since it's a real function (not an arrow function).
vi.mock("./TauriTransport", () => {
  const TauriTransport = vi.fn();
  TauriTransport.prototype.supportsLocalOperations = true;
  TauriTransport.prototype.requiresAuthentication = false;
  return { TauriTransport };
});

vi.mock("./WebSocketTransport", () => {
  const WebSocketTransport = vi.fn();
  WebSocketTransport.prototype.supportsLocalOperations = false;
  WebSocketTransport.prototype.requiresAuthentication = true;
  return { WebSocketTransport };
});

import { STORAGE_CURRENT_PROJECT_ID, STORAGE_PROJECTS } from "../constants";
import type { ProjectConfig } from "../types/project";
import { createTransport } from "./factory";
import { TauriTransport } from "./TauriTransport";
import { WebSocketTransport } from "./WebSocketTransport";

const MockTauriTransport = TauriTransport as ReturnType<typeof vi.fn>;
const MockWebSocketTransport = WebSocketTransport as ReturnType<typeof vi.fn>;

function storeProject(project: ProjectConfig): void {
  localStorage.setItem(STORAGE_PROJECTS, JSON.stringify([project]));
  localStorage.setItem(STORAGE_CURRENT_PROJECT_ID, project.id);
}

function storeProjects(projects: ProjectConfig[], currentId: string): void {
  localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(projects));
  localStorage.setItem(STORAGE_CURRENT_PROJECT_ID, currentId);
}

describe("createTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
    history.replaceState(null, "", "/");
  });

  it("returns TauriTransport when TAURI_ENV_PLATFORM is set and no remote URL is set", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "macos");

    const transport = createTransport();

    expect(MockTauriTransport).toHaveBeenCalledOnce();
    expect(MockWebSocketTransport).not.toHaveBeenCalled();
    expect(transport.supportsLocalOperations).toBe(true);
    expect(transport.requiresAuthentication).toBe(false);
  });

  it("returns WebSocketTransport when TAURI_ENV_PLATFORM is set but remote URL is set", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "macos");
    storeProject({
      id: "proj-1",
      url: "ws://remote.example.com/ws",
      token: "secret-token",
      projectName: "",
      projectRoot: "",
    });

    const transport = createTransport();

    expect(MockWebSocketTransport).toHaveBeenCalledOnce();
    expect(MockWebSocketTransport).toHaveBeenCalledWith(
      "ws://remote.example.com/ws",
      "secret-token",
    );
    expect(MockTauriTransport).not.toHaveBeenCalled();
    expect(transport.supportsLocalOperations).toBe(false);
    expect(transport.requiresAuthentication).toBe(true);
  });

  it("returns WebSocketTransport when TAURI_ENV_PLATFORM is absent (PWA context)", () => {
    // TAURI_ENV_PLATFORM is undefined by default — no stub needed.

    const transport = createTransport();

    expect(MockWebSocketTransport).toHaveBeenCalledOnce();
    expect(MockWebSocketTransport).toHaveBeenCalledWith("ws://localhost:3847/ws", "");
    expect(MockTauriTransport).not.toHaveBeenCalled();
    expect(transport.supportsLocalOperations).toBe(false);
    expect(transport.requiresAuthentication).toBe(true);
  });

  it("uses URL ?project= param project over localStorage default", () => {
    const urlProject: ProjectConfig = {
      id: "url-proj",
      url: "ws://url-project.example.com/ws",
      token: "url-token",
      projectName: "",
      projectRoot: "",
    };
    const storedProject: ProjectConfig = {
      id: "stored-proj",
      url: "ws://stored-project.example.com/ws",
      token: "stored-token",
      projectName: "",
      projectRoot: "",
    };
    storeProjects([urlProject, storedProject], storedProject.id);
    history.replaceState(null, "", `/?project=${urlProject.id}`);

    createTransport();

    expect(MockWebSocketTransport).toHaveBeenCalledWith(
      "ws://url-project.example.com/ws",
      "url-token",
    );
  });

  it("falls back to localStorage default when URL project ID does not match any project", () => {
    const stored: ProjectConfig = {
      id: "stored-proj",
      url: "ws://stored.example.com/ws",
      token: "stored-token",
      projectName: "",
      projectRoot: "",
    };
    storeProject(stored);
    history.replaceState(null, "", "/?project=non-existent-id");

    createTransport();

    expect(MockWebSocketTransport).toHaveBeenCalledWith(
      "ws://stored.example.com/ws",
      "stored-token",
    );
  });
});
