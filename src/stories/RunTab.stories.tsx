// Storybook stories for RunTab — control bar with optional declared port chips.

import type { Meta, StoryObj } from "@storybook/react";
import { RunTab } from "../components/Feed/Drawer/Sections/RunTab";
import { storybookDecorator } from "./storybook-helpers";

// ============================================================================
// Meta
// ============================================================================

const meta = {
  title: "Feed/RunTab",
  component: RunTab,
  decorators: [storybookDecorator],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RunTab>;

export default meta;
type Story = StoryObj<typeof meta>;

const wrapper = (Story: React.ComponentType) => (
  <div className="flex flex-col h-[400px] bg-canvas">
    <Story />
  </div>
);

const stoppedStatus = { running: false, pid: null, exit_code: null };
const runningStatus = { running: true, pid: 12345, exit_code: null };

// ============================================================================
// Stories
// ============================================================================

/** Default state: no run, no ports declared yet. */
export const NoPorts: Story = {
  args: {
    status: stoppedStatus,
    lines: [],
    ports: {},
    loading: false,
    error: null,
    start: async () => {},
    stop: async () => {},
  },
  decorators: [wrapper],
};

/** Single declared port visible in the control bar. */
export const SinglePort: Story = {
  args: {
    status: runningStatus,
    lines: ["Starting Rails...", "ORKESTRA_PORT Rails=3000", "=> Booting Puma"],
    ports: { Rails: 3000 },
    loading: false,
    error: null,
    start: async () => {},
    stop: async () => {},
  },
  decorators: [wrapper],
};

/** Multiple declared ports — Rails, React, and API server. */
export const MultiplePorts: Story = {
  args: {
    status: runningStatus,
    lines: [
      "Starting services...",
      "ORKESTRA_PORT Rails=3000",
      "ORKESTRA_PORT React=3002",
      "ORKESTRA_PORT API=4000",
      "All services running.",
    ],
    ports: { Rails: 3000, React: 3002, API: 4000 },
    loading: false,
    error: null,
    start: async () => {},
    stop: async () => {},
  },
  decorators: [wrapper],
};
