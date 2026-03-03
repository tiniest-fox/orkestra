//! Connection and pairing page shown to PWA users on first launch.
//!
//! Guides the user through entering the daemon URL and a 6-digit pairing code
//! to obtain a bearer token. On success, credentials are stored in localStorage
//! and the page reloads to mount the main app via WebSocketTransport.

import { useState } from "react";
import { STORAGE_AUTH_TOKEN, STORAGE_REMOTE_URL } from "../../constants";
import { Button } from "../ui";

// ============================================================================
// Types
// ============================================================================

type Step = "url" | "code";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Exchange a pairing code for a bearer token via the daemon's REST endpoint.
 *
 * The daemon's `POST /pair` endpoint expects `{ code, device_name }` and
 * returns `{ token }` on success.
 */
async function claimPairingCode(wsUrl: string, code: string): Promise<string> {
  // Convert ws:// → http:// and wss:// → https:// for the REST pairing endpoint.
  const httpUrl = wsUrl.replace(/^ws(s?):\/\//, "http$1://");

  // Strip trailing /ws path segment if present so the base URL is correct.
  const baseUrl = httpUrl.replace(/\/ws$/, "");

  const response = await fetch(`${baseUrl}/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, device_name: "Orkestra PWA" }),
  });

  if (!response.ok) {
    let message = "Pairing failed — check the code and try again";
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Use default message if JSON parsing fails.
    }
    throw new Error(message);
  }

  const body = (await response.json()) as { token: string };
  return body.token;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Full-screen connection and pairing page for PWA mode.
 *
 * Shown when the PWA has no stored auth token. Guides the user through:
 * 1. Entering the daemon WebSocket URL
 * 2. Entering the 6-digit pairing code shown by the daemon
 *
 * On successful pairing, stores credentials in localStorage and reloads
 * so the app mounts via WebSocketTransport.
 */
export function ConnectionPage() {
  const [step, setStep] = useState<Step>("url");
  const [url, setUrl] = useState("ws://localhost:3847/ws");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleUrlNext(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setError(null);
    setStep("code");
  }

  async function handlePair(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const token = await claimPairingCode(url.trim(), code.trim());
      localStorage.setItem(STORAGE_REMOTE_URL, url.trim());
      localStorage.setItem(STORAGE_AUTH_TOKEN, token);
      // Reload to pick up the stored credentials via WebSocketTransport.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-primary mb-2">Connect to Orkestra</h1>
          <p className="text-secondary text-sm">Enter your daemon address to get started</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          <StepDot active={step === "url"} done={step === "code"} label="1" />
          <div className="flex-1 h-px bg-border" />
          <StepDot active={step === "code"} done={false} label="2" />
        </div>

        {/* URL step */}
        {step === "url" && (
          <form onSubmit={handleUrlNext} className="space-y-4">
            <div>
              <label
                className="block text-sm font-medium text-secondary mb-1.5"
                htmlFor="daemon-url"
              >
                Daemon URL
              </label>
              <input
                id="daemon-url"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="ws://localhost:3847/ws"
                className="w-full px-3 py-2 bg-surface-2 border border-border rounded-panel-sm text-primary placeholder:text-quaternary text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="mt-1.5 text-xs text-tertiary">
                The WebSocket address of your running Orkestra daemon
              </p>
            </div>

            {error && <p className="text-sm text-status-error">{error}</p>}

            <Button type="submit" variant="primary" fullWidth disabled={!url.trim()}>
              Continue
            </Button>
          </form>
        )}

        {/* Pairing code step */}
        {step === "code" && (
          <form onSubmit={handlePair} className="space-y-4">
            <div>
              <label
                className="block text-sm font-medium text-secondary mb-1.5"
                htmlFor="pairing-code"
              >
                Pairing Code
              </label>
              <input
                id="pairing-code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="w-full px-3 py-2 bg-surface-2 border border-border rounded-panel-sm text-primary placeholder:text-quaternary text-sm focus:outline-none focus:ring-1 focus:ring-accent tracking-widest font-mono"
                autoComplete="off"
                inputMode="numeric"
              />
              <p className="mt-1.5 text-xs text-tertiary">
                Run <code className="font-mono text-secondary">ork pair</code> on the daemon machine
                to generate a code
              </p>
            </div>

            <p className="text-xs text-tertiary">
              Connecting to <span className="text-secondary font-mono">{url}</span>
            </p>

            {error && <p className="text-sm text-status-error">{error}</p>}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setStep("url");
                  setError(null);
                }}
                disabled={loading}
              >
                Back
              </Button>
              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={loading}
                disabled={code.length !== 6 || loading}
              >
                {loading ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface StepDotProps {
  active: boolean;
  done: boolean;
  label: string;
}

function StepDot({ active, done, label }: StepDotProps) {
  const base =
    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 transition-colors";
  if (done) {
    return <div className={`${base} bg-accent text-white`}>✓</div>;
  }
  if (active) {
    return <div className={`${base} bg-accent text-white`}>{label}</div>;
  }
  return <div className={`${base} bg-surface-2 border border-border text-quaternary`}>{label}</div>;
}
