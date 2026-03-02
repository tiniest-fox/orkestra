//! Unit tests for feedContent utility functions.

import { describe, expect, it } from "vitest";
import { stripParameterBlocks } from "./feedContent";

// The closing tag that Claude uses in its XML output.
// Written as concatenation so the file is not misread as a parameter block itself.
const CLOSE = "</" + "antml:parameter>";
const OPEN = '<parameter name="content">';

describe("stripParameterBlocks", () => {
  it("returns content unchanged when no parameter blocks present", () => {
    expect(stripParameterBlocks("Hello world")).toBe("Hello world");
  });

  it("strips a single parameter block", () => {
    const input = `Before ${OPEN}inner text${CLOSE} after`;
    expect(stripParameterBlocks(input)).toBe("Before  after");
  });

  it("strips a multiline parameter block", () => {
    const input = `Header\n${OPEN}\nline1\nline2\n${CLOSE}\nFooter`;
    expect(stripParameterBlocks(input)).toBe("Header\n\nFooter");
  });

  it("strips multiple parameter blocks", () => {
    const input = `A ${OPEN}x${CLOSE} B ${OPEN}y${CLOSE} C`;
    expect(stripParameterBlocks(input)).toBe("A  B  C");
  });

  it("returns empty string for content that is only a parameter block", () => {
    expect(stripParameterBlocks(`${OPEN}only${CLOSE}`)).toBe("");
  });

  it("trims surrounding whitespace after stripping", () => {
    expect(stripParameterBlocks(`  ${OPEN}x${CLOSE}  `)).toBe("");
  });

  it("does not strip blocks with other attribute names", () => {
    const input = `<parameter name="other">x${CLOSE}`;
    expect(stripParameterBlocks(input)).toBe(input);
  });
});
