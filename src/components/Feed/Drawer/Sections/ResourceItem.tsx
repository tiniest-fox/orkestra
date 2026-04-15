// Shared resource item — renders image or link based on URL extension.

import { convertFileSrc } from "@tauri-apps/api/core";
import type { WorkflowResource } from "../../../../types/workflow";
import { formatTimestamp } from "../../../../utils";

// ============================================================================
// Helpers
// ============================================================================

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg)$/i;

export function isImageUrl(url: string): boolean {
  return IMAGE_EXTENSIONS.test(url);
}

const IS_TAURI = !!import.meta.env.TAURI_ENV_PLATFORM;

function resolveImageSrc(url: string): string | null {
  if (!isImageUrl(url)) return null;
  if (IS_TAURI) return convertFileSrc(url);
  return null; // web/daemon: no image rendering
}

// ============================================================================
// Component
// ============================================================================

interface ResourceItemProps {
  resource: WorkflowResource;
}

export function ResourceItem({ resource }: ResourceItemProps) {
  const imageSrc = resource.url ? resolveImageSrc(resource.url) : null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-forge-mono-sm font-semibold text-text-primary">{resource.name}</span>
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={resource.description || resource.name}
          className="max-w-full rounded border border-border"
        />
      ) : resource.url ? (
        <a
          href={resource.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-forge-mono-sm text-accent truncate"
        >
          {resource.url}
        </a>
      ) : null}
      {resource.description && (
        <span className="text-forge-mono-sm text-text-secondary">{resource.description}</span>
      )}
      <span className="text-forge-mono-label text-text-tertiary">
        {resource.stage} · {formatTimestamp(resource.created_at)}
      </span>
    </div>
  );
}
