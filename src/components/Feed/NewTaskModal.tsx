// Desktop new-task modal — form inside a floating panel for use with ModalPanel.

import type { NewTaskFormProps } from "./NewTaskForm";
import { NewTaskForm } from "./NewTaskForm";

export function NewTaskModal({ config, onClose, onCreate }: NewTaskFormProps) {
  return (
    <div className="w-[520px] rounded-panel shadow-xl border border-border bg-surface flex flex-col overflow-hidden">
      <NewTaskForm config={config} onClose={onClose} onCreate={onCreate} />
    </div>
  );
}
