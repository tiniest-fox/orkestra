// Tests for the client-side petname generator.

import { describe, expect, it } from "vitest";
import { generatePetname } from "./petname";

describe("generatePetname", () => {
  it("produces a 3-word hyphenated string", () => {
    const name = generatePetname();
    const parts = name.split("-");
    expect(parts).toHaveLength(3);
  });

  it("produces lowercase strings", () => {
    const name = generatePetname();
    expect(name).toBe(name.toLowerCase());
  });

  it("produces different values on repeated calls", () => {
    const names = new Set(Array.from({ length: 20 }, () => generatePetname()));
    // With ~100+ words per list, the chance of 20 identical names is negligible
    expect(names.size).toBeGreaterThan(1);
  });

  it("contains only letters and hyphens", () => {
    for (let i = 0; i < 10; i++) {
      const name = generatePetname();
      expect(name).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    }
  });
});
