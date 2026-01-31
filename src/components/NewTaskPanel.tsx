/**
 * NewTaskPanel - Side panel for creating new tasks.
 * Includes a flow picker when alternate flows are defined in the workflow config.
 */

import { FileText, Layers, type LucideIcon, Rocket, Zap } from "lucide-react";
import { useState } from "react";
import { useWorkflowConfig } from "../providers";
import type { FlowConfig } from "../types/workflow";
import { titleCase } from "../utils/formatters";
import { BranchSelector } from "./BranchSelector";
import { Button, Panel } from "./ui";

/** Map of known lucide icon names to components. */
const ICON_MAP: Record<string, LucideIcon> = {
  zap: Zap,
  "file-text": FileText,
  rocket: Rocket,
  layers: Layers,
};

interface NewTaskPanelProps {
  onClose: () => void;
  onSubmit: (
    description: string,
    autoMode: boolean,
    baseBranch: string | null,
    flow?: string,
  ) => Promise<void>;
}

export function NewTaskPanel({ onClose, onSubmit }: NewTaskPanelProps) {
  const config = useWorkflowConfig();
  const [description, setDescription] = useState("");
  const [autoMode, setAutoMode] = useState(false);
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flowEntries = Object.entries(config.flows ?? {});
  const hasFlows = flowEntries.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      await onSubmit(description.trim(), autoMode, baseBranch, selectedFlow);
      // Don't reset form - parent will close the panel
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
      setSubmitting(false);
    }
  };

  return (
    <Panel className="w-[480px]">
      <Panel.Header>
        <Panel.Title>New Task</Panel.Title>
        <Panel.CloseButton onClick={onClose} />
      </Panel.Header>

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
        <Panel.Body className="flex-1" scrollable>
          {error && (
            <div className="p-3 mb-4 bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 rounded-panel-sm text-error-700 dark:text-error-300 text-sm">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-stone-700 dark:text-stone-200 mb-2"
            >
              What do you want to do?
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 border border-stone-300 dark:bg-stone-800 dark:border-stone-600 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none text-stone-800 dark:text-stone-100"
              placeholder="Describe the task..."
              // biome-ignore lint/a11y/noAutofocus: intentional focus for panel UX
              autoFocus
            />
            <BranchSelector value={baseBranch} onChange={setBaseBranch} />
          </div>

          {hasFlows && (
            <FlowPicker flows={flowEntries} selected={selectedFlow} onSelect={setSelectedFlow} />
          )}

          <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={autoMode}
              onClick={() => setAutoMode(!autoMode)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                autoMode ? "bg-orange-500" : "bg-stone-300 dark:bg-stone-600"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  autoMode ? "translate-x-[18px]" : "translate-x-[3px]"
                }`}
              />
            </button>
            <span className="text-sm text-stone-700 dark:text-stone-200">Auto mode</span>
          </label>
        </Panel.Body>

        <Panel.Footer className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !description.trim()} loading={submitting}>
            Create Task
          </Button>
        </Panel.Footer>
      </form>
    </Panel>
  );
}

// =============================================================================
// Flow Picker
// =============================================================================

interface FlowPickerProps {
  flows: [string, FlowConfig][];
  selected: string | undefined;
  onSelect: (flow: string | undefined) => void;
}

function FlowPicker({ flows, selected, onSelect }: FlowPickerProps) {
  return (
    <fieldset className="mt-4">
      <legend className="block text-sm font-medium text-stone-700 mb-2">Workflow</legend>
      <div className="flex flex-col gap-2">
        <FlowOption
          name="Standard"
          description="Full pipeline with all stages"
          isSelected={selected === undefined}
          onClick={() => onSelect(undefined)}
        />
        {flows.map(([name, flow]) => {
          const Icon = flow.icon ? ICON_MAP[flow.icon] : undefined;
          return (
            <FlowOption
              key={name}
              name={titleCase(name)}
              description={flow.description}
              icon={Icon}
              isSelected={selected === name}
              onClick={() => onSelect(name)}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

interface FlowOptionProps {
  name: string;
  description: string;
  icon?: LucideIcon;
  isSelected: boolean;
  onClick: () => void;
}

function FlowOption({ name, description, icon: Icon, isSelected, onClick }: FlowOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-3 px-3 py-2.5 rounded-panel-sm border text-left transition-colors ${
        isSelected
          ? "border-orange-400 bg-orange-50"
          : "border-stone-200 bg-white hover:border-stone-300"
      }`}
    >
      {Icon && (
        <Icon
          size={16}
          className={`mt-0.5 flex-shrink-0 ${isSelected ? "text-orange-600" : "text-stone-400"}`}
        />
      )}
      <div className="min-w-0">
        <div className={`text-sm font-medium ${isSelected ? "text-orange-700" : "text-stone-700"}`}>
          {name}
        </div>
        {description && <div className="text-xs text-stone-500 mt-0.5">{description}</div>}
      </div>
    </button>
  );
}
