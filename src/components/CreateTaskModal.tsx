import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    title: string | undefined,
    description: string,
    autoApprove?: boolean,
    baseBranch?: string,
  ) => Promise<unknown>;
}

export function CreateTaskModal({ isOpen, onClose, onSubmit }: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [autoApprove, setAutoApprove] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Branch selector state
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const branchDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch branches when modal opens
  const fetchBranches = useCallback(async () => {
    try {
      const [branchList, currentBranch] = await Promise.all([
        invoke<string[]>("get_branches"),
        invoke<string>("get_current_branch"),
      ]);
      setBranches(branchList);
      setSelectedBranch(currentBranch);
    } catch (err) {
      console.error("Failed to fetch branches:", err);
      // Set a fallback if git isn't available
      setBranches([]);
      setSelectedBranch(null);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchBranches();
    }
  }, [isOpen, fetchBranches]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showBranchDropdown) {
          setShowBranchDropdown(false);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, showBranchDropdown]);

  // Handle clicking outside the dropdown to close it
  useEffect(() => {
    if (!showBranchDropdown) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setShowBranchDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showBranchDropdown]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      // Pass undefined for title if empty (will be auto-generated)
      const titleToSubmit = title.trim() || undefined;
      await onSubmit(titleToSubmit, description.trim(), autoApprove, selectedBranch ?? undefined);
      setTitle("");
      setDescription("");
      setAutoApprove(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape key handled separately
    // biome-ignore lint/a11y/noStaticElementInteractions: Modal backdrop pattern
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">New Task</h2>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
                Title <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Leave blank to auto-generate"
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                placeholder="Describe the task in detail..."
                // biome-ignore lint/a11y/noAutofocus: intentional focus for modal UX
                autoFocus
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={autoApprove}
                onClick={() => setAutoApprove(!autoApprove)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  autoApprove ? "bg-blue-600" : "bg-gray-200"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    autoApprove ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
              <button
                type="button"
                onClick={() => setAutoApprove(!autoApprove)}
                className="flex flex-col text-left cursor-pointer"
              >
                <span className="text-sm font-medium text-gray-700">Auto-progress</span>
                <span className="text-xs text-gray-500">
                  Automatically advance through all stages without manual review
                </span>
              </button>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center">
            {/* Branch selector on the left */}
            <div className="relative" ref={branchDropdownRef}>
              {selectedBranch && branches.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowBranchDropdown(!showBranchDropdown)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <title>Git branch</title>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                      />
                    </svg>
                    <span className="max-w-32 truncate">{selectedBranch}</span>
                    <svg
                      className={`w-4 h-4 transition-transform ${showBranchDropdown ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <title>Toggle dropdown</title>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>

                  {showBranchDropdown && (
                    <div className="absolute bottom-full left-0 mb-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto z-10">
                      {branches.map((branch) => (
                        <button
                          key={branch}
                          type="button"
                          onClick={() => {
                            setSelectedBranch(branch);
                            setShowBranchDropdown(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 transition-colors ${
                            branch === selectedBranch
                              ? "bg-blue-50 text-blue-700 font-medium"
                              : "text-gray-700"
                          }`}
                        >
                          <span className="truncate block">{branch}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Action buttons on the right */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !description.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting
                  ? title.trim()
                    ? "Creating..."
                    : "Generating title..."
                  : "Create Task"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
