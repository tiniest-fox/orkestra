//! Container that renders the list of projects or an empty state.

import { Inbox } from "lucide-react";
import { EmptyState } from "../../components/ui";
import type { Project } from "../api";
import { ProjectCard } from "./ProjectCard";

// ============================================================================
// Types
// ============================================================================

interface ProjectListProps {
  projects: Project[];
  onRefresh: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function ProjectList({ projects, onRefresh }: ProjectListProps) {
  if (projects.length === 0) {
    return <EmptyState icon={Inbox} message="No projects yet." description="Add one below." />;
  }

  return (
    <div>
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} onRefresh={onRefresh} />
      ))}
    </div>
  );
}
