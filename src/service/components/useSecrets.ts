// Hook managing all state and async operations for the SecretsDrawer.

import { useEffect, useState } from "react";
import { confirmAction } from "../../utils/confirmAction";
import type { ProjectStatus, SecretEntry } from "../api";
import { deleteSecret, getSecret, listSecrets, setSecret } from "../api";

// ============================================================================
// Types
// ============================================================================

export interface SecretsHook {
  secrets: SecretEntry[];
  loading: boolean;
  error: string | null;
  restartRequired: boolean;

  // Edit view
  editingKey: string | null;
  editValue: string;
  setEditValue: (v: string) => void;
  editLoading: boolean;
  editSaving: boolean;
  startEdit: (key: string) => Promise<void>;
  cancelEdit: () => void;
  saveEdit: () => Promise<void>;

  // List view
  addMode: boolean;
  openAdd: () => void;
  addSave: (key: string, value: string) => Promise<void>;
  cancelAdd: () => void;

  // Delete
  deleteKey: (key: string) => Promise<void>;
}

// ============================================================================
// Hook
// ============================================================================

export function useSecrets(projectId: string, projectStatus: ProjectStatus): SecretsHook {
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  const [addMode, setAddMode] = useState(false);

  async function loadSecrets() {
    try {
      const data = await listSecrets(projectId);
      setSecrets(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load on mount only
  useEffect(() => {
    loadSecrets();
  }, [projectId]);

  function markRestartIfNeeded(restartRequired: boolean) {
    if (restartRequired && projectStatus === "running") {
      setRestartRequired(true);
    }
  }

  async function startEdit(key: string) {
    setError(null);
    setEditingKey(key);
    setEditValue("");
    setEditLoading(true);
    try {
      const data = await getSecret(projectId, key);
      setEditValue(data.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEditingKey(null);
    } finally {
      setEditLoading(false);
    }
  }

  function cancelEdit() {
    setEditingKey(null);
  }

  async function saveEdit() {
    if (!editingKey) return;
    setError(null);
    setEditSaving(true);
    try {
      const result = await setSecret(projectId, editingKey, editValue);
      markRestartIfNeeded(result.restart_required);
      setEditingKey(null);
      await loadSecrets();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditSaving(false);
    }
  }

  function openAdd() {
    setError(null);
    setAddMode(true);
  }

  async function addSave(key: string, value: string): Promise<void> {
    setError(null);
    try {
      const result = await setSecret(projectId, key, value);
      markRestartIfNeeded(result.restart_required);
      setAddMode(false);
      await loadSecrets();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  function cancelAdd() {
    setAddMode(false);
    setError(null);
  }

  async function deleteKey(key: string) {
    const confirmed = await confirmAction(`Delete secret "${key}"? This cannot be undone.`);
    if (!confirmed) return;
    setError(null);
    try {
      const result = await deleteSecret(projectId, key);
      markRestartIfNeeded(result.restart_required);
      await loadSecrets();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return {
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
  };
}
