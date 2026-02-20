//! Ship drawer — diff view + merge/open-PR actions for done tasks.

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useDiff } from "../../hooks/useDiff";
import { useSyntaxCss } from "../../hooks/useSyntaxCss";
import { useWorkflowConfig } from "../../providers";
import { artifactName } from "../../types/workflow";
import type { WorkflowArtifact, WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { ActivityLog } from "./ActivityLog";
import { ArtifactView } from "../TaskDetail/ArtifactView";
import { ForgeDiffContent } from "../Diff/Forge/ForgeDiffContent";
import { ForgeDiffFileList } from "../Diff/Forge/ForgeDiffFileList";
import { DiffSkeleton } from "../Diff/DiffSkeleton";
import { Drawer } from "../ui/Drawer/Drawer";
import { HotkeyScope, useNavHandler } from "../ui/HotkeyScope";
import { DrawerHeader } from "./DrawerHeader";

interface ShipDrawerProps {
  task: WorkflowTaskView | null;
  onClose: () => void;
}

function currentArtifact(task: WorkflowTaskView, config: WorkflowConfig): WorkflowArtifact | null {
  const stageEntry = config.stages.find((s) => s.name === task.derived.current_stage);
  if (stageEntry) {
    const name = artifactName(stageEntry.artifact);
    const byName = task.artifacts[name];
    if (byName) return byName;
  }
  const all = Object.values(task.artifacts);
  if (all.length === 0) return null;
  return all.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

const base =
  "inline-flex items-center font-forge-sans text-[13px] font-semibold px-4 py-[7px] rounded-md border cursor-pointer transition-colors whitespace-nowrap leading-snug disabled:opacity-40 disabled:cursor-not-allowed";
const btnApprove = `${base} bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white border-transparent`;
const btnSecondary = `${base} bg-transparent border-[var(--border)] text-[var(--text-1)] hover:bg-[var(--surface-hover)] hover:border-[var(--text-3)]`;

// ============================================================================
// ShipDrawer
// ============================================================================

export function ShipDrawer({ task, onClose }: ShipDrawerProps) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(false);
  }, [task?.id]);

  async function handleMerge() {
    if (!task || loading) return;
    setLoading(true);
    try {
      await invoke("workflow_merge_task", { taskId: task.id });
      onClose();
    } catch (err) {
      console.error("Failed to merge task:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenPr() {
    if (!task || loading) return;
    setLoading(true);
    try {
      await invoke("workflow_open_pr", { taskId: task.id });
      onClose();
    } catch (err) {
      console.error("Failed to open PR:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Drawer open={task !== null} onClose={onClose}>
      {task && (
        <HotkeyScope active={!loading}>
          <ShipDrawerBody
            task={task}
            onClose={onClose}
            loading={loading}
            onMerge={handleMerge}
            onOpenPr={handleOpenPr}
          />
        </HotkeyScope>
      )}
    </Drawer>
  );
}

// ============================================================================
// ShipDrawerBody
// ============================================================================

interface ShipDrawerBodyProps {
  task: WorkflowTaskView;
  onClose: () => void;
  loading: boolean;
  onMerge: () => void;
  onOpenPr: () => void;
}

function ShipDrawerBody({ task, onClose, loading, onMerge, onOpenPr }: ShipDrawerBodyProps) {
  const config = useWorkflowConfig();
  const [view, setView] = useState<"diff" | "activity" | "artifact">("diff");
  const summaryRef = useRef<HTMLDivElement>(null);

  const { diff, loading: diffLoading } = useDiff(view === "diff" ? task.id : null);
  const { css } = useSyntaxCss();
  const [activePath, setActivePath] = useState<string | null>(null);
  const fileSectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset view when task changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => { setView("diff"); setActivePath(null); fileSectionRefs.current.clear(); }, [task.id]);

  function handleFileSectionRef(path: string, el: HTMLDivElement | null) {
    if (el) fileSectionRefs.current.set(path, el);
    else fileSectionRefs.current.delete(path);
  }

  function handleJumpTo(path: string) {
    setActivePath(path);
    const el = fileSectionRefs.current.get(path);
    if (el && scrollRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // Scroll non-diff views with arrow keys / j·k.
  useNavHandler("ArrowDown", () => { if (view !== "diff") summaryRef.current?.scrollBy({ top: 56, behavior: "smooth" }); });
  useNavHandler("j",         () => { if (view !== "diff") summaryRef.current?.scrollBy({ top: 56, behavior: "smooth" }); });
  useNavHandler("ArrowUp",   () => { if (view !== "diff") summaryRef.current?.scrollBy({ top: -56, behavior: "smooth" }); });
  useNavHandler("k",         () => { if (view !== "diff") summaryRef.current?.scrollBy({ top: -56, behavior: "smooth" }); });

  const artifact = currentArtifact(task, config);

  return (
    <div className="flex flex-col h-full">
      <DrawerHeader task={task} config={config} onClose={onClose} />

      {/* Body */}
      {view === "activity" ? (
        <div ref={summaryRef} className="flex-1 overflow-y-auto">
          <ActivityLog iterations={task.iterations} />
        </div>
      ) : view === "artifact" ? (
        <div ref={summaryRef} className="flex-1 overflow-y-auto">
          {artifact ? (
            <ArtifactView artifact={artifact} />
          ) : (
            <div className="p-6 font-forge-mono text-[11px] text-[var(--text-3)]">No artifact.</div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Syntax highlight CSS */}
          {css && (
            <style
              // biome-ignore lint/security/noDangerouslySetInnerHtml: syntect CSS output is trusted
              dangerouslySetInnerHTML={{
                __html: `
                  @media (prefers-color-scheme: light) { ${css.light} }
                  @media (prefers-color-scheme: dark) { ${css.dark} }
                `,
              }}
            />
          )}
          {diffLoading && !diff ? (
            <div className="flex-1 overflow-auto p-4"><DiffSkeleton /></div>
          ) : diff && diff.files.length > 0 ? (
            <>
              <div className="w-48 shrink-0 overflow-y-auto p-2 border-r border-[var(--border)]">
                <ForgeDiffFileList
                  files={diff.files}
                  activePath={activePath}
                  onJumpTo={handleJumpTo}
                />
              </div>
              <div ref={scrollRef} className="flex-1 overflow-auto">
                <ForgeDiffContent
                  files={diff.files}
                  comments={[]}
                  onFileSectionRef={handleFileSectionRef}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 p-6 font-forge-mono text-[11px] text-[var(--text-3)]">No changes.</div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="shrink-0 px-6 border-t border-[var(--border)] flex items-center gap-2.5 h-[52px]">
        {task.pr_url ? (
          <a href={task.pr_url} target="_blank" rel="noreferrer" className={btnSecondary}>
            View PR ↗
          </a>
        ) : (
          <>
            <button className={btnSecondary} onClick={onMerge} disabled={loading}>
              {loading ? "Merging…" : "Merge"}
            </button>
            <button className={btnApprove} onClick={onOpenPr} disabled={loading}>
              {loading ? "Opening…" : "Open PR"}
            </button>
          </>
        )}
        <div className="flex-1" />
        {(["diff", "activity", "artifact"] as const).map((v) => (
          <button
            key={v}
            className={`${btnSecondary} ${view === v ? "bg-[var(--surface-2)]" : ""}`}
            onClick={() => setView(v)}
          >
            {v === "diff" ? "Changes" : v === "activity" ? "Activity" : "Artifact"}
          </button>
        ))}
      </div>
    </div>
  );
}
