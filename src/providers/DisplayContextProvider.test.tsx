import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DisplayContextProvider, useDisplayContext } from "./DisplayContextProvider";

function TestComponent() {
  const { layout, switchToArchive, switchToActive } = useDisplayContext();
  return (
    <div>
      <div data-testid="is-archive">{layout.isArchive ? "archive" : "board"}</div>
      <button type="button" onClick={switchToArchive}>
        Switch to Archived
      </button>
      <button type="button" onClick={switchToActive}>
        Switch to Active
      </button>
    </div>
  );
}

describe("DisplayContextProvider", () => {
  it("defaults to board view", () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    expect(screen.getByTestId("is-archive")).toHaveTextContent("board");
  });

  it("switchToArchive() changes view to archive", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    expect(screen.getByTestId("is-archive")).toHaveTextContent("board");

    await act(async () => {
      screen.getByText("Switch to Archived").click();
    });

    expect(screen.getByTestId("is-archive")).toHaveTextContent("archive");
  });

  it("switchToActive() changes view back to board", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    // Switch to archive first
    await act(async () => {
      screen.getByText("Switch to Archived").click();
    });

    expect(screen.getByTestId("is-archive")).toHaveTextContent("archive");

    // Switch back to active
    await act(async () => {
      screen.getByText("Switch to Active").click();
    });

    expect(screen.getByTestId("is-archive")).toHaveTextContent("board");
  });
});
