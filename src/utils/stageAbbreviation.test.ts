import { describe, expect, it } from "vitest";
import { abbreviateStage } from "./stageAbbreviation";

describe("abbreviateStage", () => {
  it("preserves first letter when it is a vowel", () => {
    expect(abbreviateStage("Ideate")).toBe("idt");
    expect(abbreviateStage("Outline")).toBe("otl");
    expect(abbreviateStage("Enhance")).toBe("enh");
  });

  it("handles consonant-leading names unchanged", () => {
    expect(abbreviateStage("Plan")).toBe("pln");
    expect(abbreviateStage("Work")).toBe("wrk");
    expect(abbreviateStage("Review")).toBe("rvw");
    expect(abbreviateStage("Compound")).toBe("cmp");
    expect(abbreviateStage("Breakdown")).toBe("brk");
    expect(abbreviateStage("Check")).toBe("chc");
  });

  it("is case insensitive", () => {
    expect(abbreviateStage("PLAN")).toBe("pln");
    expect(abbreviateStage("IDEATE")).toBe("idt");
  });

  it("falls back to first 3 chars for very short names", () => {
    expect(abbreviateStage("A")).toBe("a");
    expect(abbreviateStage("Ai")).toBe("ai");
  });

  it("handles empty string", () => {
    expect(abbreviateStage("")).toBe("");
  });
});
