// Pure functions for computing optimistic task state after human actions.

import type { WorkflowConfig, WorkflowTaskView } from "../types/workflow";
import { nextStageInFlow } from "./workflowNavigation";

export type OptimisticAction =
  | { type: "approve" }
  | { type: "answer_questions" }
  | { type: "interrupt" }
  | { type: "resume" }
  | { type: "archive" };

export function applyOptimisticTransition(
  task: WorkflowTaskView,
  action: OptimisticAction,
  config: WorkflowConfig,
): WorkflowTaskView | null {
  switch (action.type) {
    case "approve": {
      if (task.state.type === "awaiting_approval") {
        const { stage } = task.state;
        const nextStage = nextStageInFlow(stage, task.flow, config);
        if (nextStage) {
          return {
            ...task,
            state: { type: "queued", stage: nextStage },
            derived: {
              ...task.derived,
              current_stage: nextStage,
              needs_review: false,
              has_questions: false,
              is_working: false,
              phase_icon: "queued",
            },
          };
        }
        return {
          ...task,
          state: { type: "finishing", stage },
          derived: {
            ...task.derived,
            current_stage: stage,
            needs_review: false,
            has_questions: false,
            is_done: false,
            is_terminal: false,
            is_system_active: true,
            phase_icon: "git",
          },
        };
      }
      if (task.state.type === "awaiting_rejection_confirmation") {
        const pendingRejection = task.derived.pending_rejection;
        if (!pendingRejection) return null;
        const target = pendingRejection.target;
        return {
          ...task,
          state: { type: "agent_working", stage: target },
          derived: {
            ...task.derived,
            current_stage: target,
            needs_review: false,
            is_working: true,
            pending_rejection: null,
          },
        };
      }
      return null;
    }

    case "answer_questions": {
      if (task.state.type !== "awaiting_question_answer") return null;
      return {
        ...task,
        state: { type: "agent_working", stage: task.state.stage },
        derived: {
          ...task.derived,
          has_questions: false,
          pending_questions: [],
          needs_review: false,
          is_working: true,
        },
      };
    }

    case "interrupt": {
      if (task.state.type === "agent_working" || task.state.type === "queued") {
        return {
          ...task,
          state: { type: "interrupted", stage: task.state.stage },
          derived: {
            ...task.derived,
            is_working: false,
            is_interrupted: true,
            phase_icon: null,
          },
        };
      }
      return null;
    }

    case "resume": {
      if (task.state.type !== "interrupted") return null;
      return {
        ...task,
        state: { type: "queued", stage: task.state.stage },
        derived: {
          ...task.derived,
          is_interrupted: false,
          phase_icon: "queued",
        },
      };
    }

    case "archive": {
      if (task.state.type !== "done") return null;
      return {
        ...task,
        state: { type: "archived" },
        derived: {
          ...task.derived,
          is_archived: true,
          is_terminal: true,
          current_stage: null,
          is_done: false,
          phase_icon: null,
        },
      };
    }
  }
}
