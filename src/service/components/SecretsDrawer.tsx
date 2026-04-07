// Secrets management drawer for per-project environment variables.

import { Pencil, Trash2 } from "lucide-react";
import { Button } from "../../components/ui";
import { Drawer } from "../../components/ui/Drawer/Drawer";
import { DrawerHeader } from "../../components/ui/Drawer/DrawerHeader";
import type { ProjectStatus, SecretEntry } from "../api";
import { AddSecretForm } from "./AddSecretForm";
import { useSecrets } from "./useSecrets";

// ============================================================================
// Types
// ============================================================================

interface SecretsDrawerProps {
  onClose: () => void;
  projectId: string;
  projectName: string;
  projectStatus: ProjectStatus;
}

// ============================================================================
// Component
// ============================================================================

export function SecretsDrawer({
  onClose,
  projectId,
  projectName,
  projectStatus,
}: SecretsDrawerProps) {
  const {
    secrets,
    loading,
    error,
    restartRequired,
    editingKey,
    editValue,
    setEditValue,
    editLoading,
    editSaving,
    startEdit,
    cancelEdit,
    saveEdit,
    addMode,
    openAdd,
    addSave,
    cancelAdd,
    deleteKey,
  } = useSecrets(projectId, projectStatus);

  return (
    <Drawer onClose={onClose}>
      <div className="flex flex-col h-full">
        <DrawerHeader
          title={`Secrets — ${projectName}`}
          onClose={onClose}
          onBack={editingKey ? cancelEdit : undefined}
        />

        {/* Restart notice banner */}
        {restartRequired && projectStatus === "running" && (
          <div className="px-4 py-2 border-b border-border bg-status-warning/10 text-forge-body text-text-primary">
            Secrets have been modified. Restart the project to apply changes.
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="px-4 py-2 border-b border-border bg-status-error/10 text-forge-body text-status-error">
            {error}
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {editingKey ? (
            <EditSecretView
              secretKey={editingKey}
              value={editValue}
              onChange={setEditValue}
              loading={editLoading}
              saving={editSaving}
              onSave={saveEdit}
            />
          ) : (
            <SecretListView
              secrets={secrets}
              loading={loading}
              addMode={addMode}
              onAddSave={addSave}
              onAddCancel={cancelAdd}
              onEditKey={startEdit}
              onDeleteKey={deleteKey}
            />
          )}
        </div>

        {/* Footer — Add Secret button when in list view */}
        {!editingKey && !addMode && (
          <div className="px-4 py-3 border-t border-border">
            <Button variant="secondary" fullWidth onClick={openAdd}>
              Add Secret
            </Button>
          </div>
        )}
      </div>
    </Drawer>
  );
}

// ============================================================================
// SecretListView
// ============================================================================

interface SecretListViewProps {
  secrets: SecretEntry[];
  loading: boolean;
  addMode: boolean;
  onAddSave: (key: string, value: string) => Promise<void>;
  onAddCancel: () => void;
  onEditKey: (key: string) => void;
  onDeleteKey: (key: string) => void;
}

function SecretListView({
  secrets,
  loading,
  addMode,
  onAddSave,
  onAddCancel,
  onEditKey,
  onDeleteKey,
}: SecretListViewProps) {
  if (loading) {
    return (
      <div className="px-4 py-8 text-center text-forge-body text-text-tertiary">
        Loading secrets…
      </div>
    );
  }

  return (
    <div>
      {/* Add form — shown inline at top when addMode is true */}
      {addMode && <AddSecretForm onSave={onAddSave} onCancel={onAddCancel} />}

      {/* Secret list */}
      {secrets.length === 0 && !addMode ? (
        <div className="px-4 py-8 text-center text-forge-body text-text-tertiary">
          No secrets yet.
        </div>
      ) : (
        secrets.map((secret) => (
          <div
            key={secret.key}
            className="px-4 py-3 border-b border-border flex items-center gap-3 hover:bg-surface"
          >
            <div className="flex-1 min-w-0">
              <div className="text-forge-mono-sm font-mono text-text-primary truncate">
                {secret.key}
              </div>
              <div className="text-forge-mono-label text-text-tertiary">
                Updated {secret.updated_at}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onEditKey(secret.key)}
              aria-label={`Edit ${secret.key}`}
              className="p-1.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDeleteKey(secret.key)}
              aria-label={`Delete ${secret.key}`}
              className="p-1.5 rounded text-text-tertiary hover:text-status-error hover:bg-surface-2 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

// ============================================================================
// EditSecretView
// ============================================================================

interface EditSecretViewProps {
  secretKey: string;
  value: string;
  onChange: (v: string) => void;
  loading: boolean;
  saving: boolean;
  onSave: () => void;
}

function EditSecretView({
  secretKey,
  value,
  onChange,
  loading,
  saving,
  onSave,
}: EditSecretViewProps) {
  return (
    <div className="px-4 py-3 flex flex-col gap-3">
      <div className="text-forge-mono-sm font-mono text-text-secondary">{secretKey}</div>
      {loading ? (
        <div className="text-forge-body text-text-tertiary">Loading value…</div>
      ) : (
        <>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={6}
            className="w-full px-3 py-1.5 rounded-panel-sm border border-border bg-canvas font-mono text-forge-mono-sm text-text-primary focus:outline-none focus:border-accent resize-none"
          />
          <div>
            <Button variant="primary" onClick={onSave} disabled={saving} loading={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
