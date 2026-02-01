/**
 * Artifacts tab - displays artifacts with stage switching via TabbedPanel.
 */

import { useSmartDefault } from "../../hooks/useSmartDefault";
import type { WorkflowArtifact, WorkflowConfig } from "../../types/workflow";
import { titleCase } from "../../utils/formatters";
import { ArtifactTabs, ExpandablePanel, PanelContainer, TabbedPanel } from "../ui";
import { ArtifactView } from "./ArtifactView";

function ExpandableArtifactView({ artifact }: { artifact: WorkflowArtifact }) {
  return (
    <ExpandablePanel>
      <ArtifactView artifact={artifact} />
    </ExpandablePanel>
  );
}

interface ArtifactsTabProps {
  taskId: string;
  currentStage: string | null;
  artifacts: Record<string, WorkflowArtifact>;
  config: WorkflowConfig;
}

export function ArtifactsTab({ taskId, currentStage, artifacts, config }: ArtifactsTabProps) {
  // Build tabs in stage order from config
  const artifactNames = config.stages
    .map((stage) => stage.artifact)
    .filter((name) => artifacts[name]);

  // Map currentStage (stage name) to the corresponding artifact name
  const currentStageArtifact = config.stages.find((s) => s.name === currentStage)?.artifact ?? null;

  const { selectedItem, setSelectedItem } = useSmartDefault({
    taskId,
    currentStage: currentStageArtifact,
    availableItems: artifactNames,
    isActive: true, // Only mounted when the Artifacts tab is selected
  });

  const activeArtifact = selectedItem ?? "";

  const tabs = artifactNames.map((name) => ({
    id: ArtifactTabs.artifact(name),
    label: titleCase(name),
  }));

  if (tabs.length === 0) {
    return <div className="p-4 text-stone-500 dark:text-stone-400 text-sm">No artifacts yet.</div>;
  }

  return (
    <PanelContainer direction="vertical" padded={true}>
      <TabbedPanel
        tabs={tabs}
        activeTab={activeArtifact ? ArtifactTabs.artifact(activeArtifact) : ""}
        onTabChange={(key) => {
          // Extract raw artifact name from animation key
          const raw = artifactNames.find((n) => ArtifactTabs.artifact(n) === key);
          if (raw) setSelectedItem(raw);
        }}
        size="small"
      >
        <ExpandableArtifactView artifact={artifacts[activeArtifact]} />
      </TabbedPanel>
    </PanelContainer>
  );
}
