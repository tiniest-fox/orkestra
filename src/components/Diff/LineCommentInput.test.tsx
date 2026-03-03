/**
 * Tests for LineCommentInput controlled mode.
 *
 * Controlled mode (value + onChange) preserves draft text across virtualized
 * unmount/remount cycles — the parent owns the state and passes it back in.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { LineCommentInput } from "./LineCommentInput";

describe("LineCommentInput controlled mode", () => {
  it("renders the provided value in the textarea", () => {
    render(
      <LineCommentInput
        onSave={vi.fn()}
        onCancel={vi.fn()}
        value="existing draft"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("existing draft");
  });

  it("typing calls onChange with the new value, not local state", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    // Use a stateful wrapper so the controlled input receives updated values
    // between keystrokes — simulates the real parent-owned-state pattern.
    function Wrapper() {
      const [value, setValue] = useState("");
      return (
        <LineCommentInput
          onSave={vi.fn()}
          onCancel={vi.fn()}
          value={value}
          onChange={(v) => {
            setValue(v);
            onChange(v);
          }}
        />
      );
    }

    render(<Wrapper />);
    await user.type(screen.getByRole("textbox"), "hello");
    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith("hello");
  });

  it("pressing Enter calls onSave with the controlled value", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <LineCommentInput onSave={onSave} onCancel={vi.fn()} value="my comment" onChange={vi.fn()} />,
    );

    await user.keyboard("{Enter}");
    expect(onSave).toHaveBeenCalledWith("my comment");
  });

  it("re-rendering with a new value prop updates the textarea content", () => {
    const { rerender } = render(
      <LineCommentInput onSave={vi.fn()} onCancel={vi.fn()} value="first" onChange={vi.fn()} />,
    );

    expect(screen.getByRole("textbox")).toHaveValue("first");

    rerender(
      <LineCommentInput onSave={vi.fn()} onCancel={vi.fn()} value="updated" onChange={vi.fn()} />,
    );

    expect(screen.getByRole("textbox")).toHaveValue("updated");
  });
});
