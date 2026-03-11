import { describe, expect, it } from "vitest";
import type { Project } from "../service/api";
import { groupProjectsForService } from "./projectGrouping";

function makeProject(id: string, name: string, status: Project["status"]): Project {
  return { id, name, status };
}

describe("groupProjectsForService", () => {
  it("returns empty array for empty input", () => {
    expect(groupProjectsForService([])).toEqual([]);
  });

  it("returns single section when all projects have same status", () => {
    const projects = [makeProject("1", "alpha", "running"), makeProject("2", "beta", "running")];
    const sections = groupProjectsForService(projects);
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("running");
    expect(sections[0].projects).toHaveLength(2);
  });

  it("returns sections in correct order: running, starting, stopped, error", () => {
    const projects = [
      makeProject("1", "a", "error"),
      makeProject("2", "b", "stopped"),
      makeProject("3", "c", "running"),
      makeProject("4", "d", "starting"),
    ];
    const sections = groupProjectsForService(projects);
    expect(sections.map((s) => s.name)).toEqual(["running", "starting", "stopped", "error"]);
  });

  it("maps cloning to starting section", () => {
    const sections = groupProjectsForService([makeProject("1", "a", "cloning")]);
    expect(sections[0].name).toBe("starting");
  });

  it("maps rebuilding to starting section", () => {
    const sections = groupProjectsForService([makeProject("1", "a", "rebuilding")]);
    expect(sections[0].name).toBe("starting");
  });

  it("maps stopping to stopped section", () => {
    const sections = groupProjectsForService([makeProject("1", "a", "stopping")]);
    expect(sections[0].name).toBe("stopped");
  });

  it("maps removing to stopped section", () => {
    const sections = groupProjectsForService([makeProject("1", "a", "removing")]);
    expect(sections[0].name).toBe("stopped");
  });

  it("sorts projects alphabetically within each section", () => {
    const projects = [
      makeProject("1", "zebra", "running"),
      makeProject("2", "apple", "running"),
      makeProject("3", "mango", "running"),
    ];
    const sections = groupProjectsForService(projects);
    expect(sections[0].projects.map((p) => p.name)).toEqual(["apple", "mango", "zebra"]);
  });

  it("omits empty sections", () => {
    const projects = [makeProject("1", "a", "running"), makeProject("2", "b", "error")];
    const sections = groupProjectsForService(projects);
    expect(sections).toHaveLength(2);
    expect(sections.map((s) => s.name)).toEqual(["running", "error"]);
  });

  it("handles all 8 ProjectStatus values across the four categories", () => {
    const projects = [
      makeProject("1", "a", "running"),
      makeProject("2", "b", "stopped"),
      makeProject("3", "c", "error"),
      makeProject("4", "d", "cloning"),
      makeProject("5", "e", "starting"),
      makeProject("6", "f", "stopping"),
      makeProject("7", "g", "rebuilding"),
      makeProject("8", "h", "removing"),
    ];
    const sections = groupProjectsForService(projects);
    expect(sections).toHaveLength(4);
    const cats = sections.map((s) => s.name);
    expect(cats).toContain("running");
    expect(cats).toContain("starting");
    expect(cats).toContain("stopped");
    expect(cats).toContain("error");
  });

  it("uses correct section labels", () => {
    const projects = [
      makeProject("1", "a", "running"),
      makeProject("2", "b", "starting"),
      makeProject("3", "c", "stopped"),
      makeProject("4", "d", "error"),
    ];
    const sections = groupProjectsForService(projects);
    const labelMap = Object.fromEntries(sections.map((s) => [s.name, s.label]));
    expect(labelMap.running).toBe("RUNNING");
    expect(labelMap.starting).toBe("STARTING");
    expect(labelMap.stopped).toBe("STOPPED");
    expect(labelMap.error).toBe("ERROR");
  });
});
