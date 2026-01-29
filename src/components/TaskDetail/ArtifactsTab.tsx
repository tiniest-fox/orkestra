/**
 * Artifacts tab - displays artifacts with stage switching via TabbedPanel.
 */

import { useState } from "react";
import type { WorkflowArtifact, WorkflowConfig } from "../../types/workflow";
import { titleCase } from "../../utils/formatters";
import { PanelContainer, TabbedPanel } from "../ui";
import { ArtifactView } from "./ArtifactView";

interface ArtifactsTabProps {
  artifacts: Record<string, WorkflowArtifact>;
  config: WorkflowConfig;
}

export function ArtifactsTab({ artifacts, config }: ArtifactsTabProps) {
  // Build tabs in stage order from config
  const artifactNames = config.stages.map((stage) => stage.artifact).filter((name) => artifacts[name]);

  const [activeArtifact, setActiveArtifact] = useState(artifactNames[0] ?? "");

  // Ensure active artifact is valid
  const resolvedActive = artifactNames.includes(activeArtifact) ? activeArtifact : (artifactNames[0] ?? "");

  const tabs = artifactNames.map((name) => ({
    id: name,
    label: titleCase(name),
  }));

  if (tabs.length === 0) {
    return <div className="p-4 text-stone-500 text-sm">No artifacts yet.</div>;
  }

  return (
    <PanelContainer direction="vertical" padded={true}>
      <TabbedPanel tabs={tabs} activeTab={resolvedActive} onTabChange={setActiveArtifact} size="small">
        <ArtifactView artifact={artifacts[resolvedActive]} />
      </TabbedPanel>
    </PanelContainer>
  );
}
