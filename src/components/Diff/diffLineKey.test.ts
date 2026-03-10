import { describe, expect, it } from "vitest";
import { diffLineKey } from "./diffLineKey";

describe("diffLineKey", () => {
  it("formats hunk and line index", () => {
    expect(diffLineKey(2, 5)).toBe("2-5");
  });
});
