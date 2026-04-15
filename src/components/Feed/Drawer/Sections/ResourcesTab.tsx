// Resources tab — displays all external resources registered by agents across stages.

import { FileText } from "lucide-react";
import type { WorkflowTaskView } from "../../../../types/workflow";
import { EmptyState } from "../../../ui/EmptyState";
import { ResourceItem } from "./ResourceItem";

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
        <ResourceItem key={resource.name} resource={resource} />
      ))}
    </div>
  );
}
