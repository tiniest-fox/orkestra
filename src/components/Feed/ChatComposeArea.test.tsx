// Tests for ChatComposeArea — mobile/desktop Enter key behavior.

import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
