import { describe, expect, it } from "vitest";
import { createMockWorkflowTaskView } from "../test/mocks/fixtures";
import { isActivelyProgressing } from "./taskStatus";

describe("isActivelyProgressing", () => {
  it("returns true when is_working", () => {
    const task = createMockWorkflowTaskView({ derived: { is_working: true } });
    expect(isActivelyProgressing(task)).toBe(true);
  });

  it("returns true when is_preparing", () => {
    const task = createMockWorkflowTaskView({ derived: { is_preparing: true } });
    expect(isActivelyProgressing(task)).toBe(true);
  });

  it("returns true when is_system_active and not integrating", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "queued", stage: "planning" },
      derived: { is_system_active: true },
    });
    expect(isActivelyProgressing(task)).toBe(true);
  });

  it("returns false when is_system_active but integrating", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "integrating" },
      derived: { is_system_active: true },
    });
    expect(isActivelyProgressing(task)).toBe(false);
  });

  it("returns true when is_waiting_on_children", () => {
    const task = createMockWorkflowTaskView({
      derived: { is_waiting_on_children: true },
    });
    expect(isActivelyProgressing(task)).toBe(true);
  });

  it("returns false when all flags are false", () => {
    const task = createMockWorkflowTaskView({ derived: { is_preparing: false } });
    expect(isActivelyProgressing(task)).toBe(false);
  });
});
