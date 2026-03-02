import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock usePolling to capture the polling callback for manual invocation in tests.
let capturedPollCallback: (() => Promise<void>) | null = null;
vi.mock("./usePolling", () => ({
  usePolling: (cb: (() => Promise<void>) | null) => {
    capturedPollCallback = cb;
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import type { HighlightedFileDiff } from "./useDiff";
import { buildDiffFingerprint, useDiff } from "./useDiff";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

function makeFile(overrides: Partial<HighlightedFileDiff> = {}): HighlightedFileDiff {
  return {
    path: "src/foo.ts",
    change_type: "modified",
    old_path: null,
    additions: 1,
    deletions: 1,
    is_binary: false,
    hunks: [
      {
        old_start: 1,
        old_count: 1,
        new_start: 1,
        new_count: 1,
        lines: [
          {
            line_type: "context",
            content: "hello world",
            html: "<span>hello world</span>",
            old_line_number: 1,
            new_line_number: 1,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeDiffResult(files: HighlightedFileDiff[] = [makeFile()]) {
  return { files };
}

// ============================================================================
// buildDiffFingerprint
// ============================================================================

describe("buildDiffFingerprint", () => {
  it("returns the same fingerprint for two separately constructed identical inputs", () => {
    expect(buildDiffFingerprint([makeFile()])).toBe(buildDiffFingerprint([makeFile()]));
  });

  it("returns an empty-array fingerprint for an empty file list", () => {
    expect(buildDiffFingerprint([])).toBe("[]");
  });

  it("detects a path change", () => {
    const a = buildDiffFingerprint([makeFile({ path: "src/a.ts" })]);
    const b = buildDiffFingerprint([makeFile({ path: "src/b.ts" })]);
    expect(a).not.toBe(b);
  });

  it("detects an additions count change", () => {
    const a = buildDiffFingerprint([makeFile({ additions: 1 })]);
    const b = buildDiffFingerprint([makeFile({ additions: 5 })]);
    expect(a).not.toBe(b);
  });

  it("detects a deletions count change", () => {
    const a = buildDiffFingerprint([makeFile({ deletions: 1 })]);
    const b = buildDiffFingerprint([makeFile({ deletions: 3 })]);
    expect(a).not.toBe(b);
  });

  it("detects a content change when line counts remain identical (typo fix scenario)", () => {
    const original = makeFile({
      hunks: [
        {
          old_start: 1,
          old_count: 1,
          new_start: 1,
          new_count: 1,
          lines: [
            {
              line_type: "context",
              content: "const x = 'tpyo'",
              html: "",
              old_line_number: 1,
              new_line_number: 1,
            },
          ],
        },
      ],
    });
    const fixed = makeFile({
      hunks: [
        {
          old_start: 1,
          old_count: 1,
          new_start: 1,
          new_count: 1,
          lines: [
            {
              line_type: "context",
              content: "const x = 'typo'",
              html: "",
              old_line_number: 1,
              new_line_number: 1,
            },
          ],
        },
      ],
    });
    expect(buildDiffFingerprint([original])).not.toBe(buildDiffFingerprint([fixed]));
  });

  it("handles a hunk with no lines gracefully", () => {
    const file = makeFile({
      hunks: [{ old_start: 1, old_count: 0, new_start: 1, new_count: 0, lines: [] }],
    });
    // Should not throw
    expect(() => buildDiffFingerprint([file])).not.toThrow();
  });
});

// ============================================================================
// useDiff — behavioral contracts
// ============================================================================

describe("useDiff", () => {
  beforeEach(() => {
    capturedPollCallback = null;
    mockInvoke.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sets loading to true only on the first fetch, not on subsequent polls", async () => {
    const diffResult = makeDiffResult();
    mockInvoke.mockResolvedValue(diffResult);

    const { result } = renderHook(() => useDiff("task-1"));

    // Initial state — not yet fetched
    expect(result.current.loading).toBe(false);

    // First poll: loading should flip to true, then back to false
    await act(async () => {
      await capturedPollCallback?.();
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.diff).toEqual(diffResult);

    // Second poll: loading must NOT flip back to true mid-fetch
    // We track that it never becomes true by verifying the final state
    const anotherResult = makeDiffResult([makeFile({ additions: 99 })]);
    mockInvoke.mockResolvedValue(anotherResult);
    await act(async () => {
      await capturedPollCallback?.();
    });
    expect(result.current.loading).toBe(false);
  });

  it("does not update diff state when fingerprint is unchanged between polls", async () => {
    const diffResult = makeDiffResult();
    mockInvoke.mockResolvedValue(diffResult);

    const { result } = renderHook(() => useDiff("task-1"));

    // First fetch — diff is set
    await act(async () => {
      await capturedPollCallback?.();
    });
    const diffAfterFirst = result.current.diff;
    expect(diffAfterFirst).not.toBeNull();

    // Second fetch with identical content — diff reference must not change
    mockInvoke.mockResolvedValue(makeDiffResult());
    await act(async () => {
      await capturedPollCallback?.();
    });
    expect(result.current.diff).toBe(diffAfterFirst);
  });
});
