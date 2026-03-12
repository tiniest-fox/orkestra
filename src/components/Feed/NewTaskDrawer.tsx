// Mobile new-task drawer — form inside a slide-in Drawer.

import { Drawer } from "../ui/Drawer/Drawer";
import type { NewTaskFormProps } from "./NewTaskForm";
import { NewTaskForm } from "./NewTaskForm";

export function NewTaskDrawer({ config, onClose, onCreate }: NewTaskFormProps) {
  return (
    <Drawer onClose={onClose}>
      <div className="flex flex-col h-full bg-surface">
        <NewTaskForm config={config} onClose={onClose} onCreate={onCreate} />
      </div>
    </Drawer>
  );
}
