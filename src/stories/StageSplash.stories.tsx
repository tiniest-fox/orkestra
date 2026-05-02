// Storybook stories for StageSplash — one per intermediate task state.
import type { Meta, StoryObj } from "@storybook/react";
import { StageSplash } from "../components/Feed/Drawer/StageSplash";
import { storybookDecorator } from "./storybook-helpers";

// ============================================================================
// Meta
// ============================================================================

const meta = {
  title: "Feed/StageSplash",
  component: StageSplash,
  decorators: [storybookDecorator],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof StageSplash>;

export default meta;
type Story = StoryObj<typeof meta>;

// ============================================================================
// Stories
// ============================================================================

const wrapper = (Story: React.ComponentType) => (
  <div className="flex flex-col h-[400px] bg-canvas">
    <Story />
  </div>
);

/** Task is waiting for its worktree to be provisioned. */
export const AwaitingSetup: Story = {
  args: { label: "Awaiting setup…" },
  decorators: [wrapper],
};

/** Worktree is being created and dependencies installed. */
export const SettingUp: Story = {
  args: { label: "Setting up worktree…" },
  decorators: [wrapper],
};

/** Agent finished its work; system is wrapping up. */
export const Finishing: Story = {
  args: { label: "Finishing…" },
  decorators: [wrapper],
};

/** Changes are being committed to the worktree branch. */
export const Committing: Story = {
  args: { label: "Committing changes…" },
  decorators: [wrapper],
};

/** Commit complete; waiting for integration to begin. */
export const Committed: Story = {
  args: { label: "Committing changes…" },
  decorators: [wrapper],
};

/** Branch is being rebased and merged into main. */
export const Integrating: Story = {
  args: { label: "Integrating…" },
  decorators: [wrapper],
};
