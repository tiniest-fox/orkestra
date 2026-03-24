import { describe, expect, it } from "vitest";
import type { HighlightedHunk, HighlightedLine, HighlightedTaskDiff } from "../../hooks/useDiff";
import { applySplice } from "./applySplice";

// -- Helpers --

function makeLine(newNum: number, oldNum: number, content = `line ${newNum}`): HighlightedLine {
  return {
    line_type: "context",
    content,
    html: content,
    new_line_number: newNum,
    old_line_number: oldNum,
  };
}

function makeHunk(newStart: number, oldStart: number, lineCount: number): HighlightedHunk {
  const lines: HighlightedLine[] = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(makeLine(newStart + i, oldStart + i, `line ${newStart + i}`));
  }
  return {
    new_start: newStart,
    old_start: oldStart,
    new_count: lineCount,
    old_count: lineCount,
    lines,
  };
}

function makeRawLines(count: number): HighlightedLine[] {
  return Array.from({ length: count }, (_, i) => makeLine(i + 1, i + 1, `raw line ${i + 1}`));
}

function makeDiff(hunks: HighlightedHunk[], path = "test.ts"): HighlightedTaskDiff {
  return {
    files: [
      {
        path,
        change_type: "modified",
        old_path: null,
        additions: 0,
        deletions: 0,
        is_binary: false,
        hunks,
      },
    ],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("applySplice", () => {
  describe("above", () => {
    it("expands above the first hunk", () => {
      const hunk = makeHunk(11, 11, 5);
      const diff = makeDiff([hunk]);
      const rawLines = makeRawLines(30);

      const { diff: result, didMerge } = applySplice(diff, "test.ts", rawLines, 0, "above", 3);

      const resultHunk = result.files[0].hunks[0];
      expect(resultHunk.new_start).toBe(8);
      expect(resultHunk.old_start).toBe(8);
      expect(resultHunk.new_count).toBe(8);
      expect(resultHunk.old_count).toBe(8);
      expect(resultHunk.lines[0].new_line_number).toBe(8);
      expect(resultHunk.lines[1].new_line_number).toBe(9);
      expect(resultHunk.lines[2].new_line_number).toBe(10);
      expect(didMerge).toBe(false);
    });

    it("clamps to available lines", () => {
      const hunk = makeHunk(3, 3, 5);
      const diff = makeDiff([hunk]);
      const rawLines = makeRawLines(20);

      const { diff: result, didMerge } = applySplice(diff, "test.ts", rawLines, 0, "above", 10);

      const resultHunk = result.files[0].hunks[0];
      expect(resultHunk.new_start).toBe(1);
      expect(resultHunk.new_count).toBe(7); // 5 original + 2 prepended
      expect(resultHunk.lines.length).toBe(7);
      expect(resultHunk.lines[0].new_line_number).toBe(1);
      expect(didMerge).toBe(false);
    });
  });

  describe("below", () => {
    it("expands below the last hunk", () => {
      const hunk = makeHunk(5, 5, 5);
      const diff = makeDiff([hunk]);
      const rawLines = makeRawLines(20);

      const { diff: result, didMerge } = applySplice(diff, "test.ts", rawLines, 0, "below", 3);

      const resultHunk = result.files[0].hunks[0];
      expect(resultHunk.new_count).toBe(8);
      expect(resultHunk.old_count).toBe(8);
      expect(resultHunk.lines.length).toBe(8);
      expect(resultHunk.lines[5].new_line_number).toBe(10);
      expect(resultHunk.lines[6].new_line_number).toBe(11);
      expect(resultHunk.lines[7].new_line_number).toBe(12);
      expect(didMerge).toBe(false);
    });

    it("clamps to file end", () => {
      // Hunk covers lines 9-18 (new_start=9, count=10), rawLines has 20 lines.
      const hunk = makeHunk(9, 9, 10);
      const diff = makeDiff([hunk]);
      const rawLines = makeRawLines(20);

      const { diff: result, didMerge } = applySplice(diff, "test.ts", rawLines, 0, "below", 10);

      const resultHunk = result.files[0].hunks[0];
      // Lines 19 and 20 can be appended (2 lines)
      expect(resultHunk.lines.length).toBe(12);
      expect(resultHunk.lines[10].new_line_number).toBe(19);
      expect(resultHunk.lines[11].new_line_number).toBe(20);
      expect(didMerge).toBe(false);
    });
  });

  describe("between", () => {
    it("expands from bottom of hunk A toward hunk B", () => {
      const hunkA = makeHunk(5, 5, 5); // lines 5-9
      const hunkB = makeHunk(20, 20, 5); // lines 20-24, gap of 10
      const diff = makeDiff([hunkA, hunkB]);
      const rawLines = makeRawLines(30);

      const { diff: result, didMerge } = applySplice(diff, "test.ts", rawLines, 0, "between", 4);

      const resultA = result.files[0].hunks[0];
      const resultB = result.files[0].hunks[1];
      expect(resultA.new_count).toBe(9); // 5 + 4
      expect(resultA.old_count).toBe(9);
      expect(resultA.lines.length).toBe(9);
      expect(resultA.lines[5].new_line_number).toBe(10);
      expect(resultB.new_start).toBe(20); // hunk B unchanged
      expect(resultB.new_count).toBe(5);
      expect(didMerge).toBe(false);
    });

    it("closes the gap and merges hunks", () => {
      const hunkA = makeHunk(5, 5, 5); // lines 5-9
      const hunkB = makeHunk(20, 20, 5); // lines 20-24, gap of 10
      const diff = makeDiff([hunkA, hunkB]);
      const rawLines = makeRawLines(30);

      const { diff: result, didMerge } = applySplice(diff, "test.ts", rawLines, 0, "between", 10);

      expect(result.files[0].hunks.length).toBe(1);
      const merged = result.files[0].hunks[0];
      expect(merged.new_start).toBe(5);
      expect(merged.new_count).toBe(20); // 5 + 10 + 5
      expect(merged.lines.length).toBe(20);
      expect(didMerge).toBe(true);
    });

    it("no hunkBelow returns unchanged", () => {
      const hunk = makeHunk(5, 5, 5);
      const diff = makeDiff([hunk]);
      const rawLines = makeRawLines(20);

      const { diff: result, didMerge } = applySplice(diff, "test.ts", rawLines, 0, "between", 4);

      expect(result).toEqual(diff);
      expect(didMerge).toBe(false);
    });
  });

  describe("between-up", () => {
    it("expands upward from hunk B toward hunk A", () => {
      const hunkA = makeHunk(5, 5, 5); // lines 5-9
      const hunkB = makeHunk(20, 20, 5); // lines 20-24, gap of 10
      const diff = makeDiff([hunkA, hunkB]);
      const rawLines = makeRawLines(30);

      const { diff: result, didMerge } = applySplice(diff, "test.ts", rawLines, 0, "between-up", 4);

      const resultA = result.files[0].hunks[0];
      const resultB = result.files[0].hunks[1];
      expect(resultB.new_start).toBe(16); // 20 - 4
      expect(resultB.old_start).toBe(16);
      expect(resultB.new_count).toBe(9); // 5 + 4
      expect(resultB.old_count).toBe(9);
      expect(resultB.lines.length).toBe(9);
      expect(resultB.lines[0].new_line_number).toBe(16);
      expect(resultA.new_start).toBe(5); // hunk A unchanged
      expect(resultA.new_count).toBe(5);
      expect(didMerge).toBe(false);
    });

    it("closes the gap and merges hunks", () => {
      const hunkA = makeHunk(5, 5, 5); // lines 5-9
      const hunkB = makeHunk(20, 20, 5); // lines 20-24, gap of 10
      const diff = makeDiff([hunkA, hunkB]);
      const rawLines = makeRawLines(30);

      const { diff: result, didMerge } = applySplice(
        diff,
        "test.ts",
        rawLines,
        0,
        "between-up",
        10,
      );

      expect(result.files[0].hunks.length).toBe(1);
      const merged = result.files[0].hunks[0];
      expect(merged.new_start).toBe(5); // starts at hunk A
      expect(merged.lines.length).toBe(20); // 5 + 10 + 5
      // hunk A lines first, then context, then hunk B lines
      expect(merged.lines[0].new_line_number).toBe(5);
      expect(merged.lines[9].new_line_number).toBe(14); // last context line (index 4+5=9)
      expect(merged.lines[15].new_line_number).toBe(20); // first line of hunk B (index 5+10=15)
      expect(didMerge).toBe(true);
    });

    it("no hunkBelow returns unchanged", () => {
      const hunk = makeHunk(5, 5, 5);
      const diff = makeDiff([hunk]);
      const rawLines = makeRawLines(20);

      const { diff: result, didMerge } = applySplice(diff, "test.ts", rawLines, 0, "between-up", 4);

      expect(result).toEqual(diff);
      expect(didMerge).toBe(false);
    });
  });

  it("non-matching file path passes through unchanged", () => {
    const hunk = makeHunk(5, 5, 5);
    const diff = makeDiff([hunk]);
    const rawLines = makeRawLines(20);

    const { diff: result, didMerge } = applySplice(diff, "other.ts", rawLines, 0, "above", 3);

    expect(result.files[0]).toBe(diff.files[0]);
    expect(didMerge).toBe(false);
  });
});
