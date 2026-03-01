import { describe, expect, it } from "vitest";
import { isOptionKey, optionKey, parseOptionIndex } from "./optionKey";

describe("optionKey", () => {
  it("returns a string starting with the sentinel prefix", () => {
    expect(optionKey(0)).toMatch(/^\0opt:/);
  });

  it("encodes the index in the key", () => {
    expect(optionKey(0)).toBe("\0opt:0");
    expect(optionKey(3)).toBe("\0opt:3");
    expect(optionKey(99)).toBe("\0opt:99");
  });
});

describe("isOptionKey", () => {
  it("returns true for option keys", () => {
    expect(isOptionKey(optionKey(0))).toBe(true);
    expect(isOptionKey(optionKey(5))).toBe(true);
  });

  it("returns false for ordinary text", () => {
    expect(isOptionKey("Blue")).toBe(false);
    expect(isOptionKey("opt:0")).toBe(false);
    expect(isOptionKey("")).toBe(false);
  });
});

describe("parseOptionIndex", () => {
  it("round-trips with optionKey", () => {
    expect(parseOptionIndex(optionKey(0))).toBe(0);
    expect(parseOptionIndex(optionKey(1))).toBe(1);
    expect(parseOptionIndex(optionKey(42))).toBe(42);
  });

  it("returns null for non-key strings", () => {
    expect(parseOptionIndex("Blue")).toBeNull();
    expect(parseOptionIndex("opt:0")).toBeNull();
    expect(parseOptionIndex("")).toBeNull();
  });

  it("returns null for malformed keys (non-numeric suffix)", () => {
    expect(parseOptionIndex("\0opt:abc")).toBeNull();
    expect(parseOptionIndex("\0opt:NaN")).toBeNull();
  });
});
