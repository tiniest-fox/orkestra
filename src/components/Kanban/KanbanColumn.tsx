/**
 * Kanban column - single column in the kanban board.
 * Collapses to a narrow width with vertical label when empty.
 */

import { AnimatePresence, motion } from "framer-motion";
import type { WorkflowTaskView } from "../../types/workflow";
import type { KanbanColumn as KanbanColumnType } from "../../utils/kanban";
import { Panel, PanelContainer } from "../ui";
import { TaskCard } from "./TaskCard";

interface KanbanColumnProps {
  column: KanbanColumnType;
  tasks: WorkflowTaskView[];
  selectedTaskId?: string;
  onSelectTask: (task: WorkflowTaskView) => void;
}

const COLLAPSED_WIDTH = 48;
const EXPANDED_WIDTH = 288; // w-72

const columnTransition = {
  duration: 0.25,
  ease: [0.4, 0, 0.2, 1] as const,
};

const labelTransition = {
  duration: 0.2,
  ease: "easeInOut" as const,
};

export function KanbanColumn({ column, tasks, selectedTaskId, onSelectTask }: KanbanColumnProps) {
  const isEmpty = tasks.length === 0;

  return (
    <motion.div
      layout
      className="my-2 shrink-0"
      animate={{ width: isEmpty ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
      transition={columnTransition}
      style={{ height: "calc(100% - 16px)" }}
    >
      <Panel autoFill={true} className="h-full">
        {/* Header: dot + label with crossfade between vertical/horizontal */}
        <div className="flex-shrink-0 relative">
          {/* Dot — always visible, positioned at the top */}
          <div className={`flex pt-4 ${isEmpty ? "justify-center" : "justify-start px-4"}`}>
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full shrink-0 ${column.color}`} />
              {/* Horizontal label — visible when expanded */}
              <AnimatePresence>
                {!isEmpty && (
                  <motion.h2
                    key="horizontal"
                    className="font-heading font-medium text-stone-700 flex items-center gap-2 whitespace-nowrap overflow-hidden"
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={labelTransition}
                  >
                    {column.label}
                    <span className="text-stone-400 text-sm">({tasks.length})</span>
                  </motion.h2>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Vertical label — visible when collapsed */}
          <AnimatePresence>
            {isEmpty && (
              <motion.div
                key="vertical"
                className="flex justify-center mt-3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={labelTransition}
              >
                <span
                  className="font-heading font-medium text-stone-400 text-sm"
                  style={{
                    writingMode: "vertical-rl",
                    textOrientation: "mixed",
                    maxHeight: "calc(100vh - 200px)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {column.label}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Task content — only rendered when not collapsed */}
        <AnimatePresence>
          {!isEmpty && (
            <motion.div
              className="flex-1 min-h-0 overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={labelTransition}
            >
              <PanelContainer direction="vertical" scrolls={true} padded={true}>
                <div />
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onClick={() => onSelectTask(task)}
                    isSelected={task.id === selectedTaskId}
                  />
                ))}
              </PanelContainer>
            </motion.div>
          )}
        </AnimatePresence>
      </Panel>
    </motion.div>
  );
}
