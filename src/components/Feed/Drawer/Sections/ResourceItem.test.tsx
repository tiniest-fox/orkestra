// Unit tests for the isImageUrl utility in ResourceItem.
import { describe, expect, it } from "vitest";
import { isImageUrl } from "./ResourceItem";

describe("isImageUrl", () => {
  it("returns true for .png extension", () => {
    expect(isImageUrl("/path/to/screenshot.png")).toBe(true);
  });

  it("returns true for .jpg extension", () => {
    expect(isImageUrl("/path/to/photo.jpg")).toBe(true);
  });

  it("returns true for .jpeg extension", () => {
    expect(isImageUrl("/path/to/photo.jpeg")).toBe(true);
  });

  it("returns true for .gif extension", () => {
    expect(isImageUrl("/path/to/animation.gif")).toBe(true);
  });

  it("returns true for .webp extension", () => {
    expect(isImageUrl("/path/to/image.webp")).toBe(true);
  });

  it("returns true for .svg extension", () => {
    expect(isImageUrl("/path/to/icon.svg")).toBe(true);
  });

  it("returns true for uppercase extension", () => {
    expect(isImageUrl("/path/to/image.PNG")).toBe(true);
  });

  it("returns false for https:// URL", () => {
    expect(isImageUrl("https://docs.example.com/design")).toBe(false);
  });

  it("returns false for a plain text description", () => {
    expect(isImageUrl("architecture overview")).toBe(false);
  });

  it("returns false for a .pdf file", () => {
    expect(isImageUrl("/path/to/report.pdf")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isImageUrl("")).toBe(false);
  });
});
