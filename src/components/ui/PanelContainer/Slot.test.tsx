import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContentAnimation } from "../ContentAnimation";
import { PanelLayout } from "./PanelLayout";
import { Slot } from "./Slot";
import { ANIMATION_CONFIG } from "./types";

// Component to read animation context and expose phase values
function PhaseReader({ slotId }: { slotId: string }) {
  const { phases } = useContentAnimation();
  return <div data-testid="phase">{phases[slotId] ?? "none"}</div>;
}

describe("Slot phase transitions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initializes with settled phase when visible=true", () => {
    render(
      <PanelLayout>
        <Slot id="test" type="grow" visible={true}>
          <PhaseReader slotId="test" />
        </Slot>
      </PanelLayout>,
    );

    expect(screen.getByTestId("phase")).toHaveTextContent("settled");
  });

  it("initializes with hidden phase when visible=false", () => {
    render(
      <PanelLayout>
        <Slot id="test" type="grow" visible={false}>
          <PhaseReader slotId="test" />
        </Slot>
      </PanelLayout>,
    );

    expect(screen.getByTestId("phase")).toHaveTextContent("hidden");
  });

  it("transitions to entering then settled when visible changes false→true", async () => {
    const { rerender } = render(
      <PanelLayout>
        <Slot id="test" type="grow" visible={false}>
          <PhaseReader slotId="test" />
        </Slot>
      </PanelLayout>,
    );

    expect(screen.getByTestId("phase")).toHaveTextContent("hidden");

    // Change visibility to true
    await act(async () => {
      rerender(
        <PanelLayout>
          <Slot id="test" type="grow" visible={true}>
            <PhaseReader slotId="test" />
          </Slot>
        </PanelLayout>,
      );
    });

    // Should transition to entering
    expect(screen.getByTestId("phase")).toHaveTextContent("entering");

    // After animation duration, should transition to settled
    await act(async () => {
      vi.advanceTimersByTime(ANIMATION_CONFIG.duration * 1000);
    });

    expect(screen.getByTestId("phase")).toHaveTextContent("settled");
  });

  it("transitions to exiting when visible changes true→false", async () => {
    const { rerender } = render(
      <PanelLayout>
        <Slot id="test" type="grow" visible={true}>
          <PhaseReader slotId="test" />
        </Slot>
      </PanelLayout>,
    );

    expect(screen.getByTestId("phase")).toHaveTextContent("settled");

    // Change visibility to false
    await act(async () => {
      rerender(
        <PanelLayout>
          <Slot id="test" type="grow" visible={false}>
            <PhaseReader slotId="test" />
          </Slot>
        </PanelLayout>,
      );
    });

    // Should transition to exiting
    expect(screen.getByTestId("phase")).toHaveTextContent("exiting");
  });

  it("transitions through entering→settled on content switch", async () => {
    const { rerender } = render(
      <PanelLayout>
        <Slot id="test" type="grow" visible={true} contentKey="content-a">
          <PhaseReader slotId="test" />
        </Slot>
      </PanelLayout>,
    );

    expect(screen.getByTestId("phase")).toHaveTextContent("settled");

    // Switch content
    await act(async () => {
      rerender(
        <PanelLayout>
          <Slot id="test" type="grow" visible={true} contentKey="content-b">
            <PhaseReader slotId="test" />
          </Slot>
        </PanelLayout>,
      );
    });

    // Should be in entering during content switch animation
    expect(screen.getByTestId("phase")).toHaveTextContent("entering");

    // After animation duration, should transition to settled
    await act(async () => {
      vi.advanceTimersByTime(ANIMATION_CONFIG.duration * 1000);
    });

    expect(screen.getByTestId("phase")).toHaveTextContent("settled");
  });

  it("cleanup functions prevent stale timers on rapid visibility toggles", async () => {
    const { rerender } = render(
      <PanelLayout>
        <Slot id="test" type="grow" visible={false}>
          <PhaseReader slotId="test" />
        </Slot>
      </PanelLayout>,
    );

    // Toggle true
    await act(async () => {
      rerender(
        <PanelLayout>
          <Slot id="test" type="grow" visible={true}>
            <PhaseReader slotId="test" />
          </Slot>
        </PanelLayout>,
      );
    });

    expect(screen.getByTestId("phase")).toHaveTextContent("entering");

    // Toggle false before animation completes (halfway through)
    await act(async () => {
      vi.advanceTimersByTime((ANIMATION_CONFIG.duration * 1000) / 2);
    });

    await act(async () => {
      rerender(
        <PanelLayout>
          <Slot id="test" type="grow" visible={false}>
            <PhaseReader slotId="test" />
          </Slot>
        </PanelLayout>,
      );
    });

    // Should now be exiting
    expect(screen.getByTestId("phase")).toHaveTextContent("exiting");

    // Advance past when the original timer would have fired
    await act(async () => {
      vi.advanceTimersByTime(ANIMATION_CONFIG.duration * 1000);
    });

    // Should still be exiting (stale timer was cleaned up)
    expect(screen.getByTestId("phase")).toHaveTextContent("exiting");
  });

  it("handles multiple slots independently", async () => {
    const { rerender } = render(
      <PanelLayout>
        <Slot id="slot-a" type="grow" visible={true}>
          <PhaseReader slotId="slot-a" />
        </Slot>
        <Slot id="slot-b" type="grow" visible={false}>
          <PhaseReader slotId="slot-b" />
        </Slot>
      </PanelLayout>,
    );

    const phases = screen.getAllByTestId("phase");
    expect(phases[0]).toHaveTextContent("settled");
    expect(phases[1]).toHaveTextContent("hidden");

    // Toggle slot-b visible
    await act(async () => {
      rerender(
        <PanelLayout>
          <Slot id="slot-a" type="grow" visible={true}>
            <PhaseReader slotId="slot-a" />
          </Slot>
          <Slot id="slot-b" type="grow" visible={true}>
            <PhaseReader slotId="slot-b" />
          </Slot>
        </PanelLayout>,
      );
    });

    const phasesAfter = screen.getAllByTestId("phase");
    expect(phasesAfter[0]).toHaveTextContent("settled"); // slot-a unchanged
    expect(phasesAfter[1]).toHaveTextContent("entering"); // slot-b now entering

    // After animation, slot-b should settle
    await act(async () => {
      vi.advanceTimersByTime(ANIMATION_CONFIG.duration * 1000);
    });

    const phasesFinal = screen.getAllByTestId("phase");
    expect(phasesFinal[0]).toHaveTextContent("settled");
    expect(phasesFinal[1]).toHaveTextContent("settled");
  });
});
