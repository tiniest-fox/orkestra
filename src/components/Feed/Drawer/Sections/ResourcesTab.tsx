// Resources tab — displays all external resources registered by agents across stages.

import { FileText } from "lucide-react";
import type { WorkflowTaskView } from "../../../../types/workflow";
import { formatTimestamp } from "../../../../utils";
import { EmptyState } from "../../../ui/EmptyState";

// ============================================================================
// Component
// ============================================================================

interface ResourcesTabProps {
  task: WorkflowTaskView;
  bodyRef: React.RefObject<HTMLDivElement>;
}

export function ResourcesTab({ task, bodyRef }: ResourcesTabProps) {
  const resources = Object.values(task.resources).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  if (resources.length === 0) {
    return <EmptyState icon={FileText} message="No resources registered." />;
  }

  return (
    <div ref={bodyRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      {resources.map((resource) => (
        <div key={resource.name} className="flex flex-col gap-1">
          <span className="text-forge-mono-sm font-semibold text-text-primary">
            {resource.name}
          </span>
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-forge-mono-sm text-accent truncate"
          >
            {resource.url}
          </a>
          {resource.description && (
            <span className="text-forge-mono-sm text-text-secondary">{resource.description}</span>
          )}
          <span className="text-forge-mono-label text-text-tertiary">
            {resource.stage} · {formatTimestamp(resource.created_at)}
          </span>
        </div>
      ))}
    </div>
  );
}
