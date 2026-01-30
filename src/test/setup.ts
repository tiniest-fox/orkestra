import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock @tauri-apps/api/core — default returns a rejected Promise so
// module-level code that chains .then() on invoke() doesn't crash.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.reject(new Error("Unmocked command"))),
}));

// Mock @tauri-apps/api/event
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));
