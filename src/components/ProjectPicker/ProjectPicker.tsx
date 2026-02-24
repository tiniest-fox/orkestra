//! Project picker — same-window design.
//!
//! Opens in the full 1200×800 window. Selecting a project replaces the page
//! content in-place via `window.location.href` rather than creating a new window.

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { RecentProject } from "../../types/project";

type View = "picker" | "loading" | "error";

interface ErrorInfo {
  path: string;
  message: string;
}

interface ProjectPickerProps {
  errorMessage?: string;
}

function extractErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
    return JSON.stringify(err);
  }
  return "Unknown error";
}

// ============================================================================
// Component
// ============================================================================

export function ProjectPicker({ errorMessage }: ProjectPickerProps) {
  const [view, setView] = useState<View>("picker");
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<ErrorInfo | null>(null);

  useEffect(() => {
    invoke<RecentProject[]>("get_recent_projects").then(setRecents).catch(console.error);
  }, []);

  const openProject = useCallback(async (path: string) => {
    setLoadingPath(path);
    setView("loading");
    try {
      await invoke("load_project_in_window", { path });
      window.location.href = `/?project=${encodeURIComponent(path)}`;
    } catch (err: unknown) {
      setLoadError({ path, message: extractErrorMessage(err) });
      setView("error");
    }
  }, []);

  const handleBrowse = useCallback(async () => {
    try {
      const path = await invoke<string | null>("pick_folder");
      if (path) await openProject(path);
    } catch (err) {
      console.error("Failed to pick folder:", err);
    }
  }, [openProject]);

  const removeRecent = useCallback(async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await invoke<RecentProject[]>("remove_recent_project", {
        path,
      });
      setRecents(updated);
      setSelectedIdx((i) => Math.min(i, Math.max(0, updated.length - 1)));
    } catch (err) {
      console.error("Failed to remove recent:", err);
    }
  }, []);

  const backToPicker = useCallback(() => {
    setView("picker");
    setLoadingPath(null);
    setLoadError(null);
  }, []);

  // Keyboard handling — picker state
  useEffect(() => {
    if (view !== "picker") return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(recents.length - 1, i + 1));
      } else if (e.key === "Enter" && recents.length > 0) {
        e.preventDefault();
        void openProject(recents[selectedIdx].path);
      } else if ((e.key === "Backspace" || e.key === "Delete") && recents.length > 0) {
        e.preventDefault();
        const path = recents[selectedIdx].path;
        invoke<RecentProject[]>("remove_recent_project", { path })
          .then((updated) => {
            setRecents(updated);
            setSelectedIdx((i) => Math.min(i, Math.max(0, updated.length - 1)));
          })
          .catch(console.error);
      } else if (e.metaKey && e.key === "o") {
        e.preventDefault();
        void handleBrowse();
      } else {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 4 && num <= recents.length) {
          setSelectedIdx(num - 1);
        }
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view, recents, selectedIdx, openProject, handleBrowse]);

  // Keyboard handling — loading / error states
  useEffect(() => {
    if (view === "picker") return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        backToPicker();
      } else if (view === "error" && e.metaKey && e.key === "o") {
        e.preventDefault();
        backToPicker();
        void handleBrowse();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view, backToPicker, handleBrowse]);

  const loadingName = loadingPath ? (loadingPath.split("/").pop() ?? loadingPath) : "";

  return (
    <div className="h-screen flex flex-col">
      {/* App header — same structure as the loaded project header */}
      <div className="flex items-center justify-between px-6 h-11 flex-shrink-0 bg-surface border-b border-border">
        <span className="font-sans text-[13px] font-bold tracking-[0.06em] uppercase text-text-primary select-none">
          Orkestra
        </span>
        {/* cmd+k at reduced opacity — unavailable until a project is open */}
        <kbd className="font-mono text-[10px] font-medium text-text-quaternary bg-canvas border border-border rounded px-[6px] py-[2px] leading-none select-none opacity-50">
          cmd+k
        </kbd>
      </div>

      {/* Picker canvas */}
      {view === "picker" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-[440px]">
            {/* Startup error banner (folder not found etc.) */}
            {errorMessage && (
              <div className="mb-4 px-3 py-2 rounded-[7px] bg-status-error-bg border border-status-error/20 text-status-error font-sans text-[13px]">
                {errorMessage}
              </div>
            )}

            {/* Picker card */}
            <div className="bg-surface border border-border rounded-[10px] p-7 shadow-[0_8px_32px_rgba(28,24,32,0.10),0_2px_8px_rgba(28,24,32,0.06)]">
              <h1 className="font-sans text-[20px] font-semibold tracking-[-0.02em] text-text-primary mb-[6px]">
                Open a project
              </h1>
              <p className="font-sans text-[13px] text-text-tertiary mb-6">
                Pick a recent project or browse for a folder.
              </p>

              {/* Recent projects list */}
              {recents.length > 0 && (
                <div className="border border-border rounded-[7px] overflow-hidden mb-[10px]">
                  {recents.slice(0, 4).map((project, idx) => {
                    const isSelected = idx === selectedIdx;
                    return (
                      <button
                        key={project.path}
                        type="button"
                        onClick={() => openProject(project.path)}
                        onKeyDown={(e) => e.key === "Enter" && openProject(project.path)}
                        className={[
                          "group flex items-center justify-between w-full text-left px-[14px] py-[10px] relative transition-colors",
                          idx < Math.min(recents.length - 1, 3) ? "border-b border-border" : "",
                          isSelected
                            ? "bg-accent-soft border-l-2 border-l-accent !pl-[12px]"
                            : "hover:bg-canvas",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-sans text-[13px] font-semibold text-text-primary mb-[2px]">
                            {project.display_name}
                          </div>
                          <div className="font-mono text-[10px] text-text-quaternary truncate">
                            {project.path}
                          </div>
                        </div>
                        {/* Number chip — visible at rest, fades on row hover */}
                        <span className="font-mono text-[10px] font-medium text-text-tertiary bg-black/5 rounded-[3px] px-[5px] py-[1px] leading-[1.5] flex-shrink-0 ml-[10px] transition-opacity group-hover:opacity-0 group-hover:pointer-events-none">
                          {idx + 1}
                        </span>
                        {/* Remove button — hidden at rest, appears on row hover */}
                        <button
                          type="button"
                          onClick={(e) => removeRecent(project.path, e)}
                          className="absolute right-[14px] font-mono text-[13px] text-text-quaternary opacity-0 group-hover:opacity-100 px-[6px] py-[3px] rounded border-0 bg-transparent cursor-pointer hover:text-text-secondary hover:bg-canvas transition-opacity"
                          aria-label={`Remove ${project.display_name} from recents`}
                        >
                          ×
                        </button>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Browse button */}
              <button
                type="button"
                onClick={handleBrowse}
                className="w-full h-[38px] flex items-center justify-center gap-[7px] border border-dashed border-border rounded-[7px] bg-transparent cursor-pointer font-sans text-[13px] text-text-tertiary transition-colors hover:border-text-quaternary hover:text-text-secondary hover:bg-canvas mb-[18px]"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <title>Browse for folder</title>
                  <path d="M1 4.5C1 3.67 1.67 3 2.5 3h2.586a1 1 0 01.707.293L6.5 4H11.5c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5h-9C1.67 12 1 11.33 1 10.5V4.5z" />
                </svg>
                Browse for folder…
                <span className="font-mono text-[10px] font-medium opacity-55 bg-black/[0.06] rounded-[3px] px-[4px] leading-[1.5]">
                  ⌘O
                </span>
              </button>

              {/* Keyboard hint bar */}
              <div className="flex items-center justify-center flex-wrap gap-[6px] font-mono text-[10px] text-text-quaternary">
                <kbd className="bg-canvas border border-border rounded-[3px] px-[5px] py-[1px] font-mono text-[10px] text-text-tertiary">
                  ↑↓
                </kbd>
                {" navigate"}
                <span className="text-border">·</span>
                <kbd className="bg-canvas border border-border rounded-[3px] px-[5px] py-[1px] font-mono text-[10px] text-text-tertiary">
                  1–4
                </kbd>
                {" jump to"}
                <span className="text-border">·</span>
                <kbd className="bg-canvas border border-border rounded-[3px] px-[5px] py-[1px] font-mono text-[10px] text-text-tertiary">
                  ↵
                </kbd>
                {" open"}
                <span className="text-border">·</span>
                <kbd className="bg-canvas border border-border rounded-[3px] px-[5px] py-[1px] font-mono text-[10px] text-text-tertiary">
                  ⌫
                </kbd>
                {" remove"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading canvas */}
      {view === "loading" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-[10px]">
          <div className="w-[18px] h-[18px] rounded-full border-2 border-border border-t-text-tertiary animate-spin mb-[2px]" />
          <div className="font-sans text-[13px] font-semibold text-text-primary">
            Opening {loadingName}…
          </div>
          <div className="font-mono text-[10px] text-text-quaternary mb-[4px]">{loadingPath}</div>
          <button
            type="button"
            onClick={backToPicker}
            className="inline-flex items-center gap-[6px] font-sans text-[12px] font-medium px-3 py-[5px] rounded-[6px] border border-border cursor-pointer bg-transparent text-text-secondary hover:bg-canvas hover:text-text-primary transition-colors whitespace-nowrap leading-[1.4]"
          >
            <span className="font-mono text-[10px] font-medium opacity-55 bg-black/[0.06] rounded-[3px] px-[3px] leading-[1.5]">
              Esc
            </span>
            Cancel
          </button>
        </div>
      )}

      {/* Error canvas */}
      {view === "error" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-[10px]">
          <div className="w-9 h-9 rounded-full bg-status-error-bg flex items-center justify-center text-[15px] text-status-error mb-[2px]">
            ✕
          </div>
          <div className="font-sans text-[13px] font-semibold text-status-error">
            Could not open project
          </div>
          <div className="font-mono text-[10px] text-text-quaternary max-w-[360px] text-center leading-[1.6] mb-[4px]">
            {loadError?.message}
          </div>
          <div className="flex gap-2 mt-[6px]">
            <button
              type="button"
              onClick={backToPicker}
              className="inline-flex items-center gap-[6px] font-sans text-[12px] font-medium px-3 py-[5px] rounded-[6px] border border-border cursor-pointer bg-transparent text-text-secondary hover:bg-canvas hover:text-text-primary transition-colors whitespace-nowrap leading-[1.4]"
            >
              <span className="font-mono text-[10px] font-medium opacity-55 bg-black/[0.06] rounded-[3px] px-[3px] leading-[1.5]">
                Esc
              </span>
              Back to projects
            </button>
            <button
              type="button"
              onClick={handleBrowse}
              className="inline-flex items-center gap-[6px] font-sans text-[12px] font-medium px-3 py-[5px] rounded-[6px] border border-status-error/35 cursor-pointer bg-transparent text-status-error hover:bg-status-error-bg hover:border-status-error transition-colors whitespace-nowrap leading-[1.4]"
            >
              <span className="font-mono text-[10px] font-medium opacity-55 bg-black/[0.06] rounded-[3px] px-[3px] leading-[1.5]">
                ⌘O
              </span>
              Browse for folder…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
