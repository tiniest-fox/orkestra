import { describe, it, expect, beforeEach } from "vitest";
import { screen, render } from "@testing-library/react";
import { resetMocks } from "../test/mocks/tauri";
import { CreateTaskModal } from "./CreateTaskModal";

describe("CreateTaskModal", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("renders when open", () => {
    render(
      <CreateTaskModal
        isOpen={true}
        onClose={() => {}}
        onSubmit={() => Promise.resolve()}
      />
    );

    expect(screen.getByText("New Task")).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(
      <CreateTaskModal
        isOpen={false}
        onClose={() => {}}
        onSubmit={() => Promise.resolve()}
      />
    );

    expect(screen.queryByText("New Task")).not.toBeInTheDocument();
  });

  it("shows create task button", () => {
    render(
      <CreateTaskModal
        isOpen={true}
        onClose={() => {}}
        onSubmit={() => Promise.resolve()}
      />
    );

    expect(
      screen.getByRole("button", { name: /create task/i })
    ).toBeInTheDocument();
  });
});
