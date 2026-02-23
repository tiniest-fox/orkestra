//! Flow card grid for selecting an alternate workflow pipeline during task creation.

import { useEffect, useState } from "react";
import type { FlowConfig, FlowStageEntry, StageConfig } from "../../types/workflow";

interface FlowPickerProps {
  flows: Record<string, FlowConfig>;
  stages: StageConfig[];
  selected: string | null;
  onChange: (flowId: string | null) => void;
}

interface FlowCard {
  id: string | null;
  name: string;
  stageNames: string[];
}

function stageNameFromEntry(entry: FlowStageEntry): string {
  if (typeof entry === "string") return entry;
  return Object.keys(entry)[0];
}

export function FlowPicker({ flows, stages, selected, onChange }: FlowPickerProps) {
  const flowEntries = Object.entries(flows);
  const allStageNames = stages.map((s) => s.display_name ?? s.name);

  const cards: FlowCard[] = [
    {
      id: null,
      name: "Default",
      stageNames: allStageNames,
    },
    ...flowEntries.map(([id, flow]) => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " "),
      stageNames: flow.stages.map((entry) => {
        const stageName = stageNameFromEntry(entry);
        const config = stages.find((s) => s.name === stageName);
        return config?.display_name ?? stageName;
      }),
    })),
  ];

  const selectedIndex = cards.findIndex((c) => c.id === selected);
  const [focusedIndex, setFocusedIndex] = useState(Math.max(0, selectedIndex));

  // Keep focused index in sync when selected changes externally.
  useEffect(() => {
    const idx = cards.findIndex((c) => c.id === selected);
    if (idx >= 0) setFocusedIndex(idx);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  if (cards.length <= 1) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-forge-sans text-[11px] font-medium text-[var(--text-2)] uppercase tracking-[0.06em] select-none">
          Flow
        </span>
        <span className="font-forge-mono text-[10px] text-[var(--text-3)] select-none">⌘← ⌘→</span>
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
            <button
              key={card.id ?? "__default__"}
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
                  ? "border-[var(--accent)] bg-[var(--surface-1)]"
                  : "border-[var(--border)] bg-[var(--surface-0)] hover:bg-[var(--surface-2)] hover:border-[var(--text-3)]",
              ].join(" ")}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={[
                    "font-forge-sans text-[12px] font-semibold",
                    isSelected ? "text-[var(--accent)]" : "text-[var(--text-0)]",
                  ].join(" ")}
                >
                  {card.name}
                </span>
              </div>
              <span className="font-forge-mono text-[10px] text-[var(--text-2)] leading-relaxed">
                {card.stageNames.join(" → ")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
