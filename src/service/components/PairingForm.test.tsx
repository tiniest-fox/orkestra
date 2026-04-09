//! Tests for PairingForm — first-visit pairing UI.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { PairingForm } from "./PairingForm";

vi.mock("../api", () => ({
  pairDevice: vi.fn(),
  setToken: vi.fn(),
  getToken: vi.fn(),
  clearToken: vi.fn(),
}));

const mockPairDevice = vi.mocked(api.pairDevice);
const mockSetToken = vi.mocked(api.setToken);

// Preserve original location so it can be restored after each test.
const originalLocation = window.location;

afterEach(() => {
  Object.defineProperty(window, "location", { writable: true, value: originalLocation });
});

describe("PairingForm", () => {
  beforeEach(() => {
    mockPairDevice.mockReset();
    mockSetToken.mockReset();
    // Replace window.location with a stub so location.reload() doesn't throw.
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, reload: vi.fn() },
    });
  });

  it("renders the input and Connect button", () => {
    render(<PairingForm />);
    expect(screen.getByPlaceholderText("000000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("shows error when submitting empty code", async () => {
    render(<PairingForm />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Please enter a pairing code.")).toBeInTheDocument();
    expect(mockPairDevice).not.toHaveBeenCalled();
  });

  it("calls pairDevice and stores token on successful pairing", async () => {
    mockPairDevice.mockResolvedValueOnce({ token: "tok-123" });

    render(<PairingForm />);
    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(mockPairDevice).toHaveBeenCalledWith("123456"));
    expect(mockSetToken).toHaveBeenCalledWith("tok-123");
  });

  it("shows API error message on failure", async () => {
    mockPairDevice.mockRejectedValueOnce(new Error("Invalid code"));

    render(<PairingForm />);
    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "000000" } });
    // Wrap in act so the async handleSubmit's state updates (setError, setLoading) flush
    // before the assertion. Without this, React 18 may not have applied the updates yet.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    });

    expect(screen.getByText("Invalid code")).toBeInTheDocument();
  });

  it("submits on Enter key press", async () => {
    mockPairDevice.mockResolvedValueOnce({ token: "tok-456" });

    render(<PairingForm />);
    const input = screen.getByPlaceholderText("000000");
    fireEvent.change(input, { target: { value: "654321" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mockPairDevice).toHaveBeenCalledWith("654321"));
  });
});
