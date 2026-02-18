/**
 * Tests for Dropdown component - interactive menu anchored to a trigger element.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dropdown } from "./Dropdown";

describe("Dropdown", () => {
  // -- Uncontrolled mode --

  it("opens on trigger click in uncontrolled mode", () => {
    render(
      <Dropdown
        trigger={({ onClick }) => (
          <button type="button" onClick={onClick}>
            Open
          </button>
        )}
      >
        <Dropdown.Item>Item 1</Dropdown.Item>
      </Dropdown>,
    );

    expect(screen.queryByText("Item 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByText("Item 1")).toBeInTheDocument();
  });

  it("closes on second trigger click in uncontrolled mode", () => {
    render(
      <Dropdown
        trigger={({ onClick }) => (
          <button type="button" onClick={onClick}>
            Open
          </button>
        )}
      >
        <Dropdown.Item>Item 1</Dropdown.Item>
      </Dropdown>,
    );

    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByText("Item 1")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Open"));
    expect(screen.queryByText("Item 1")).not.toBeInTheDocument();
  });

  // -- Controlled mode --

  it("respects controlled open prop", () => {
    const { rerender } = render(
      <Dropdown
        trigger={({ onClick }) => (
          <button type="button" onClick={onClick}>
            Open
          </button>
        )}
        open={false}
        onOpenChange={vi.fn()}
      >
        <Dropdown.Item>Item 1</Dropdown.Item>
      </Dropdown>,
    );

    expect(screen.queryByText("Item 1")).not.toBeInTheDocument();

    rerender(
      <Dropdown
        trigger={({ onClick }) => (
          <button type="button" onClick={onClick}>
            Open
          </button>
        )}
        open={true}
        onOpenChange={vi.fn()}
      >
        <Dropdown.Item>Item 1</Dropdown.Item>
      </Dropdown>,
    );

    expect(screen.getByText("Item 1")).toBeInTheDocument();
  });

  it("calls onOpenChange on toggle in controlled mode", () => {
    const onOpenChange = vi.fn();
    render(
      <Dropdown
        trigger={({ onClick }) => (
          <button type="button" onClick={onClick}>
            Open
          </button>
        )}
        open={false}
        onOpenChange={onOpenChange}
      >
        <Dropdown.Item>Item 1</Dropdown.Item>
      </Dropdown>,
    );

    fireEvent.click(screen.getByText("Open"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  // -- Click outside --

  it("closes dropdown when clicking outside", () => {
    render(
      <div>
        <Dropdown
          trigger={({ onClick }) => (
            <button type="button" onClick={onClick}>
              Open
            </button>
          )}
        >
          <Dropdown.Item>Item 1</Dropdown.Item>
        </Dropdown>
        <div data-testid="outside">Outside</div>
      </div>,
    );

    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByText("Item 1")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByText("Item 1")).not.toBeInTheDocument();
  });

  // -- ESC key --

  it("closes dropdown on ESC key press", () => {
    render(
      <Dropdown
        trigger={({ onClick }) => (
          <button type="button" onClick={onClick}>
            Open
          </button>
        )}
      >
        <Dropdown.Item>Item 1</Dropdown.Item>
      </Dropdown>,
    );

    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByText("Item 1")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Item 1")).not.toBeInTheDocument();
  });

  // -- Item click --

  it("triggers onClick callback when item is clicked", () => {
    const handleClick = vi.fn();
    render(
      <Dropdown
        trigger={({ onClick }) => (
          <button type="button" onClick={onClick}>
            Open
          </button>
        )}
      >
        <Dropdown.Item onClick={handleClick}>Click me</Dropdown.Item>
      </Dropdown>,
    );

    fireEvent.click(screen.getByText("Open"));
    fireEvent.click(screen.getByText("Click me"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  // -- Alignment --

  it("applies left-0 class when align is left (default)", () => {
    render(
      <Dropdown
        trigger={({ onClick }) => (
          <button type="button" onClick={onClick}>
            Open
          </button>
        )}
      >
        <Dropdown.Item>Item 1</Dropdown.Item>
      </Dropdown>,
    );

    fireEvent.click(screen.getByText("Open"));
    const menu = screen.getByText("Item 1").closest("div[class*='absolute']");
    expect(menu).toHaveClass("left-0");
    expect(menu).not.toHaveClass("right-0");
  });

  it("applies right-0 class when align is right", () => {
    render(
      <Dropdown
        trigger={({ onClick }) => (
          <button type="button" onClick={onClick}>
            Open
          </button>
        )}
        align="right"
      >
        <Dropdown.Item>Item 1</Dropdown.Item>
      </Dropdown>,
    );

    fireEvent.click(screen.getByText("Open"));
    const menu = screen.getByText("Item 1").closest("div[class*='absolute']");
    expect(menu).toHaveClass("right-0");
    expect(menu).not.toHaveClass("left-0");
  });
});
