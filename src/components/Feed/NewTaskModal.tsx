// Desktop new-task modal — form inside a floating panel for use with ModalPanel.

import type { NewTaskFormProps } from "./NewTaskForm";
import { NewTaskForm } from "./NewTaskForm";

export function NewTaskModal({ config, onClose, onCreate, prewarmId }: NewTaskFormProps) {
  return (
    <div className="w-[520px] max-h-[90vh] rounded-panel shadow-xl border border-border bg-surface flex flex-col overflow-hidden">
      <NewTaskForm config={config} onClose={onClose} onCreate={onCreate} prewarmId={prewarmId} />
    </div>
  );
}
