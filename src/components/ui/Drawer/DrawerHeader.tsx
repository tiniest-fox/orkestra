// Shared header for all drawers and modals.
//
// Desktop: single h-11 row — title left, actions middle, esc+X right.
// Mobile: h-11 title row, then optional actions row with icon+label buttons
//         separated by dividers, each flex-1.
// The caller passes actions[] once; layout is handled automatically.
//
// When `expandable` is provided, clicking the title shows a chevron toggle.
// Expanding reveals task ID (copy-on-click) and description in a separate
// section below the fixed-height title row — nothing in the title row moves.

import { ArrowLeft, ChevronDown, X } from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import { useIsMobile } from "../../../hooks/useIsMobile";
import { Kbd } from "../Kbd";

export interface DrawerAction {
  icon: ReactNode;
  /** Used as aria-label on mobile (full) and tooltip on desktop. */
  label: string;
  /** Short label shown under the icon in the mobile actions row. */
  shortLabel?: string;
  /** Kbd badge shown on desktop only, e.g. "⇧T". */
  hotkeyLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Highlights the icon when true. */
  active?: boolean;
  /** Tailwind color class for the active state, e.g. "text-purple-500". Defaults to text-accent. */
  activeClassName?: string;
  destructive?: boolean;
}

interface DrawerHeaderProps {
  title: ReactNode;
  onClose: () => void;
  /** When provided, renders a back-arrow button to the left of the title. */
  onBack?: () => void;
  actions?: DrawerAction[];
  /** Hides the esc hint without collapsing its space (prevents layout jump in reject mode). */
  escHidden?: boolean;
  /** When provided, the title becomes clickable and expands to show full details. */
  expandable?: { taskId: string; description?: string | null };
}

export const DrawerHeader = memo(function DrawerHeader({
  title,
  onClose,
  onBack,
  actions = [],
  escHidden,
  expandable,
}: DrawerHeaderProps) {
  const isMobile = useIsMobile();
  const hasActions = actions.length > 0;
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleCopyId() {
    if (!expandable) return;
    navigator.clipboard.writeText(expandable.taskId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="shrink-0 border-b border-border">
      {/* Title row — always h-11, never grows */}
      <div className="flex items-center h-11 px-6 gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="shrink-0 -ml-1 flex items-center justify-center w-6 h-6 text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <ArrowLeft size={14} />
          </button>
        )}

        {/* Title — with optional chevron toggle */}
        <div className="flex-1 min-w-0">
          {expandable ? (
            // biome-ignore lint/a11y/useSemanticElements: title is a toggle; div+role avoids button nesting issues with inner copy button
            <div
              role="button"
              tabIndex={0}
              onClick={() => setExpanded((e) => !e)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v);
              }}
              className="flex items-center gap-1.5 cursor-pointer select-none min-w-0"
            >
              <span className="font-sans text-forge-body font-semibold text-text-primary truncate">
                {title}
              </span>
              <ChevronDown
                size={12}
                className={`shrink-0 text-text-quaternary transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
              />
            </div>
          ) : (
            <div className="font-sans text-forge-body font-semibold text-text-primary truncate">
              {title}
            </div>
          )}
        </div>

        {/* Desktop: actions + esc + X inline, separated by full-height dividers */}
        {!isMobile && (
          <div className="flex items-stretch self-stretch shrink-0 border-l border-border">
            {actions.map((action) => (
              <>
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  disabled={action.disabled}
                  title={`${action.label}${action.hotkeyLabel ? ` (${action.hotkeyLabel})` : ""}`}
                  className={[
                    "flex items-center gap-1.5 px-3 transition-colors disabled:opacity-40 [&>span>svg]:w-[14px] [&>span>svg]:h-[14px]",
                    action.destructive
                      ? "text-text-quaternary hover:text-status-error"
                      : action.active
                        ? (action.activeClassName ?? "text-accent")
                        : "text-text-quaternary hover:text-text-secondary",
                  ].join(" ")}
                >
                  <span>{action.icon}</span>
                  {action.hotkeyLabel && <Kbd>{action.hotkeyLabel}</Kbd>}
                </button>
                <div className="w-px self-stretch bg-border" />
              </>
            ))}
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="flex items-center gap-1.5 px-3 text-text-quaternary hover:text-text-secondary transition-colors"
            >
              <span>
                <X size={14} />
              </span>
              <span className={`inline-flex items-center${escHidden ? " invisible" : ""}`}>
                <Kbd>esc</Kbd>
              </span>
            </button>
          </div>
        )}

        {/* Mobile: X only in title row */}
        {isMobile && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 flex items-center justify-center w-11 h-11 -mr-3 text-text-quaternary hover:text-text-secondary transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Expanded details — separate section, never moves title row */}
      {expanded && expandable && (
        <div className="px-6 pt-1 pb-3 flex flex-col gap-1.5 border-t border-border">
          {/* Task ID — copy on click */}
          <button
            type="button"
            onClick={handleCopyId}
            onKeyDown={() => {}}
            className="font-mono text-forge-mono-label text-text-quaternary hover:text-text-secondary transition-colors text-left w-fit"
          >
            {copied ? "copied!" : expandable.taskId}
          </button>
          {expandable.description && (
            <p className="font-sans text-forge-body text-text-secondary whitespace-pre-wrap max-h-36 overflow-y-auto">
              {expandable.description}
            </p>
          )}
        </div>
      )}

      {/* Mobile actions row — icon + label buttons, divided, each flex-1 */}
      {isMobile && hasActions && (
        <div className="flex items-stretch border-t border-border divide-x divide-border">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              aria-label={action.label}
              className={[
                "flex-1 flex flex-row items-center justify-center gap-1.5 py-3 transition-colors disabled:opacity-40 [&>svg]:w-[14px] [&>svg]:h-[14px]",
                action.destructive
                  ? "text-text-tertiary hover:text-status-error"
                  : action.active
                    ? (action.activeClassName ?? "text-accent")
                    : "text-text-tertiary hover:text-text-secondary",
              ].join(" ")}
            >
              {action.icon}
              <span className="font-sans text-[11px] leading-none font-medium">
                {action.shortLabel ?? action.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
