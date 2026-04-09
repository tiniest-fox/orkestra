// Tests for Drawer — outside-click-to-close and escape key behavior.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "../../../hooks/useIsMobile";
import { ModalPanel } from "../ModalPanel";
import { Drawer } from "./Drawer";

vi.mock("../../../hooks/useIsMobile", () => ({
  useIsMobile: vi.fn(() => false),
}));

describe("Drawer", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockReset();
    vi.mocked(useIsMobile).mockReturnValue(false);
  });

  // -- Outside click --

  it("calls onClose when clicking outside the panel on desktop", () => {
    render(
      <Drawer onClose={onClose}>
        <span>content</span>
      </Drawer>,
    );
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose when clicking inside the panel", () => {
    render(
      <Drawer onClose={onClose}>
        <span>content</span>
      </Drawer>,
    );
    fireEvent.mouseDown(screen.getByText("content"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close on outside click when disableEscape is true", () => {
    render(
      <Drawer onClose={onClose} disableEscape>
        <span>content</span>
      </Drawer>,
    );
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close on outside click on mobile", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(
      <Drawer onClose={onClose}>
        <span>content</span>
      </Drawer>,
    );
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close drawer when clicking inside an open ModalPanel", () => {
    render(
      <>
        <Drawer onClose={onClose}>
          <span>drawer content</span>
        </Drawer>
        <ModalPanel isOpen onClose={() => {}}>
          <span>modal content</span>
        </ModalPanel>
      </>,
    );
    fireEvent.mouseDown(screen.getByText("modal content"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
