import { describe, expect, it } from "vitest";
import { isDisconnectError } from "./transportErrors";

describe("isDisconnectError", () => {
  it("returns true for 'WebSocket not connected'", () => {
    expect(isDisconnectError(new Error("WebSocket not connected"))).toBe(true);
  });

  it("returns true for 'WebSocket disconnected'", () => {
    expect(isDisconnectError(new Error("WebSocket disconnected"))).toBe(true);
  });

  it("returns true for 'Transport closed'", () => {
    expect(isDisconnectError(new Error("Transport closed"))).toBe(true);
  });

  it("returns true when message contains disconnect substring", () => {
    expect(isDisconnectError(new Error("call failed: WebSocket not connected"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isDisconnectError(new Error("Not found"))).toBe(false);
  });

  it("returns false for empty error", () => {
    expect(isDisconnectError(new Error(""))).toBe(false);
  });

  it("handles non-Error objects by stringifying", () => {
    expect(isDisconnectError("WebSocket not connected")).toBe(true);
    expect(isDisconnectError("some other error")).toBe(false);
  });
});
