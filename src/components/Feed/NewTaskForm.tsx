// Shared new-task form content. Used by NewTaskModal (desktop) and NewTaskDrawer (mobile).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGitHistory } from "../../providers/GitHistoryProvider";
import type { WorkflowConfig } from "../../types/workflow";
import { BranchSelector } from "../BranchSelector";
import { Button } from "../ui/Button";
import { DrawerHeader } from "../ui/Drawer/DrawerHeader";
import { HotkeyScope } from "../ui/HotkeyScope";
import { FlowPicker } from "./FlowPicker";

export interface NewTaskFormProps {
  config: WorkflowConfig;
  onClose: () => void;
  onCreate: (
    description: string,
    autoMode: boolean,
    baseBranch: string,
    flow?: string,
  ) => Promise<void>;
}

export function NewTaskForm({ config, onClose, onCreate }: NewTaskFormProps) {
  const [description, setDescription] = useState("");
  const [autoMode, setAutoMode] = useState(false);
  const [baseBranch, setBaseBranch] = useState("");
  const [selectedFlow, setSelectedFlow] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { currentBranch } = useGitHistory();

  // Autofocus textarea on mount.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const canSubmit = description.trim().length > 0 && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onCreate(description.trim(), autoMode, baseBranch, selectedFlow ?? undefined);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, description, autoMode, baseBranch, selectedFlow, onCreate, onClose]);

  const flows = config.flows ?? {};
  const hasFlows = Object.keys(flows).length > 0;
  const flowKeys: (string | null)[] = useMemo(() => [null, ...Object.keys(flows)], [flows]);

  // Modifier-key shortcuts — safe to fire from anywhere including the textarea.
  // ⌘Enter is handled by the Button's HotkeyScope below.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.altKey) return;
      if (e.key === "a") {
        e.preventDefault();
        setAutoMode((m) => !m);
        return;
      }
      if (hasFlows && e.key === "ArrowRight") {
        e.preventDefault();
        setSelectedFlow((prev) => {
          const idx = flowKeys.indexOf(prev);
          return flowKeys[Math.min(flowKeys.length - 1, idx + 1)];
        });
        return;
      }
      if (hasFlows && e.key === "ArrowLeft") {
        e.preventDefault();
        setSelectedFlow((prev) => {
          const idx = flowKeys.indexOf(prev);
          return flowKeys[Math.max(0, idx - 1)];
        });
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasFlows, flowKeys]);

  return (
    <>
      <DrawerHeader title="New Task" onClose={onClose} />

      {/* Description */}
      <div className="px-4 pt-4 pb-3">
        <label
          htmlFor="new-task-description"
          className="block font-sans text-[11px] font-medium text-text-tertiary uppercase tracking-[0.06em] mb-1.5 select-none"
        >
          Description
        </label>
        <textarea
          id="new-task-description"
          ref={textareaRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What needs to be done?"
          rows={3}
          className="w-full font-sans text-[13px] text-text-primary bg-canvas border border-border rounded px-3 py-2 resize-none placeholder:text-text-quaternary focus:outline-none focus:border-accent transition-colors min-h-[80px]"
        />
      </div>

      {/* Flow picker */}
      {hasFlows && (
        <div className="px-4 pb-3">
          <FlowPicker
            flows={flows}
            stages={config.stages}
            selected={selectedFlow}
            onChange={setSelectedFlow}
          />
        </div>
      )}

      {/* Footer */}
      <div className="flex flex-col gap-3 px-4 py-3 border-t border-border bg-canvas">
        <div className="flex items-center justify-between gap-3">
          <BranchSelector
            value={baseBranch}
            onChange={setBaseBranch}
            initialBranch={currentBranch}
          />
          <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={autoMode}
              onChange={(e) => setAutoMode(e.target.checked)}
              className="w-3.5 h-3.5 accent-accent cursor-pointer"
            />
            <span className="font-sans text-[12px] text-text-secondary">Run automatically</span>
            <kbd className="font-mono text-[10px] text-text-quaternary bg-canvas border border-border rounded px-1 leading-none select-none">
              ⌥A
            </kbd>
          </label>
        </div>
        <HotkeyScope active>
          <Button
            variant="primary"
            size="sm"
            hotkey="meta+Enter"
            onAccent
            disabled={!canSubmit}
            onClick={handleSubmit}
            fullWidth
          >
            {submitting ? "Creating…" : "Create Task"}
          </Button>
        </HotkeyScope>
      </div>
    </>
  );
}
