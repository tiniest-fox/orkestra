// Storybook stories for TaskDrawer in 7 states.
import type { Meta, StoryObj } from "@storybook/react";
import { TaskDrawer } from "../components/Feed/Drawer/TaskDrawer";
import {
  createMockArtifact,
  createMockIteration,
  createMockQuestion,
  createMockStageLogInfo,
  createMockSubtaskProgress,
  createMockWorkflowTaskView,
} from "../test/mocks/fixtures";

const meta = {
  title: "Feed/TaskDrawer",
  component: TaskDrawer,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof TaskDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

const workingTask = createMockWorkflowTaskView({
  id: "working-task-1",
  title: "Implement rate limiting for API endpoints",
  description: "Add configurable rate limiting middleware to prevent API abuse",
  state: { type: "agent_working", stage: "work" },
  auto_mode: true,
  branch_name: "task/implement-rate-limiting",
  worktree_path: "/workspace/.orkestra/.worktrees/implement-rate-limiting",
  created_at: "2026-04-07T09:30:00Z",
  updated_at: "2026-04-07T10:15:00Z",
  iterations: [
    createMockIteration({ stage: "planning", iteration_number: 1, outcome: { type: "approved" } }),
    createMockIteration({
      stage: "work",
      iteration_number: 1,
      ended_at: undefined,
      outcome: undefined,
    }),
  ],
  derived: {
    stages_with_logs: [
      createMockStageLogInfo({ stage: "planning" }),
      createMockStageLogInfo({ stage: "work" }),
    ],
  },
});

export const Working: Story = {
  args: {
    task: workingTask,
    allTasks: [workingTask],
    onClose: () => {},
    onOpenTask: () => {},
  },
};

const reviewTask = createMockWorkflowTaskView({
  id: "review-task-1",
  title: "Refactor database connection pooling",
  state: { type: "awaiting_approval", stage: "review" },
  artifacts: {
    plan: createMockArtifact({
      name: "plan",
      content: "## Plan\nRefactor connection pool...",
      stage: "planning",
    }),
    summary: createMockArtifact({
      name: "summary",
      content: "## Summary\nImplemented connection pooling with...",
      stage: "work",
    }),
  },
  iterations: [
    createMockIteration({ stage: "planning", outcome: { type: "approved" } }),
    createMockIteration({ stage: "work", outcome: { type: "approved" } }),
    createMockIteration({ stage: "review", ended_at: undefined }),
  ],
  derived: {
    stages_with_logs: [
      createMockStageLogInfo({ stage: "planning" }),
      createMockStageLogInfo({ stage: "work" }),
      createMockStageLogInfo({ stage: "review" }),
    ],
  },
});

export const NeedsReview: Story = {
  args: {
    task: reviewTask,
    allTasks: [reviewTask],
    onClose: () => {},
    onOpenTask: () => {},
  },
};

const questionsTask = createMockWorkflowTaskView({
  id: "questions-task-1",
  title: "Set up CI/CD pipeline for staging environment",
  state: { type: "awaiting_question_answer", stage: "planning" },
  derived: {
    pending_questions: [
      createMockQuestion({
        question: "Which CI provider should we use?",
        options: [{ label: "GitHub Actions" }, { label: "CircleCI" }],
      }),
      createMockQuestion({
        question: "Should staging deploy on every push or only on PR merge?",
        options: [{ label: "Every push" }, { label: "PR merge only" }],
      }),
    ],
    stages_with_logs: [createMockStageLogInfo({ stage: "planning" })],
  },
});

export const Questions: Story = {
  args: {
    task: questionsTask,
    allTasks: [questionsTask],
    onClose: () => {},
    onOpenTask: () => {},
  },
};

const failedTask = createMockWorkflowTaskView({
  id: "failed-task-1",
  title: "Migrate user authentication to OAuth2",
  state: {
    type: "failed",
    error:
      "Agent exceeded maximum iterations without producing a valid artifact. The planning stage failed after 3 attempts.",
  },
  derived: {
    stages_with_logs: [createMockStageLogInfo({ stage: "planning" })],
  },
});

export const Failed: Story = {
  args: {
    task: failedTask,
    allTasks: [failedTask],
    onClose: () => {},
    onOpenTask: () => {},
  },
};

const interruptedTask = createMockWorkflowTaskView({
  id: "interrupted-task-1",
  title: "Add WebSocket support for real-time notifications",
  state: { type: "interrupted", stage: "work" },
  iterations: [
    createMockIteration({ stage: "planning", outcome: { type: "approved" } }),
    createMockIteration({ stage: "work", outcome: { type: "interrupted" } }),
  ],
  derived: {
    stages_with_logs: [
      createMockStageLogInfo({ stage: "planning" }),
      createMockStageLogInfo({ stage: "work" }),
    ],
  },
});

export const Interrupted: Story = {
  args: {
    task: interruptedTask,
    allTasks: [interruptedTask],
    onClose: () => {},
    onOpenTask: () => {},
  },
};

const waitingTask = createMockWorkflowTaskView({
  id: "parent-task-1",
  title: "Implement full-text search across all entities",
  state: { type: "waiting_on_children", stage: "breakdown" },
  derived: {
    subtask_progress: createMockSubtaskProgress({
      total: 5,
      done: 2,
      working: 1,
      has_questions: 1,
      waiting: 1,
    }),
    stages_with_logs: [
      createMockStageLogInfo({ stage: "planning" }),
      createMockStageLogInfo({ stage: "breakdown" }),
    ],
  },
});

export const WaitingOnChildren: Story = {
  args: {
    task: waitingTask,
    allTasks: [waitingTask],
    onClose: () => {},
    onOpenTask: () => {},
  },
};

const doneTask = createMockWorkflowTaskView({
  id: "done-task-1",
  title: "Fix memory leak in WebSocket reconnection handler",
  state: { type: "done" },
  pr_url: "https://github.com/org/repo/pull/42",
  completed_at: "2026-04-07T14:30:00Z",
  artifacts: {
    plan: createMockArtifact({
      name: "plan",
      stage: "planning",
      content: "## Plan\nFix the memory leak by...",
    }),
    summary: createMockArtifact({
      name: "summary",
      stage: "work",
      content: "## Summary\nFixed WebSocket reconnection...",
    }),
  },
  iterations: [
    createMockIteration({ stage: "planning", outcome: { type: "approved" } }),
    createMockIteration({ stage: "work", outcome: { type: "approved" } }),
  ],
  derived: {
    stages_with_logs: [
      createMockStageLogInfo({ stage: "planning" }),
      createMockStageLogInfo({ stage: "work" }),
    ],
  },
});

export const Done: Story = {
  args: {
    task: doneTask,
    allTasks: [doneTask],
    onClose: () => {},
    onOpenTask: () => {},
  },
};
