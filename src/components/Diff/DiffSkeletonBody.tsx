// biome-ignore-all lint/suspicious/noArrayIndexKey: static skeleton placeholders
import { FlexContainer } from "../ui";

/**
 * DiffSkeletonBody - Shared skeleton layout for diff panels.
 *
 * Renders a two-pane skeleton matching the actual diff layout:
 * - Left: File list skeleton (w-48, 5 pulsing bars)
 * - Right: Diff content skeleton (12 pulsing lines of varying widths)
 */
export function DiffSkeletonBody() {
  return (
    <FlexContainer>
      {/* File list skeleton */}
      <div className="w-48 flex-shrink-0 flex flex-col -mr-2">
        <div className="px-2 py-1 mr-4 h-7 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
        <div className="flex-1 mt-1 space-y-1">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-7 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
          ))}
        </div>
      </div>
      {/* Diff content skeleton */}
      <div className="flex-1 p-4 space-y-2">
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="h-4 bg-stone-200 dark:bg-stone-700 rounded animate-pulse"
            style={{ width: `${[85, 70, 95, 60, 75, 90, 65, 80, 55, 88, 72, 68][i]}%` }}
          />
        ))}
      </div>
    </FlexContainer>
  );
}
