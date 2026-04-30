// Tests for ChatComposeArea — mobile/desktop Enter key behavior and image attachment UI.

import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingImage } from "./ChatComposeArea";

// jsdom doesn't implement these — stub them for tests that exercise paste/drop handlers.
URL.createObjectURL = vi.fn(() => "blob:test");
URL.revokeObjectURL = vi.fn();
vi.spyOn(crypto, "randomUUID").mockReturnValue(
  "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
);

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

describe("ChatComposeArea — paste handler", () => {
  beforeEach(() => {
    mockUseIsMobile.mockReset();
    mockUseIsMobile.mockReturnValue(false);
  });

  it("calls onImagesAdded with image files pasted from clipboard", () => {
    const onImagesAdded = vi.fn();
    const props = makeProps({ onImagesAdded });
    render(<ChatComposeArea {...props} />);

    const imageFile = new File(["data"], "screenshot.png", { type: "image/png" });
    const dataTransfer = {
      items: [
        {
          type: "image/png",
          getAsFile: () => imageFile,
        },
      ],
    };

    const textarea = screen.getByRole("textbox");
    fireEvent.paste(textarea, { clipboardData: dataTransfer });

    expect(onImagesAdded).toHaveBeenCalledTimes(1);
    const [images] = onImagesAdded.mock.calls[0];
    expect(images).toHaveLength(1);
    expect(images[0].file).toBe(imageFile);
    expect(images[0].id).toBe("test-uuid");
    expect(images[0].previewUrl).toBe("blob:test");
  });

  it("ignores non-image clipboard items", () => {
    const onImagesAdded = vi.fn();
    const props = makeProps({ onImagesAdded });
    render(<ChatComposeArea {...props} />);

    const dataTransfer = {
      items: [{ type: "text/plain", getAsFile: () => null }],
    };

    const textarea = screen.getByRole("textbox");
    fireEvent.paste(textarea, { clipboardData: dataTransfer });

    expect(onImagesAdded).not.toHaveBeenCalled();
  });

  it("does nothing when onImagesAdded is not provided", () => {
    const props = makeProps();
    render(<ChatComposeArea {...props} />);

    const dataTransfer = {
      items: [{ type: "image/png", getAsFile: () => new File([], "img.png") }],
    };

    const textarea = screen.getByRole("textbox");
    // Should not throw
    fireEvent.paste(textarea, { clipboardData: dataTransfer });
  });
});

describe("ChatComposeArea — drop handler", () => {
  beforeEach(() => {
    mockUseIsMobile.mockReset();
    mockUseIsMobile.mockReturnValue(false);
  });

  it("calls onImagesAdded with dropped image files", () => {
    const onImagesAdded = vi.fn();
    const props = makeProps({ onImagesAdded });
    render(<ChatComposeArea {...props} />);

    const imageFile = new File(["data"], "photo.jpg", { type: "image/jpeg" });
    const dataTransfer = {
      types: ["Files"],
      files: [imageFile],
      dropEffect: "",
    };

    const section = screen.getByRole("region", { name: "Compose message" });
    fireEvent.drop(section, { dataTransfer });

    expect(onImagesAdded).toHaveBeenCalledTimes(1);
    const [images] = onImagesAdded.mock.calls[0];
    expect(images).toHaveLength(1);
    expect(images[0].file).toBe(imageFile);
  });

  it("ignores dropped non-image files", () => {
    const onImagesAdded = vi.fn();
    const props = makeProps({ onImagesAdded });
    render(<ChatComposeArea {...props} />);

    const textFile = new File(["hello"], "readme.txt", { type: "text/plain" });
    const dataTransfer = {
      types: ["Files"],
      files: [textFile],
      dropEffect: "",
    };

    const section = screen.getByRole("region", { name: "Compose message" });
    fireEvent.drop(section, { dataTransfer });

    expect(onImagesAdded).not.toHaveBeenCalled();
  });
});

describe("ChatComposeArea — image remove button", () => {
  beforeEach(() => {
    mockUseIsMobile.mockReset();
    mockUseIsMobile.mockReturnValue(false);
  });

  it("calls onImageRemoved with the correct image id when remove button is clicked", () => {
    const onImageRemoved = vi.fn();
    const pendingImages: PendingImage[] = [
      { id: "img-a", file: new File([], "a.png", { type: "image/png" }), previewUrl: "blob:a" },
      { id: "img-b", file: new File([], "b.png", { type: "image/png" }), previewUrl: "blob:b" },
    ];
    const props = makeProps({ pendingImages, onImagesAdded: vi.fn(), onImageRemoved });
    render(<ChatComposeArea {...props} />);

    const removeButtons = screen.getAllByRole("button", { name: "Remove image" });
    expect(removeButtons).toHaveLength(2);

    fireEvent.click(removeButtons[0]);
    expect(onImageRemoved).toHaveBeenCalledTimes(1);
    expect(onImageRemoved).toHaveBeenCalledWith("img-a");
  });
});
