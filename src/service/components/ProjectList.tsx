// Container that renders project sections with optional headers and row-based layout.

import type { ProjectSection } from "../../utils/projectGrouping";
import type { ProjectRowActions } from "./ProjectRow";
import { ProjectRow } from "./ProjectRow";

// ============================================================================
// Types
// ============================================================================

interface ProjectListProps {
  sections: ProjectSection[];
  showSectionHeaders: boolean;
  focusedId: string | null;
  onFocusRow: (id: string) => void;
  projectActions: Map<string, ProjectRowActions>;
}

// ============================================================================
// Component
// ============================================================================

export function ProjectList({
  sections,
  showSectionHeaders,
  focusedId,
  onFocusRow,
  projectActions,
}: ProjectListProps) {
  return (
    <div>
      {sections.map((section) => (
        <div key={section.name}>
          {showSectionHeaders && (
            <div className="sticky top-0 z-10 px-6 pt-4 bg-canvas">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-forge-mono-label font-semibold tracking-[0.10em] uppercase text-accent">
                  {section.label}
                </span>
                <span className="font-mono text-forge-mono-label font-medium text-text-quaternary">
                  {section.projects.length}
                </span>
              </div>
              <div className="border-b mt-3 mx-0 border-border" />
            </div>
          )}
          {section.projects.map((project) => {
            const actions = projectActions.get(project.id);
            if (!actions) return null;
            return (
              <ProjectRow
                key={project.id}
                project={project}
                effectiveStatus={actions.effectiveStatus}
                busy={actions.busy}
                actionError={actions.actionError}
                onStart={actions.onStart}
                onStop={actions.onStop}
                onRebuild={actions.onRebuild}
                onRemove={actions.onRemove}
                onOpen={actions.onOpen}
                onGitFetch={actions.onGitFetch}
                onGitPull={actions.onGitPull}
                onGitPush={actions.onGitPush}
                onCancel={actions.onCancel}
                isFocused={focusedId === project.id}
                onMouseEnter={() => onFocusRow(project.id)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
