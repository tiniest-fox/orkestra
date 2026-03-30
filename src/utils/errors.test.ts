// Unit tests for extractErrorMessage utility.

import { describe, expect, it } from "vitest";
import { extractErrorMessage } from "./errors";

describe("extractErrorMessage", () => {
  it("extracts message from Error instance", () => {
    expect(extractErrorMessage(new Error("something broke"))).toBe("something broke");
  });

  it("extracts message from object with message property", () => {
    expect(extractErrorMessage({ code: "ERR", message: "bad request" })).toBe("bad request");
  });

  it("JSON-stringifies object without message property", () => {
    expect(extractErrorMessage({ code: "ERR", detail: "oops" })).toBe(
      JSON.stringify({ code: "ERR", detail: "oops" }),
    );
  });

  it("converts primitive string to string", () => {
    expect(extractErrorMessage("plain error")).toBe("plain error");
  });

  it("converts null to string", () => {
    expect(extractErrorMessage(null)).toBe("null");
  });

  it("converts undefined to string", () => {
    expect(extractErrorMessage(undefined)).toBe("undefined");
  });
});
