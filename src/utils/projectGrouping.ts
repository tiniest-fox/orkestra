// Pure function that classifies projects into status-based sections for the service view.

import type { Project, ProjectStatus } from "../service/api";

export type ProjectStatusCategory = "running" | "starting" | "stopped" | "error";

export interface ProjectSection {
  name: ProjectStatusCategory;
  label: string;
  projects: Project[];
}

export function categoryForStatus(status: ProjectStatus): ProjectStatusCategory {
  if (status === "running") return "running";
  if (status === "cloning" || status === "starting" || status === "rebuilding") return "starting";
  if (status === "stopped" || status === "stopping" || status === "removing") return "stopped";
  return "error";
}

function byName(a: Project, b: Project): number {
  return a.name.localeCompare(b.name);
}

/**
 * Group projects into status-based sections in a stable display order.
 * Only sections with at least one project are returned.
 * Within each section, projects are sorted alphabetically by name.
 */
export function groupProjectsForService(projects: Project[]): ProjectSection[] {
  const running: Project[] = [];
  const starting: Project[] = [];
  const stopped: Project[] = [];
  const error: Project[] = [];

  for (const project of projects) {
    const cat = categoryForStatus(project.status);
    if (cat === "running") running.push(project);
    else if (cat === "starting") starting.push(project);
    else if (cat === "stopped") stopped.push(project);
    else error.push(project);
  }

  const allSections: ProjectSection[] = [
    { name: "running", label: "RUNNING", projects: running.sort(byName) },
    { name: "starting", label: "STARTING", projects: starting.sort(byName) },
    { name: "stopped", label: "STOPPED", projects: stopped.sort(byName) },
    { name: "error", label: "ERROR", projects: error.sort(byName) },
  ];
  return allSections.filter((s) => s.projects.length > 0);
}
