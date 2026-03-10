/**
 * Tests for useDiffSearch hook.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HighlightedFileDiff, HighlightedHunk, HighlightedLine } from "../../hooks/useDiff";
import { useDiffSearch } from "./useDiffSearch";

// ============================================================================
// Test data builders
// ============================================================================

function makeLine(content: string): HighlightedLine {
  return {
    line_type: "context",
    content,
    html: content,
    old_line_number: 1,
    new_line_number: 1,
  };
}

function makeHunk(lines: string[]): HighlightedHunk {
  return {
    old_start: 1,
    old_count: lines.length,
    new_start: 1,
    new_count: lines.length,
    lines: lines.map(makeLine),
  };
}

function makeFile(
  path: string,
  hunks: string[][],
  opts: { is_binary?: boolean } = {},
): HighlightedFileDiff {
  return {
    path,
    change_type: "modified",
    old_path: null,
    additions: 0,
    deletions: 0,
    is_binary: opts.is_binary ?? false,
    hunks: hunks.map(makeHunk),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("useDiffSearch", () => {
  it("returns no matches when query is empty", () => {
    const files = [makeFile("a.ts", [["hello world"]])];
    const { result } = renderHook(() => useDiffSearch(files));

    expect(result.current.matches).toHaveLength(0);
    expect(result.current.count).toBe(0);
    expect(result.current.currentIndex).toBe(-1);
    expect(result.current.currentMatch).toBeNull();
  });

  it("finds a single match in a single file", () => {
    const files = [makeFile("a.ts", [["hello world"]])];
    const { result } = renderHook(() => useDiffSearch(files));

    act(() => result.current.setQuery("world"));

    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0]).toMatchObject({
      fileIndex: 0,
      hunkIndex: 0,
      lineIndex: 0,
      charStart: 6,
      charEnd: 11,
    });
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.currentMatch).not.toBeNull();
  });

  it("finds matches across multiple files", () => {
    const files = [makeFile("a.ts", [["foo bar"]]), makeFile("b.ts", [["foo baz foo"]])];
    const { result } = renderHook(() => useDiffSearch(files));

    act(() => result.current.setQuery("foo"));

    // file 0: 1 match; file 1: 2 matches
    expect(result.current.matches).toHaveLength(3);
    expect(result.current.matches[0]).toMatchObject({ fileIndex: 0 });
    expect(result.current.matches[1]).toMatchObject({ fileIndex: 1, charStart: 0 });
    expect(result.current.matches[2]).toMatchObject({ fileIndex: 1, charStart: 8 });
  });

  it("skips binary files", () => {
    const files = [makeFile("img.png", [["foo"]], { is_binary: true })];
    const { result } = renderHook(() => useDiffSearch(files));

    act(() => result.current.setQuery("foo"));

    expect(result.current.matches).toHaveLength(0);
  });

  it("next() advances to the next match and wraps around", () => {
    const files = [makeFile("a.ts", [["aa aa aa"]])];
    const { result } = renderHook(() => useDiffSearch(files));

    act(() => result.current.setQuery("aa"));

    // "aa aa aa": matches at positions 0, 3, 6 (indexOf advances by 1 each time)
    expect(result.current.matches).toHaveLength(3);
    expect(result.current.currentIndex).toBe(0);

    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(1);

    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(2);

    act(() => result.current.next());
    // wraps to 0
    expect(result.current.currentIndex).toBe(0);
  });

  it("prev() wraps around to last match", () => {
    const files = [makeFile("a.ts", [["aa aa"]])];
    const { result } = renderHook(() => useDiffSearch(files));

    act(() => result.current.setQuery("aa"));

    expect(result.current.currentIndex).toBe(0);

    act(() => result.current.prev());
    // wraps to last
    expect(result.current.currentIndex).toBe(result.current.matches.length - 1);
  });

  it("changing query resets currentIndex to 0", () => {
    const files = [makeFile("a.ts", [["foo bar baz"]])];
    const { result } = renderHook(() => useDiffSearch(files));

    act(() => result.current.setQuery("foo"));
    act(() => result.current.next()); // index should be 0, but next() is called
    // With one match, next() wraps back to 0
    expect(result.current.currentIndex).toBe(0);

    act(() => result.current.setQuery("bar"));
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.matches[0]).toMatchObject({ charStart: 4, charEnd: 7 });
  });

  it("clearing query resets to no matches", () => {
    const files = [makeFile("a.ts", [["hello"]])];
    const { result } = renderHook(() => useDiffSearch(files));

    act(() => result.current.setQuery("hello"));
    expect(result.current.count).toBe(1);

    act(() => result.current.setQuery(""));
    expect(result.current.count).toBe(0);
    expect(result.current.currentIndex).toBe(-1);
    expect(result.current.currentMatch).toBeNull();
  });

  it("recomputes matches when files prop changes", () => {
    const initialFiles = [makeFile("a.ts", [["hello"]])];
    const { result, rerender } = renderHook(
      ({ files }: { files: HighlightedFileDiff[] }) => useDiffSearch(files),
      { initialProps: { files: initialFiles } },
    );

    act(() => result.current.setQuery("hello"));
    expect(result.current.count).toBe(1);

    // New files with two matches
    const newFiles = [makeFile("b.ts", [["hello hello"]])];
    rerender({ files: newFiles });

    expect(result.current.count).toBe(2);
  });

  it("matches case-insensitively", () => {
    const files = [makeFile("a.ts", [["Hello WORLD"]])];
    const { result } = renderHook(() => useDiffSearch(files));

    act(() => result.current.setQuery("hello"));
    expect(result.current.count).toBe(1);
    expect(result.current.matches[0]).toMatchObject({ charStart: 0, charEnd: 5 });

    act(() => result.current.setQuery("world"));
    expect(result.current.count).toBe(1);
    expect(result.current.matches[0]).toMatchObject({ charStart: 6, charEnd: 11 });
  });

  it("charEnd equals charStart + query.length (original case preserved in bounds)", () => {
    const files = [makeFile("a.ts", [["Hello"]])];
    const { result } = renderHook(() => useDiffSearch(files));

    act(() => result.current.setQuery("hello"));
    expect(result.current.matches[0]).toMatchObject({ charStart: 0, charEnd: 5 });
  });
});
