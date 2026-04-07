// Inline form for adding a new secret, with its own key/value/validation state.

import { useState } from "react";
import { Button } from "../../components/ui";

// ============================================================================
// Types
// ============================================================================

interface AddSecretFormProps {
  onSave: (key: string, value: string) => Promise<void>;
  onCancel: () => void;
}

// ============================================================================
// Component
// ============================================================================

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function AddSecretForm({ onSave, onCancel }: AddSecretFormProps) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setKeyError(null);
    if (!KEY_PATTERN.test(newKey)) {
      setKeyError(
        "Key must start with a letter or underscore and contain only letters, digits, or underscores.",
      );
      return;
    }
    setSaving(true);
    try {
      await onSave(newKey, newValue);
    } catch {
      // Error is displayed in the parent's error banner; keep fields so user can retry.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-3 border-b border-border flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <input
          type="text"
          placeholder="KEY_NAME"
          value={newKey}
          onChange={(e) => {
            setNewKey(e.target.value);
            setKeyError(null);
          }}
          className="w-full px-3 py-1.5 rounded-panel-sm border border-border bg-canvas font-mono text-forge-mono-sm text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-accent"
        />
        {keyError && <span className="text-forge-mono-label text-status-error">{keyError}</span>}
      </div>
      <textarea
        placeholder="Value"
        value={newValue}
        onChange={(e) => setNewValue(e.target.value)}
        rows={3}
        className="w-full px-3 py-1.5 rounded-panel-sm border border-border bg-canvas font-mono text-forge-mono-sm text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-accent resize-none"
      />
      <div className="flex gap-2">
        <Button variant="primary" onClick={handleSave} disabled={saving} loading={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
