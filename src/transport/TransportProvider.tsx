//! React context provider that creates and exposes the transport singleton.

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
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

  return <TransportContext.Provider value={transport}>{children}</TransportContext.Provider>;
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
