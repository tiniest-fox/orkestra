import { describe, expect, it } from "vitest";
import { titleCase } from "./titleCase";

describe("titleCase", () => {
  it("converts underscore-separated words", () => {
    expect(titleCase("hello_world")).toBe("Hello World");
  });

  it("converts hyphen-separated words", () => {
    expect(titleCase("hello-world")).toBe("Hello World");
  });

  it("handles mixed delimiters", () => {
    expect(titleCase("foo_bar-baz")).toBe("Foo Bar Baz");
  });

  it("handles single word", () => {
    expect(titleCase("planning")).toBe("Planning");
  });

  it("handles empty string", () => {
    expect(titleCase("")).toBe("");
  });
});
