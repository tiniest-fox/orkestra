//! First-visit pairing form — shown when no auth token is stored in localStorage.

import { useEffect, useRef, useState } from "react";
import { Button, Panel } from "../../components/ui";
import { pairDevice, setToken } from "../api";

// ============================================================================
// Component
// ============================================================================

export function PairingForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit() {
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Please enter a pairing code.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await pairDevice(trimmed);
      setToken(result.token);
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSubmit();
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <Panel autoFill={false}>
          <Panel.Header>
            <Panel.Title>Pair this Device</Panel.Title>
          </Panel.Header>
          <Panel.Body>
            <p className="text-sm text-text-secondary mb-4">
              Enter the 6-digit pairing code shown on your Orkestra service to connect.
            </p>
            <input
              ref={inputRef}
              type="text"
              maxLength={6}
              placeholder="000000"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full px-3 py-2 text-center text-xl tracking-widest font-mono bg-canvas border border-border rounded-panel-sm text-text-primary focus:outline-none focus:border-accent"
            />
            {error && <p className="mt-2 text-sm text-status-error">{error}</p>}
            <div className="mt-4">
              <Button variant="primary" fullWidth loading={loading} onClick={handleSubmit}>
                Connect
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}
