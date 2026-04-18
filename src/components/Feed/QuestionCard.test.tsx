// Tests for QuestionCard — mobile/desktop Enter key behavior and Escape handling.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseIsMobile = vi.fn(() => false);

vi.mock("../../hooks/useIsMobile", () => ({
  useIsMobile: () => mockUseIsMobile(),
}));

vi.mock("../ui/NavigationScope", () => ({
  useNavItem: vi.fn(),
}));

import { QuestionCard } from "./QuestionCard";

function makeProps(overrides?: Partial<Parameters<typeof QuestionCard>[0]>) {
  return {
    index: 0,
    question: { question: "What is your answer?" },
    value: "",
    onChange: vi.fn(),
    flatStartIndex: 0,
    keyboardFlatIdx: -1,
    onTextareaEnter: vi.fn(),
    onTextareaEscape: vi.fn(),
    ...overrides,
  };
}

describe("QuestionCard — Enter key behavior", () => {
  beforeEach(() => {
    mockUseIsMobile.mockReset();
    mockUseIsMobile.mockReturnValue(false);
  });

  it("calls onTextareaEnter when Enter is pressed on desktop", () => {
    const props = makeProps();
    render(<QuestionCard {...props} />);

    const textarea = screen.getByPlaceholderText("Your answer…");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(props.onTextareaEnter).toHaveBeenCalledTimes(1);
  });

  it("does not call onTextareaEnter when Enter is pressed on mobile", () => {
    mockUseIsMobile.mockReturnValue(true);
    const props = makeProps();
    render(<QuestionCard {...props} />);

    const textarea = screen.getByPlaceholderText("Your answer…");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(props.onTextareaEnter).not.toHaveBeenCalled();
  });

  it("does not call onTextareaEnter when Shift+Enter is pressed on desktop", () => {
    const props = makeProps();
    render(<QuestionCard {...props} />);

    const textarea = screen.getByPlaceholderText("Your answer…");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(props.onTextareaEnter).not.toHaveBeenCalled();
  });
});

describe("QuestionCard — Escape key behavior", () => {
  beforeEach(() => {
    mockUseIsMobile.mockReset();
    mockUseIsMobile.mockReturnValue(false);
  });

  it("calls onTextareaEscape when Escape is pressed on desktop", () => {
    const props = makeProps();
    render(<QuestionCard {...props} />);

    const textarea = screen.getByPlaceholderText("Your answer…");
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(props.onTextareaEscape).toHaveBeenCalledTimes(1);
  });

  it("calls onTextareaEscape when Escape is pressed on mobile", () => {
    mockUseIsMobile.mockReturnValue(true);
    const props = makeProps();
    render(<QuestionCard {...props} />);

    const textarea = screen.getByPlaceholderText("Your answer…");
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(props.onTextareaEscape).toHaveBeenCalledTimes(1);
  });
});
