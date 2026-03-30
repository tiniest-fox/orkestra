// React context provider that creates and exposes the transport singleton.

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useConnectionProbe } from "../hooks/useConnectionProbe";
import { createTransport } from "./factory";
import type { ConnectionState, Transport } from "./types";

// ============================================================================
// Context
// ============================================================================

const TransportContext = createContext<Transport | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface TransportProviderProps {
  /** Optional pre-created transport. When omitted, a transport is created via `createTransport()`. */
  transport?: Transport;
  children: ReactNode;
}

/** Wires transport-level effects (e.g., connection probe on visibility change). */
function TransportEffects({ transport }: { transport: Transport }) {
  useConnectionProbe(transport);
  return null;
}

/**
 * Provides the transport singleton to the component tree.
 *
 * When `transport` is provided, it is used directly (no factory call).
 * When omitted, creates the transport once via `createTransport()` and never recreates it.
 * Components that need connection state use `useConnectionState()`, which
 * manages its own subscription independently.
 */
export function TransportProvider({
  transport: injectedTransport,
  children,
}: TransportProviderProps) {
  const [transport] = useState(() => injectedTransport ?? createTransport());

  return (
    <TransportContext.Provider value={transport}>
      <TransportEffects transport={transport} />
      {children}
    </TransportContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Access the transport singleton. Must be called inside TransportProvider.
 */
export function useTransport(): Transport {
  const transport = useContext(TransportContext);
  if (!transport) {
    throw new Error("useTransport must be used within TransportProvider");
  }
  return transport;
}

/**
 * Subscribe to the current connection state.
 *
 * Returns `'connected'`, `'connecting'`, or `'disconnected'`.
 * Re-renders the calling component when the state changes.
 */
export function useConnectionState(): ConnectionState {
  const transport = useTransport();
  const [state, setState] = useState<ConnectionState>(transport.connectionState);

  useEffect(() => {
    // Sync in case state changed between render and effect registration.
    setState(transport.connectionState);
    return transport.onConnectionStateChange(setState);
  }, [transport]);

  return state;
}

/**
 * Returns true once the transport has connected at least once.
 * Uses a ref latch — once true, never resets to false.
 * For Tauri, connectionState starts as "connected", so this returns true immediately.
 *
 * Mutating hasConnectedRef.current during render is safe here because:
 * 1. The mutation is monotonic (false → true only, never reversed).
 * 2. The returned value is always consistent within a render.
 * 3. Missing a transition frame in concurrent mode doesn't matter — the
 *    latch catches up on the next render automatically.
 * Do NOT copy this pattern for non-monotonic state; use useState instead.
 */
export function useHasConnected(): boolean {
  const connectionState = useConnectionState();
  const hasConnectedRef = useRef(connectionState === "connected");
  if (connectionState === "connected") {
    hasConnectedRef.current = true;
  }
  return hasConnectedRef.current;
}
