// Storybook stories for MessageList — baseline, queued messages, and agent-running states.
import type { Meta, StoryObj } from "@storybook/react";
import type { DisplayMessage, QueuedMessageItem } from "../components/Feed/MessageList";
import { MessageList } from "../components/Feed/MessageList";
import { storybookDecorator } from "./storybook-helpers";

const userMessage: DisplayMessage = {
  kind: "user",
  content: "Can you help me refactor the authentication module?",
};

const agentMessage: DisplayMessage = {
  kind: "agent",
  entries: [
    {
      type: "text",
      content:
        "Sure! I'll start by reviewing the current authentication module and identifying areas for improvement.\n\nHere's my plan:\n1. Extract token validation into a separate function\n2. Add proper error types\n3. Write unit tests",
    },
  ],
};

const baseMessages: DisplayMessage[] = [userMessage, agentMessage];

const singleQueued: QueuedMessageItem[] = [
  { id: "q1", text: "Can you also add a test for the error path?" },
];

const multipleQueued: QueuedMessageItem[] = [
  { id: "q1", text: "Can you also add a test for the error path?" },
  {
    id: "q2",
    text: "Make sure the token expiry check is unit tested separately from the signature check.",
  },
  { id: "q3", text: "Once done, update the README with the new auth flow diagram." },
];

const meta = {
  title: "Feed/MessageList",
  component: MessageList,
  decorators: [storybookDecorator],
  parameters: {
    layout: "padded",
  },
  args: {
    messages: baseMessages,
    isAgentRunning: false,
    agentLabel: "Agent",
    userLabel: "You",
    onEditQueued: () => {},
    onDeleteQueued: () => {},
    onInjectQueued: () => {},
  },
} satisfies Meta<typeof MessageList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** NoQueuedMessages — normal message list with no queued items (baseline). */
export const NoQueuedMessages: Story = {};

/** SingleQueuedMessage — one queued message displayed below the last agent reply. */
export const SingleQueuedMessage: Story = {
  args: {
    isAgentRunning: true,
    queuedMessages: singleQueued,
  },
};

/** MultipleQueuedMessages — three queued messages; action buttons visible on hover. */
export const MultipleQueuedMessages: Story = {
  args: {
    isAgentRunning: true,
    queuedMessages: multipleQueued,
  },
};

/** QueuedWithRunningAgent — spinner followed by queued messages below it. */
export const QueuedWithRunningAgent: Story = {
  args: {
    isAgentRunning: true,
    queuedMessages: multipleQueued,
    messages: [
      userMessage,
      { kind: "agent", entries: [{ type: "text", content: "Working on it…" }] },
    ],
  },
};
