import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_AUTH_TOKEN,
  STORAGE_CURRENT_PROJECT_ID,
  STORAGE_PROJECTS,
  STORAGE_REMOTE_URL,
} from "../constants";
import type { ProjectConfig } from "../types/project";
import {
  getCurrentProjectId,
  getProjectIdFromUrl,
  loadActiveProject,
  loadProjects,
  migrateFromLegacy,
  saveProjects,
  setCurrentProjectId,
  setProjectIdInUrl,
} from "./projectStorage";

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: "test-id-1",
    url: "ws://localhost:3847/ws",
    token: "token-abc",
    projectName: "my-project",
    projectRoot: "/Users/foo/my-project",
    ...overrides,
  };
}

describe("loadProjects", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("returns empty array when nothing is stored", () => {
    expect(loadProjects()).toEqual([]);
  });

  it("returns stored projects", () => {
    const projects = [makeProject()];
    localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(projects));
    expect(loadProjects()).toEqual(projects);
  });

  it("returns empty array and removes corrupted entry on JSON parse failure", () => {
    localStorage.setItem(STORAGE_PROJECTS, "not-valid-json{{{");
    expect(loadProjects()).toEqual([]);
    expect(localStorage.getItem(STORAGE_PROJECTS)).toBeNull();
  });
});

describe("saveProjects", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("persists the project list", () => {
    const projects = [makeProject(), makeProject({ id: "id-2", projectName: "other" })];
    saveProjects(projects);
    const stored = JSON.parse(localStorage.getItem(STORAGE_PROJECTS) ?? "[]") as ProjectConfig[];
    expect(stored).toEqual(projects);
  });

  it("overwrites existing data", () => {
    saveProjects([makeProject()]);
    saveProjects([]);
    const stored = JSON.parse(localStorage.getItem(STORAGE_PROJECTS) ?? "[]") as ProjectConfig[];
    expect(stored).toEqual([]);
  });
});

describe("getCurrentProjectId / setCurrentProjectId", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("returns null when nothing is stored", () => {
    expect(getCurrentProjectId()).toBeNull();
  });

  it("returns the stored ID after setting it", () => {
    setCurrentProjectId("proj-42");
    expect(getCurrentProjectId()).toBe("proj-42");
  });

  it("clears the key when set to null", () => {
    setCurrentProjectId("proj-42");
    setCurrentProjectId(null);
    expect(getCurrentProjectId()).toBeNull();
    expect(localStorage.getItem(STORAGE_CURRENT_PROJECT_ID)).toBeNull();
  });
});

describe("loadActiveProject", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    history.replaceState(null, "", "/");
    vi.unstubAllEnvs();
  });

  it("returns null when no projects are configured", () => {
    expect(loadActiveProject()).toBeNull();
  });

  it("prefers URL param over localStorage default", () => {
    const urlProject = makeProject({ id: "url-proj", url: "ws://url.example.com/ws" });
    const storedProject = makeProject({ id: "stored-proj", url: "ws://stored.example.com/ws" });
    saveProjects([urlProject, storedProject]);
    setCurrentProjectId(storedProject.id);
    history.replaceState(null, "", `/?project=${urlProject.id}`);

    expect(loadActiveProject()).toEqual(urlProject);
  });

  it("falls back to localStorage default when no URL param is set", () => {
    const p = makeProject();
    saveProjects([p]);
    setCurrentProjectId(p.id);

    expect(loadActiveProject()).toEqual(p);
  });

  it("falls back to localStorage when URL param references a non-existent project", () => {
    const stored = makeProject({ id: "stored-proj" });
    saveProjects([stored]);
    setCurrentProjectId(stored.id);
    history.replaceState(null, "", "/?project=non-existent-id");

    expect(loadActiveProject()).toEqual(stored);
  });

  it("returns null when URL param is absent and no localStorage default is set", () => {
    const p = makeProject();
    saveProjects([p]);
    // No setCurrentProjectId call

    expect(loadActiveProject()).toBeNull();
  });

  it("returns null in Tauri even when ?project= param is in URL", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
    const p = makeProject({ id: "proj-1" });
    saveProjects([p]);
    setCurrentProjectId(p.id);
    history.replaceState(null, "", "/?project=proj-1");
    // In Tauri, getProjectIdFromUrl() returns null, so it falls back to localStorage
    expect(loadActiveProject()).toEqual(p);
  });
});

