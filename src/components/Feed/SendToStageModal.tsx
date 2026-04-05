// Modal for changing a task's current stage (restart or redirect to another stage).
import { useState } from "react";
import type { Transport } from "../../transport";
import type { StageConfig } from "../../types/workflow";
import { titleCase } from "../../utils/titleCase";
import { Button } from "../ui/Button";
import { ModalPanel } from "../ui/ModalPanel";

interface SendToStageModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  onSuccess: () => void;
  transport: Transport;
  /** All flow-valid stages including the current stage. */
  stages: StageConfig[];
  /** The current stage name — selecting it triggers a restart instead of redirect. */
  currentStage: string;
}

export function SendToStageModal({
  isOpen,
  onClose,
  taskId,
  onSuccess,
  transport,
  stages,
  currentStage,
}: SendToStageModalProps) {
  const [targetStage, setTargetStage] = useState(() => stages[0]?.name ?? "");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setMessage("");
    setError(null);
    onClose();
  }

  const isRestart = targetStage === currentStage;

  async function handleSubmit() {
    if (!targetStage || !message.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      if (isRestart) {
        await transport.call("restart_stage", {
          task_id: taskId,
          message: message.trim(),
        });
      } else {
        await transport.call("send_to_stage", {
          task_id: taskId,
          target_stage: targetStage,
          message: message.trim(),
        });
      }
      onSuccess();
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }

  return (
    <ModalPanel isOpen={isOpen} onClose={handleClose} className="inset-0 m-auto h-fit w-80">
      <div className="bg-canvas border border-border rounded-panel shadow-lg p-5 flex flex-col gap-4">
        <div>
          <p className="text-forge-body-md font-semibold text-text-primary">Change stage</p>
          <p className="mt-1 text-forge-body text-text-tertiary">
            Restart the current stage or redirect to another.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="send-to-stage-target"
              className="font-sans text-[11px] font-medium text-text-tertiary uppercase tracking-[0.06em] select-none"
            >
              Target stage
            </label>
            <select
              id="send-to-stage-target"
              value={targetStage}
              onChange={(e) => setTargetStage(e.target.value)}
              className="w-full font-sans text-forge-body text-text-primary bg-canvas border border-border rounded px-3 py-2 focus:outline-none focus:border-accent transition-colors"
            >
              {stages.map((stage) => (
                <option key={stage.name} value={stage.name}>
                  {titleCase(stage.name) + (stage.name === currentStage ? " (restart)" : "")}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="send-to-stage-message"
              className="font-sans text-[11px] font-medium text-text-tertiary uppercase tracking-[0.06em] select-none"
            >
              Reason
            </label>
            <textarea
              id="send-to-stage-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Why are you changing the stage?"
              rows={3}
              className="w-full font-sans text-forge-body text-text-primary bg-canvas border border-border rounded px-3 py-2 resize-none placeholder:text-text-quaternary focus:outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>
        {error && <p className="text-forge-body text-status-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!targetStage || !message.trim() || loading}
          >
            {loading
              ? isRestart
                ? "Restarting…"
                : "Changing…"
              : isRestart
                ? "Restart Stage"
                : "Change Stage"}
          </Button>
        </div>
      </div>
    </ModalPanel>
  );
}
