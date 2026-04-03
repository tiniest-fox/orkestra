//! Flow card grid for selecting a workflow pipeline during task creation.

import { useEffect, useState } from "react";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { FlowConfig } from "../../types/workflow";

interface FlowPickerProps {
  flows: Record<string, FlowConfig>;
  selected: string | null;
  onChange: (flowId: string) => void;
}

interface FlowCard {
  id: string;
  name: string;
  stageNames: string[];
}

export function FlowPicker({ flows, selected, onChange }: FlowPickerProps) {
  const isMobile = useIsMobile();
  const flowEntries = Object.entries(flows);

  const cards: FlowCard[] = flowEntries.map(([id, flow]) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " "),
    stageNames: flow.stages.map((s) => s.display_name ?? s.name),
  }));

  const selectedIndex = cards.findIndex((c) => c.id === selected);
  const [focusedIndex, setFocusedIndex] = useState(Math.max(0, selectedIndex));

  // Keep focused index in sync when selected changes externally.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional sync only when selected changes
  useEffect(() => {
    const idx = cards.findIndex((c) => c.id === selected);
    if (idx >= 0) setFocusedIndex(idx);
  }, [selected]);

  if (cards.length <= 1) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-sans text-[11px] font-medium text-text-tertiary uppercase tracking-[0.06em] select-none">
          Flow
        </span>
        {!isMobile && (
          <span className="font-mono text-[10px] text-text-quaternary select-none">⌥← ⌥→</span>
        )}
      </div>
      <div
        role="radiogroup"
        aria-label="Workflow flow"
        className="grid grid-cols-2 gap-2"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault();
            const next = Math.max(0, focusedIndex - 1);
            setFocusedIndex(next);
            onChange(cards[next].id);
          } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault();
            const next = Math.min(cards.length - 1, focusedIndex + 1);
            setFocusedIndex(next);
            onChange(cards[next].id);
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onChange(cards[focusedIndex].id);
          }
        }}
      >
        {cards.map((card, index) => {
          const isSelected = selected === card.id;
          return (
            // biome-ignore lint/a11y/useSemanticElements: custom styled radio card; button with role="radio" inside radiogroup is valid ARIA
            <button
              key={card.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={index === focusedIndex ? 0 : -1}
              onClick={() => {
                setFocusedIndex(index);
                onChange(card.id);
              }}
              className={[
                "text-left rounded px-3 py-2 border transition-colors focus:outline-none",
                "flex flex-col gap-1",
                isSelected
                  ? "border-accent bg-canvas"
                  : "border-border bg-surface hover:bg-canvas hover:border-text-quaternary",
              ].join(" ")}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={[
                    "font-sans text-[12px] font-semibold",
                    isSelected ? "text-accent" : "text-text-primary",
                  ].join(" ")}
                >
                  {card.name}
                </span>
              </div>
              <span className="font-mono text-[10px] text-text-tertiary leading-relaxed">
                {card.stageNames.join(" → ")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
