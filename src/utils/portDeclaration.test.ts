import { describe, expect, it } from "vitest";
import { parsePortDeclaration } from "./portDeclaration";

describe("parsePortDeclaration", () => {
  it("parses a valid declaration", () => {
    expect(parsePortDeclaration("ORKESTRA_PORT Rails=3000")).toEqual({
      label: "Rails",
      port: 3000,
    });
  });

  it("parses a second valid declaration", () => {
    expect(parsePortDeclaration("ORKESTRA_PORT React=3002")).toEqual({
      label: "React",
      port: 3002,
    });
  });

  it("strips ANSI codes before matching", () => {
    expect(parsePortDeclaration("\x1b[32mORKESTRA_PORT Rails=3000\x1b[0m")).toEqual({
      label: "Rails",
      port: 3000,
    });
  });

  it("strips ANSI codes mid-line", () => {
    expect(parsePortDeclaration("ORKESTRA_PORT \x1b[1mAPI\x1b[0m=4000")).toEqual({
      label: "API",
      port: 4000,
    });
  });

  it("handles leading and trailing whitespace", () => {
    expect(parsePortDeclaration("  ORKESTRA_PORT Rails=3000  ")).toEqual({
      label: "Rails",
      port: 3000,
    });
  });

  it("accepts port 1 (boundary)", () => {
    expect(parsePortDeclaration("ORKESTRA_PORT Svc=1")).toEqual({ label: "Svc", port: 1 });
  });

  it("accepts port 65535 (boundary)", () => {
    expect(parsePortDeclaration("ORKESTRA_PORT Svc=65535")).toEqual({
      label: "Svc",
      port: 65535,
    });
  });

  it("returns null for port 0", () => {
    expect(parsePortDeclaration("ORKESTRA_PORT Rails=0")).toBeNull();
  });

  it("returns null for port > 65535", () => {
    expect(parsePortDeclaration("ORKESTRA_PORT Rails=65536")).toBeNull();
  });

  it("returns null for non-numeric port", () => {
    expect(parsePortDeclaration("ORKESTRA_PORT Rails=abc")).toBeNull();
  });

  it("returns null when missing equals sign", () => {
    expect(parsePortDeclaration("ORKESTRA_PORT Rails 3000")).toBeNull();
  });

  it("returns null when label is empty", () => {
    expect(parsePortDeclaration("ORKESTRA_PORT =3000")).toBeNull();
  });

  it("returns null for regular log output", () => {
    expect(parsePortDeclaration("Server started on port 3000")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parsePortDeclaration("")).toBeNull();
  });

  it("returns null for partial sentinel without value", () => {
    expect(parsePortDeclaration("ORKESTRA_PORT")).toBeNull();
  });

  it("returns null when label contains spaces (label is non-whitespace token)", () => {
    expect(parsePortDeclaration("ORKESTRA_PORT My Server=3000")).toBeNull();
  });
});
