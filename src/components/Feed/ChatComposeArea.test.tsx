// Tests for ChatComposeArea — mobile/desktop Enter key behavior and image attachment UI.

import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingImage } from "./ChatComposeArea";

const mockUseIsMobile = vi.fn(() => false);

vi.mock("../../hooks/useIsMobile", () => ({
  useIsMobile: () => mockUseIsMobile(),
}));

import { ChatComposeArea } from "./ChatComposeArea";

function makeProps(overrides?: Partial<Parameters<typeof ChatComposeArea>[0]>) {
  return {
    value: "hello",
    onChange: vi.fn(),
    textareaRef: createRef<HTMLTextAreaElement>(),
    sending: false,
    agentActive: false,
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
}

describe("ChatComposeArea — Enter key behavior", () => {
  beforeEach(() => {
    mockUseIsMobile.mockReset();
    mockUseIsMobile.mockReturnValue(false);
  });

  it("calls onSend when Enter is pressed on desktop", () => {
    const props = makeProps();
    render(<ChatComposeArea {...props} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(props.onSend).toHaveBeenCalledTimes(1);
  });

  it("does not call onSend when Enter is pressed on mobile", () => {
    mockUseIsMobile.mockReturnValue(true);
    const props = makeProps();
    render(<ChatComposeArea {...props} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("does not call onSend when Shift+Enter is pressed on desktop", () => {
    const props = makeProps();
    render(<ChatComposeArea {...props} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("does not call onSend when Shift+Enter is pressed on mobile", () => {
    mockUseIsMobile.mockReturnValue(true);
    const props = makeProps();
    render(<ChatComposeArea {...props} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("does not call onSend when value is empty on desktop", () => {
    const props = makeProps({ value: "   " });
    render(<ChatComposeArea {...props} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("calls onSend when Enter is pressed with empty text but pending images", () => {
    const pendingImages: PendingImage[] = [
      { id: "1", file: new File([], "img.png", { type: "image/png" }), previewUrl: "blob:1" },
    ];
    const props = makeProps({ value: "", pendingImages, onImagesAdded: vi.fn() });
    render(<ChatComposeArea {...props} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(props.onSend).toHaveBeenCalledTimes(1);
  });
});

describe("ChatComposeArea — send button state", () => {
  beforeEach(() => {
    mockUseIsMobile.mockReset();
    mockUseIsMobile.mockReturnValue(false);
  });

  it("send button is disabled when value is empty and no pending images", () => {
    const props = makeProps({ value: "" });
    render(<ChatComposeArea {...props} />);

    const sendButton = screen.getByRole("button", { name: "Send" });
    expect(sendButton).toBeDisabled();
  });

  it("send button is enabled when there are pending images and no text", () => {
    const pendingImages: PendingImage[] = [
      { id: "1", file: new File([], "img.png", { type: "image/png" }), previewUrl: "blob:1" },
    ];
    const props = makeProps({ value: "", pendingImages, onImagesAdded: vi.fn() });
    render(<ChatComposeArea {...props} />);

    const sendButton = screen.getByRole("button", { name: "Send" });
    expect(sendButton).not.toBeDisabled();
  });
});
