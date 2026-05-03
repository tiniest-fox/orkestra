// Tests for prStatus — shared PR status predicates.

import { describe, expect, it } from "vitest";
import type { PrStatus } from "../types/workflow";
import { hasConflicts } from "./prStatus";

function makeStatus(overrides: Partial<PrStatus> = {}): PrStatus {
  return {
    url: "https://github.com/owner/repo/pull/1",
    state: "open",
    checks: [],
    reviews: [],
    comments: [],
    fetched_at: "2025-01-01T00:00:00Z",
    mergeable: true,
    merge_state_status: null,
    ...overrides,
  };
}

describe("hasConflicts", () => {
  it("returns false when mergeable and no DIRTY status", () => {
    expect(hasConflicts(makeStatus())).toBe(false);
  });

  it("returns true when merge_state_status is DIRTY", () => {
    expect(hasConflicts(makeStatus({ merge_state_status: "DIRTY" }))).toBe(true);
  });

  it("returns true when mergeable is false", () => {
    expect(hasConflicts(makeStatus({ mergeable: false }))).toBe(true);
  });

  it("returns false when mergeable is null (not yet computed)", () => {
    expect(hasConflicts(makeStatus({ mergeable: null }))).toBe(false);
  });
});
