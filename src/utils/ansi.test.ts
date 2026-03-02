import { describe, expect, it } from "vitest";
import { parseAnsiSegments, stripAnsi } from "./ansi";

describe("stripAnsi", () => {
  it("passes plain text through unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("removes a single color code", () => {
    expect(stripAnsi("\x1b[32mgreen\x1b[0m")).toBe("green");
  });

  it("removes multiple color codes", () => {
    expect(stripAnsi("\x1b[31merror\x1b[0m and \x1b[33mwarning\x1b[0m")).toBe("error and warning");
  });

  it("removes bold codes", () => {
    expect(stripAnsi("\x1b[1mbold\x1b[0m")).toBe("bold");
  });

  it("removes compound codes (bold + color)", () => {
    expect(stripAnsi("\x1b[1;32mbold green\x1b[0m")).toBe("bold green");
  });

  it("handles bare reset code", () => {
    expect(stripAnsi("\x1b[m")).toBe("");
  });

  it("handles multi-line input", () => {
    const input = "\x1b[32mCompiling\x1b[0m foo v1.0\n\x1b[31merror\x1b[0m: oops";
    expect(stripAnsi(input)).toBe("Compiling foo v1.0\nerror: oops");
  });
});

describe("parseAnsiSegments", () => {
  it("returns single unstyled segment for plain text", () => {
    const segs = parseAnsiSegments("hello");
    expect(segs).toEqual([{ text: "hello", classes: [] }]);
  });

  it("maps green (32) to text-status-success", () => {
    const segs = parseAnsiSegments("\x1b[32mok\x1b[0m");
    expect(segs[0]).toEqual({ text: "ok", classes: ["text-status-success"] });
  });

  it("maps red (31) to text-status-error", () => {
    const segs = parseAnsiSegments("\x1b[31merror\x1b[0m");
    expect(segs[0]).toEqual({ text: "error", classes: ["text-status-error"] });
  });

  it("maps yellow (33) to text-status-warning", () => {
    const segs = parseAnsiSegments("\x1b[33mwarn\x1b[0m");
    expect(segs[0]).toEqual({ text: "warn", classes: ["text-status-warning"] });
  });

  it("maps blue (34) to text-status-info", () => {
    const segs = parseAnsiSegments("\x1b[34minfo\x1b[0m");
    expect(segs[0]).toEqual({ text: "info", classes: ["text-status-info"] });
  });

  it("maps magenta (35) to text-violet", () => {
    const segs = parseAnsiSegments("\x1b[35mmagenta\x1b[0m");
    expect(segs[0]).toEqual({ text: "magenta", classes: ["text-violet"] });
  });

  it("maps cyan (36) to text-teal", () => {
    const segs = parseAnsiSegments("\x1b[36mcyan\x1b[0m");
    expect(segs[0]).toEqual({ text: "cyan", classes: ["text-teal"] });
  });

  it("maps white (37) to text-text-primary", () => {
    const segs = parseAnsiSegments("\x1b[37mwhite\x1b[0m");
    expect(segs[0]).toEqual({ text: "white", classes: ["text-text-primary"] });
  });

  it("maps black (30) to text-text-tertiary", () => {
    const segs = parseAnsiSegments("\x1b[30mblack\x1b[0m");
    expect(segs[0]).toEqual({ text: "black", classes: ["text-text-tertiary"] });
  });

  it("maps bright green (92) to text-status-success", () => {
    const segs = parseAnsiSegments("\x1b[92mbright green\x1b[0m");
    expect(segs[0]).toEqual({ text: "bright green", classes: ["text-status-success"] });
  });

  it("maps bold (1) to font-bold", () => {
    const segs = parseAnsiSegments("\x1b[1mbold\x1b[0m");
    expect(segs[0]).toEqual({ text: "bold", classes: ["font-bold"] });
  });

  it("combines bold and color from compound code", () => {
    const segs = parseAnsiSegments("\x1b[1;32mbold green\x1b[0m");
    expect(segs[0].classes).toContain("font-bold");
    expect(segs[0].classes).toContain("text-status-success");
  });

  it("resets both color and bold on code 0", () => {
    const segs = parseAnsiSegments("\x1b[1;31mbold red\x1b[0mnormal");
    expect(segs[0]).toEqual({ text: "bold red", classes: ["text-status-error", "font-bold"] });
    expect(segs[1]).toEqual({ text: "normal", classes: [] });
  });

  it("handles color change mid-text (no explicit reset)", () => {
    const segs = parseAnsiSegments("\x1b[32mgreen\x1b[31mred\x1b[0m");
    expect(segs[0]).toEqual({ text: "green", classes: ["text-status-success"] });
    expect(segs[1]).toEqual({ text: "red", classes: ["text-status-error"] });
  });

  it("handles text before first escape code", () => {
    const segs = parseAnsiSegments("prefix \x1b[32mcolored\x1b[0m");
    expect(segs[0]).toEqual({ text: "prefix ", classes: [] });
    expect(segs[1]).toEqual({ text: "colored", classes: ["text-status-success"] });
  });

  it("handles text after last reset", () => {
    const segs = parseAnsiSegments("\x1b[32mcolored\x1b[0m suffix");
    expect(segs[0]).toEqual({ text: "colored", classes: ["text-status-success"] });
    expect(segs[1]).toEqual({ text: " suffix", classes: [] });
  });

  it("handles multi-line input", () => {
    const input = "\x1b[32mline1\x1b[0m\n\x1b[31mline2\x1b[0m";
    const segs = parseAnsiSegments(input);
    expect(segs[0]).toEqual({ text: "line1", classes: ["text-status-success"] });
    expect(segs[1]).toEqual({ text: "\n", classes: [] });
    expect(segs[2]).toEqual({ text: "line2", classes: ["text-status-error"] });
  });

  it("handles bare reset (empty params)", () => {
    const segs = parseAnsiSegments("\x1b[32mgreen\x1b[mnormal");
    expect(segs[0]).toEqual({ text: "green", classes: ["text-status-success"] });
    expect(segs[1]).toEqual({ text: "normal", classes: [] });
  });
});
