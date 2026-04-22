// Storybook stories for ArtifactLogCard — superseded, latest (review/approved/rejected), and feed variants.
import type { Meta, StoryObj } from "@storybook/react";
import { ArtifactLogCard } from "../components/Feed/ArtifactLogCard";
import type { LogEntry } from "../types/workflow";
import { storybookDecorator } from "./storybook-helpers";

const baseArtifact = {
  name: "plan",
  content:
    "# Implementation Plan\n\nThis plan outlines the approach for implementing the feature.\n\n## Steps\n\n1. Update the component\n2. Write tests\n3. Add stories",
  stage: "planning",
  created_at: "2026-01-15T10:30:00Z",
  iteration: 1,
};

const gatePassedEntries: LogEntry[] = [
  { type: "gate_started", command: "checks.sh" },
  {
    type: "gate_output",
    content:
      "cargo fmt -- --check\ncargo clippy -- -D warnings\ncargo test --workspace\n\nAll checks passed.",
  },
  { type: "gate_completed", exit_code: 0, passed: true },
];

const gateFailedEntries: LogEntry[] = [
  { type: "gate_started", command: "checks.sh" },
  {
    type: "gate_output",
    content:
      "cargo test --workspace\nFAILED: test_feature_x panicked at src/lib.rs:42\n  assertion failed: result == expected",
  },
  { type: "gate_completed", exit_code: 1, passed: false },
];

const meta = {
  title: "Feed/ArtifactLogCard",
  component: ArtifactLogCard,
  decorators: [storybookDecorator],
  parameters: {
    layout: "padded",
  },
  args: {
    artifact: baseArtifact,
  },
} satisfies Meta<typeof ArtifactLogCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Superseded artifact — transparent background, blends into chat canvas. Collapsed by default. */
export const Superseded: Story = {
  args: {
    superseded: true,
  },
};

/** Superseded artifact expanded to show content — no white card background. */
export const SupersededExpanded: Story = {
  args: {
    superseded: true,
    artifact: { ...baseArtifact, iteration: 1 },
  },
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector("button");
    button?.click();
  },
};

/** Superseded artifact expanded with gate logs attached inline (gate passed). */
export const SupersededWithGatePassed: Story = {
  args: {
    superseded: true,
    gateEntries: gatePassedEntries,
  },
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector("button");
    button?.click();
  },
};

/** Superseded artifact expanded with gate logs attached inline (gate failed). */
export const SupersededWithGateFailed: Story = {
  args: {
    superseded: true,
    gateEntries: gateFailedEntries,
  },
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector("button");
    button?.click();
  },
};

/** Latest artifact awaiting human review — shows approve button. */
export const LatestNeedsReview: Story = {
  args: {
    needsReview: true,
    onApprove: () => {},
    loading: false,
  },
};

/** Latest artifact — approved verdict. */
export const LatestApproved: Story = {
  args: {
    needsReview: true,
    verdict: "approved",
    onApprove: () => {},
    loading: false,
  },
};

/** Latest artifact — rejected verdict with rejection target. */
export const LatestRejected: Story = {
  args: {
    needsReview: true,
    verdict: "rejected",
    rejectionTarget: "planning",
    onApprove: () => {},
    loading: false,
  },
};

/** Feed card — no approve action, no superseded dimming. Basic collapsed card. */
export const FeedSimple: Story = {
  args: {},
};
