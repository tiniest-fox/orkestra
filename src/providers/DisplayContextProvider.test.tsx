import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DisplayContextProvider, useDisplayContext } from "./DisplayContextProvider";

function TestComponent() {
  const { view, switchToArchived, switchToActive } = useDisplayContext();
  return (
    <div>
      <div data-testid="view-type">{view.type}</div>
      <button type="button" onClick={switchToArchived}>
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

    expect(screen.getByTestId("view-type")).toHaveTextContent("board");
  });

  it("switchToArchived() changes view to archive", async () => {
    render(
      <DisplayContextProvider>
        <TestComponent />
      </DisplayContextProvider>,
    );

    expect(screen.getByTestId("view-type")).toHaveTextContent("board");

    await act(async () => {
      screen.getByText("Switch to Archived").click();
    });

    expect(screen.getByTestId("view-type")).toHaveTextContent("archive");
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

    expect(screen.getByTestId("view-type")).toHaveTextContent("archive");

    // Switch back to active
    await act(async () => {
      screen.getByText("Switch to Active").click();
    });

    expect(screen.getByTestId("view-type")).toHaveTextContent("board");
  });
});
