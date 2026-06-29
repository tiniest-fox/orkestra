// Storybook stories for vibe mode in the task drawer.
import type { Meta, StoryObj } from "@storybook/react";
import { TaskDrawer } from "../components/Feed/Drawer/TaskDrawer";
import {
  createMockArtifact,
  createMockStageLogInfo,
  createMockWorkflowTaskView,
} from "../test/mocks/fixtures";

const meta = {
  title: "Vibe/TaskDrawer",
  component: TaskDrawer,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TaskDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

// Proposed exit review — agent proposes exiting to "work" with destination picker.
const vibeExitTask = createMockWorkflowTaskView({
  id: "vibe-exit-task-1",
  title: "Explore caching architecture",
  state: { type: "awaiting_approval", stage: "vibe" },
  artifacts: {
    vibe_exit: createMockArtifact({
      name: "vibe_exit",
      content:
        "## Vibe Session Summary\n\nExplored Redis and Memcached options. Recommending exit to **work** stage to implement Redis-based caching.",
      stage: "vibe",
    }),
  },
  derived: {
    needs_review: true,
    is_vibing: true,
    vibe_proposed_destination: "work",
    vibe_valid_destinations: ["work", "review", "done"],
    stages_with_logs: [createMockStageLogInfo({ stage: "vibe" })],
  },
});

export const ProposedExit: Story = {
  args: {
    task: vibeExitTask,
    allTasks: [vibeExitTask],
    onClose: () => {},
    onOpenTask: () => {},
  },
};

// Vibe actively working — shows vibing indicator in drawer.
const vibeWorkingTask = createMockWorkflowTaskView({
  id: "vibe-working-task-1",
  title: "Explore database indexing strategies",
  state: { type: "agent_working", stage: "vibe" },
  derived: {
    is_working: true,
    is_vibing: true,
    current_stage: "vibe",
    stages_with_logs: [createMockStageLogInfo({ stage: "vibe" })],
  },
});

export const VibeWorking: Story = {
  args: {
    task: vibeWorkingTask,
    allTasks: [vibeWorkingTask],
    onClose: () => {},
    onOpenTask: () => {},
  },
};

// Vibe button visible in Done state drawer footer.
const vibeDoneTask = createMockWorkflowTaskView({
  id: "vibe-done-task-1",
  title: "Implement user preferences API",
  state: { type: "done" },
  derived: {
    is_done: true,
    is_terminal: true,
    current_stage: null,
    stages_with_logs: [
      createMockStageLogInfo({ stage: "planning" }),
      createMockStageLogInfo({ stage: "work" }),
    ],
  },
});

export const DoneWithVibeButton: Story = {
  args: {
    task: vibeDoneTask,
    allTasks: [vibeDoneTask],
    onClose: () => {},
    onOpenTask: () => {},
  },
};
