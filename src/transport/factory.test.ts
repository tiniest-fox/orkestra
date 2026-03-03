import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock constructors via prototype so instances get the right properties
// when called with `new`. Using vi.fn() directly is safe as a constructor
// since it's a real function (not an arrow function).
vi.mock("./TauriTransport", () => {
  const TauriTransport = vi.fn();
  TauriTransport.prototype.supportsLocalOperations = true;
  TauriTransport.prototype.requiresAuthentication = false;
  return { TauriTransport };
});

vi.mock("./WebSocketTransport", () => {
  const WebSocketTransport = vi.fn();
  WebSocketTransport.prototype.supportsLocalOperations = false;
  WebSocketTransport.prototype.requiresAuthentication = true;
  return { WebSocketTransport };
});

import { STORAGE_AUTH_TOKEN, STORAGE_REMOTE_URL } from "../constants";
import { createTransport } from "./factory";
import { TauriTransport } from "./TauriTransport";
import { WebSocketTransport } from "./WebSocketTransport";

const MockTauriTransport = TauriTransport as ReturnType<typeof vi.fn>;
const MockWebSocketTransport = WebSocketTransport as ReturnType<typeof vi.fn>;

describe("createTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it("returns TauriTransport when TAURI_ENV_PLATFORM is set and no remote URL is set", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "macos");

    const transport = createTransport();

    expect(MockTauriTransport).toHaveBeenCalledOnce();
    expect(MockWebSocketTransport).not.toHaveBeenCalled();
    expect(transport.supportsLocalOperations).toBe(true);
    expect(transport.requiresAuthentication).toBe(false);
  });

  it("returns WebSocketTransport when TAURI_ENV_PLATFORM is set but remote URL is set", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "macos");
    localStorage.setItem(STORAGE_REMOTE_URL, "ws://remote.example.com/ws");
    localStorage.setItem(STORAGE_AUTH_TOKEN, "secret-token");

    const transport = createTransport();

    expect(MockWebSocketTransport).toHaveBeenCalledOnce();
    expect(MockTauriTransport).not.toHaveBeenCalled();
    expect(transport.supportsLocalOperations).toBe(false);
    expect(transport.requiresAuthentication).toBe(true);
  });

  it("returns WebSocketTransport when TAURI_ENV_PLATFORM is absent (PWA context)", () => {
    // TAURI_ENV_PLATFORM is undefined by default — no stub needed.

    const transport = createTransport();

    expect(MockWebSocketTransport).toHaveBeenCalledOnce();
    expect(MockTauriTransport).not.toHaveBeenCalled();
    expect(transport.supportsLocalOperations).toBe(false);
    expect(transport.requiresAuthentication).toBe(true);
  });
});
