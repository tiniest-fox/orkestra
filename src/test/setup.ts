import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";
import { mockSetTitle } from "./mocks/tauri-window";
import { mockTransport, resetTransportMocks } from "./mocks/transport";

// Mock the transport provider so useTransport() returns mockTransport in all tests.
// TransportProvider renders children directly since the transport is injected via mock.
vi.mock("../transport/TransportProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../transport/TransportProvider")>();
  return {
    ...actual,
    useTransport: () => mockTransport,
    // useConnectionState reads connectionState from the mock transport.
    // Mocked here because internal module calls bypass the exported binding mock.
    useConnectionState: () => mockTransport.connectionState,
    useHasConnected: () => true,
    // TransportProvider renders children without creating a real transport.
    TransportProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

// Reset transport mocks before each test.
beforeEach(() => {
  resetTransportMocks();
  mockSetTitle.mockClear();
});

// Keep @tauri-apps/api/core mock — needed for TauriTransport which calls invoke() internally.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.reject(new Error("Unmocked command"))),
}));

// Mock @tauri-apps/api/event — needed for main.tsx startup listeners.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

// Mock @tauri-apps/api/window — needed for App.tsx native title updates.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTitle: mockSetTitle }),
}));
