// Modal for skipping the current stage, advancing to the next without agent review.
import { useState } from "react";
import type { Transport } from "../../transport";
import { Button } from "../ui/Button";
import { ModalPanel } from "../ui/ModalPanel";

interface SkipStageModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  onSuccess: () => void;
  transport: Transport;
}

export function SkipStageModal({
  isOpen,
  onClose,
  taskId,
  onSuccess,
  transport,
}: SkipStageModalProps) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setMessage("");
    setError(null);
    onClose();
  }

  async function handleSubmit() {
    if (!message.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      await transport.call("skip_stage", { task_id: taskId, message: message.trim() });
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
          <p className="text-forge-body-md font-semibold text-text-primary">Skip stage</p>
          <p className="mt-1 text-forge-body text-text-tertiary">
            Advance to the next stage without agent review.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="skip-stage-message"
            className="font-sans text-[11px] font-medium text-text-tertiary uppercase tracking-[0.06em] select-none"
          >
            Reason
          </label>
          <textarea
            id="skip-stage-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Why are you skipping this stage?"
            rows={3}
            className="w-full font-sans text-forge-body text-text-primary bg-canvas border border-border rounded px-3 py-2 resize-none placeholder:text-text-quaternary focus:outline-none focus:border-accent transition-colors"
          />
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
            disabled={!message.trim() || loading}
          >
            {loading ? "Skipping…" : "Skip Stage"}
          </Button>
        </div>
      </div>
    </ModalPanel>
  );
}
