// Storybook stories for ChatComposeArea — compose input with image attachment support.
import type { Meta, StoryObj } from "@storybook/react";
import { createRef } from "react";
import type { PendingImage } from "../components/Feed/ChatComposeArea";
import { ChatComposeArea } from "../components/Feed/ChatComposeArea";
import { storybookDecorator } from "./storybook-helpers";

function makePendingImage(id: string, color: string): PendingImage {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 64, 64);
  }
  const dataUrl = canvas.toDataURL("image/png");
  const blob = new Blob([], { type: "image/png" });
  return {
    id,
    file: new File([blob], `image-${id}.png`, { type: "image/png" }),
    previewUrl: dataUrl,
  };
}

const meta = {
  title: "Feed/ChatComposeArea",
  component: ChatComposeArea,
  decorators: [storybookDecorator],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ChatComposeArea>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default — empty compose area with no images. */
export const Default: Story = {
  args: {
    value: "",
    onChange: () => {},
    textareaRef: createRef<HTMLTextAreaElement>(),
    sending: false,
    agentActive: false,
    onSend: () => {},
    onStop: () => {},
    placeholder: "Ask the assistant…",
  },
};

/** WithText — compose area with text typed in. */
export const WithText: Story = {
  args: {
    value: "Can you help me refactor this function?",
    onChange: () => {},
    textareaRef: createRef<HTMLTextAreaElement>(),
    sending: false,
    agentActive: false,
    onSend: () => {},
    onStop: () => {},
    placeholder: "Ask the assistant…",
  },
};

/** WithPendingImages — thumbnail chips shown above the textarea (Tauri mode). */
export const WithPendingImages: Story = {
  args: {
    value: "",
    onChange: () => {},
    textareaRef: createRef<HTMLTextAreaElement>(),
    sending: false,
    agentActive: false,
    onSend: () => {},
    onStop: () => {},
    placeholder: "Ask the assistant…",
    pendingImages: [
      makePendingImage("1", "#6366f1"),
      makePendingImage("2", "#ec4899"),
      makePendingImage("3", "#14b8a6"),
    ],
    onImagesAdded: () => {},
    onImageRemoved: () => {},
  },
};

/** SendingWithImages — disabled state while send is in flight. */
export const SendingWithImages: Story = {
  args: {
    value: "Here are the screenshots",
    onChange: () => {},
    textareaRef: createRef<HTMLTextAreaElement>(),
    sending: true,
    agentActive: false,
    onSend: () => {},
    onStop: () => {},
    placeholder: "Ask the assistant…",
    pendingImages: [makePendingImage("1", "#6366f1"), makePendingImage("2", "#ec4899")],
    onImagesAdded: () => {},
    onImageRemoved: () => {},
  },
};

/** AgentRunning — shows the stop button. */
export const AgentRunning: Story = {
  args: {
    value: "",
    onChange: () => {},
    textareaRef: createRef<HTMLTextAreaElement>(),
    sending: false,
    agentActive: true,
    onSend: () => {},
    onStop: () => {},
    placeholder: "Ask the assistant…",
  },
};
