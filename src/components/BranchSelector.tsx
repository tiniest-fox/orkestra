/**
 * BranchSelector - Subtle branch picker for task creation.
 * Shows current branch as a button; clicking opens a list of available branches.
 */

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { BranchList } from "../types/workflow";

interface BranchSelectorProps {
  value: string | null;
  onChange: (branch: string) => void;
}

export function BranchSelector({ value, onChange }: BranchSelectorProps) {
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await invoke<BranchList>("workflow_list_branches");
        if (cancelled) return;
        setBranches(result.branches);
        setCurrentBranch(result.current);
        // Set initial value to current branch
        if (result.current) {
          onChangeRef.current(result.current);
        }
      } catch {
        // Git not available - leave empty
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const displayValue = value || currentBranch || "main";

  if (loading) {
    return (
      <div className="text-xs text-stone-400 flex items-center gap-1.5">
        <BranchIcon />
        <span>Loading...</span>
      </div>
    );
  }

  // No branches available (no git service)
  if (branches.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 rounded px-1.5 py-1 transition-colors"
      >
        <BranchIcon />
        <span>{displayValue}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-10 w-64 max-h-48 overflow-y-auto bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-panel-sm shadow-lg">
          {branches.map((branch) => (
            <button
              key={branch}
              type="button"
              onClick={() => {
                onChange(branch);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-stone-50 dark:hover:bg-stone-700 flex items-center gap-2 ${
                branch === displayValue
                  ? "text-orange-600 dark:text-orange-400 font-medium"
                  : "text-stone-700 dark:text-stone-200"
              }`}
            >
              <BranchIcon />
              <span className="truncate">{branch}</span>
              {branch === currentBranch && (
                <span className="ml-auto text-xs text-stone-400 flex-shrink-0">current</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BranchIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="flex-shrink-0"
      aria-hidden="true"
    >
      <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={`flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
    </svg>
  );
}
