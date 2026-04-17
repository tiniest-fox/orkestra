// Hook managing state and async operations for the ResourceLimitsDrawer.

import { useCallback, useEffect, useState } from "react";
import type { ProjectStatus, ResourceLimits } from "../api";
import { fetchResourceLimits, updateResourceLimits } from "../api";

// ============================================================================
// Hook
// ============================================================================

export function useResourceLimits(projectId: string, projectStatus: ProjectStatus) {
  const [limits, setLimits] = useState<ResourceLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [cpuInput, setCpuInput] = useState<string>("");
  const [memoryInput, setMemoryInput] = useState<string>("");

  useEffect(() => {
    fetchResourceLimits(projectId)
      .then((data) => {
        setLimits(data);
        setCpuInput(data.cpu_limit?.toString() ?? "");
        setMemoryInput(data.memory_limit_mb?.toString() ?? "");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectId]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const cpu = cpuInput.trim() === "" ? null : parseFloat(cpuInput);
      if (cpu !== null && Number.isNaN(cpu)) {
        setError("CPU limit must be a number");
        setSaving(false);
        return;
      }
      const mem = memoryInput.trim() === "" ? null : parseInt(memoryInput, 10);
      if (mem !== null && Number.isNaN(mem)) {
        setError("Memory limit must be a number");
        setSaving(false);
        return;
      }
      const result = await updateResourceLimits(projectId, cpu, mem);
      if (result.restart_required && projectStatus === "running") {
        setRestartRequired(true);
      }
      const updated = await fetchResourceLimits(projectId);
      setLimits(updated);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [projectId, cpuInput, memoryInput, projectStatus]);

  const reset = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await updateResourceLimits(projectId, null, null);
      if (result.restart_required && projectStatus === "running") {
        setRestartRequired(true);
      }
      const updated = await fetchResourceLimits(projectId);
      setLimits(updated);
      setCpuInput("");
      setMemoryInput("");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [projectId, projectStatus]);

  return {
    limits,
    loading,
    saving,
    error,
    restartRequired,
    cpuInput,
    setCpuInput,
    memoryInput,
    setMemoryInput,
    save,
    reset,
  };
}
