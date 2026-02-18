/**
 * Dropdown - Lightweight dropdown menu anchored to a trigger element.
 * Supports controlled and uncontrolled modes with click-outside and ESC dismissal.
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

interface TriggerProps {
  onClick: () => void;
}

interface DropdownProps {
  /** Render prop for trigger element - receives onClick handler to wire up */
  trigger: (props: TriggerProps) => ReactNode;
  /** Dropdown content */
  children: ReactNode;
  /** Controlled open state (optional) */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Alignment relative to trigger: "left" (default) or "right" */
  align?: "left" | "right";
  /** Additional className for the dropdown panel */
  className?: string;
}

interface DropdownItemProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

function DropdownRoot({
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  align = "left",
  className = "",
}: DropdownProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Use controlled state if provided, otherwise use internal state
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const setOpen = useCallback(
    (value: boolean) => {
      if (!isControlled) {
        setInternalOpen(value);
      }
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange],
  );

  const handleClose = useCallback(() => setOpen(false), [setOpen]);
  const handleToggle = useCallback(() => setOpen(!isOpen), [setOpen, isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen, handleClose]);

  // Close dropdown on ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  const alignmentClass = align === "right" ? "right-0" : "left-0";

  return (
    <div ref={containerRef} className="relative">
      {trigger({ onClick: handleToggle })}

      {isOpen && (
        <div
          className={`absolute top-full mt-1 z-10 min-w-[160px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-panel-sm shadow-lg overflow-hidden ${alignmentClass} ${className}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function DropdownItem({ children, onClick, className = "" }: DropdownItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700 ${className}`}
    >
      {children}
    </button>
  );
}

export const Dropdown = Object.assign(DropdownRoot, { Item: DropdownItem });