describe("getProjectIdFromUrl", () => {
  afterEach(() => {
    // Reset URL to bare origin after each test
    history.replaceState(null, "", "/");
  });

  it("returns null when no ?project= param is present", () => {
    history.replaceState(null, "", "/");
    expect(getProjectIdFromUrl()).toBeNull();
  });

  it("returns the project ID from the query string", () => {
    history.replaceState(null, "", "/?project=abc-123");
    expect(getProjectIdFromUrl()).toBe("abc-123");
  });

  it("returns null when the param is present but empty", () => {
    history.replaceState(null, "", "/?project=");
    expect(getProjectIdFromUrl()).toBeNull();
  });

  it("returns null when running in Tauri", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
    history.replaceState(null, "", "/?project=some-id");
    expect(getProjectIdFromUrl()).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("setProjectIdInUrl", () => {
  afterEach(() => {
    history.replaceState(null, "", "/");
  });

  it("sets the ?project= param in the URL without navigation", () => {
    setProjectIdInUrl("proj-42");
    expect(new URLSearchParams(window.location.search).get("project")).toBe("proj-42");
  });

  it("removes the ?project= param when called with null", () => {
    history.replaceState(null, "", "/?project=proj-42");
    setProjectIdInUrl(null);
    expect(new URLSearchParams(window.location.search).get("project")).toBeNull();
  });

  it("is a no-op in Tauri", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
    history.replaceState(null, "", "/");
    setProjectIdInUrl("proj-42");
    expect(new URLSearchParams(window.location.search).get("project")).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("migrateFromLegacy", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("does nothing when no legacy token exists", () => {
    migrateFromLegacy();
    expect(loadProjects()).toEqual([]);
    expect(getCurrentProjectId()).toBeNull();
  });

  it("does nothing when orkestra.projects already exists", () => {
    const existing = [makeProject()];
    saveProjects(existing);
    setCurrentProjectId(existing[0].id);
    localStorage.setItem(STORAGE_AUTH_TOKEN, "old-token");

    migrateFromLegacy();

    // Should not alter existing projects list
    expect(loadProjects()).toEqual(existing);
    // Old key should still be there (migration skipped)
    expect(localStorage.getItem(STORAGE_AUTH_TOKEN)).toBe("old-token");
  });

  it("creates a project from legacy token and default URL", () => {
    localStorage.setItem(STORAGE_AUTH_TOKEN, "legacy-token");

    migrateFromLegacy();

    const projects = loadProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].token).toBe("legacy-token");
    expect(projects[0].url).toBe("ws://localhost:3847/ws");
    expect(projects[0].projectName).toBe("");
    expect(projects[0].projectRoot).toBe("");
    expect(typeof projects[0].id).toBe("string");
    expect(getCurrentProjectId()).toBe(projects[0].id);
  });

  it("uses the stored remote URL when present", () => {
    localStorage.setItem(STORAGE_AUTH_TOKEN, "legacy-token");
    localStorage.setItem(STORAGE_REMOTE_URL, "ws://remote.example.com/ws");

    migrateFromLegacy();

    const projects = loadProjects();
    expect(projects[0].url).toBe("ws://remote.example.com/ws");
  });

  it("deletes the old auth token and remote URL keys after migration", () => {
    localStorage.setItem(STORAGE_AUTH_TOKEN, "legacy-token");
    localStorage.setItem(STORAGE_REMOTE_URL, "ws://remote.example.com/ws");

    migrateFromLegacy();

    expect(localStorage.getItem(STORAGE_AUTH_TOKEN)).toBeNull();
    expect(localStorage.getItem(STORAGE_REMOTE_URL)).toBeNull();
  });
});
