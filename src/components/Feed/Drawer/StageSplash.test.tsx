// Tests for getSplashLabel and StageSplash component.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TaskState } from "../../../types/workflow";
import { getSplashLabel, StageSplash } from "./StageSplash";

// ============================================================================
// getSplashLabel tests
// ============================================================================

describe("getSplashLabel — splash states", () => {
  it("returns correct label for awaiting_setup", () => {
    const state: TaskState = { type: "awaiting_setup", stage: "work" };
    expect(getSplashLabel(state)).toBe("Awaiting setup…");
  });

  it("returns correct label for setting_up", () => {
    const state: TaskState = { type: "setting_up", stage: "work" };
    expect(getSplashLabel(state)).toBe("Setting up worktree…");
  });

  it("returns correct label for finishing", () => {
    const state: TaskState = { type: "finishing", stage: "work" };
    expect(getSplashLabel(state)).toBe("Finishing…");
  });

  it("returns correct label for committing", () => {
    const state: TaskState = { type: "committing", stage: "work" };
    expect(getSplashLabel(state)).toBe("Committing changes…");
  });

  it("returns correct label for committed", () => {
    const state: TaskState = { type: "committed", stage: "work" };
    expect(getSplashLabel(state)).toBe("Committing changes…");
  });

  it("returns correct label for integrating", () => {
    const state: TaskState = { type: "integrating" };
    expect(getSplashLabel(state)).toBe("Integrating…");
  });
});

describe("getSplashLabel — non-splash states return null", () => {
  it("returns null for queued", () => {
    const state: TaskState = { type: "queued", stage: "work" };
    expect(getSplashLabel(state)).toBeNull();
  });

  it("returns null for agent_working", () => {
    const state: TaskState = { type: "agent_working", stage: "work" };
    expect(getSplashLabel(state)).toBeNull();
  });

  it("returns null for done", () => {
    const state: TaskState = { type: "done" };
    expect(getSplashLabel(state)).toBeNull();
  });

  it("returns null for awaiting_approval", () => {
    const state: TaskState = { type: "awaiting_approval", stage: "review" };
    expect(getSplashLabel(state)).toBeNull();
  });

  it("returns null for failed", () => {
    const state: TaskState = { type: "failed" };
    expect(getSplashLabel(state)).toBeNull();
  });
});

// ============================================================================
// StageSplash component tests
// ============================================================================

describe("StageSplash", () => {
  it("renders the spinner element", () => {
    render(<StageSplash label="Setting up worktree…" />);
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
  });

  it("renders the label text", () => {
    render(<StageSplash label="Integrating…" />);
    expect(screen.getByText("Integrating…")).toBeDefined();
  });
});
