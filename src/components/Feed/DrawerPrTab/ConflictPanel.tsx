//! Inline warning panel shown when the PR branch has merge conflicts.

export function ConflictPanel({ baseBranch }: { baseBranch: string }) {
  return (
    <div className="mx-6 my-4 px-4 py-3 rounded-lg border bg-status-warning-bg border-status-warning/40">
      <div className="font-sans text-[12px] font-semibold text-status-warning mb-1">
        Merge conflicts
      </div>
      <p className="font-sans text-[12px] text-text-secondary leading-relaxed">
        This branch has conflicts with{" "}
        <span className="font-mono text-[11px] bg-canvas px-1 py-0.5 rounded">{baseBranch}</span>.
        Use "Fix Conflicts" to send the task back to the agent for resolution.
      </p>
    </div>
  );
}
