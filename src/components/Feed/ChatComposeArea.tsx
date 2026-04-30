// Shared compose area — textarea with auto-resize + send/stop button.
// Used in AssistantDrawer (project/task chat) and AgentTab (agent timeline).

import { ArrowUp, Square, X } from "lucide-react";
import type React from "react";
import { memo, useEffect, useRef } from "react";
import { useIsMobile } from "../../hooks/useIsMobile";

export interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
}

interface ChatComposeAreaProps {
  value: string;
  onChange: (v: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  /** Disables the textarea and send button while a request is in flight. */
  sending: boolean;
  /** When true, shows the amber stop button instead of the send button. */
  agentActive: boolean;
  onSend: () => void;
  onStop: () => void;
  placeholder?: string;
  error?: string | null;
  /** Applied to the outer wrapper — use for padding and background. */
  className?: string;
  /** Called after the textarea height has been set (auto-resize settled). */
  onResize?: () => void;
  /** Pending images to display as thumbnail chips (Tauri only). */
  pendingImages?: PendingImage[];
  /** Called when images are pasted or dropped onto the compose area. */
  onImagesAdded?: (images: PendingImage[]) => void;
  /** Called when a thumbnail chip's remove button is clicked. */
  onImageRemoved?: (id: string) => void;
}

export const ChatComposeArea = memo(function ChatComposeArea({
  value,
  onChange,
  textareaRef,
  sending,
  agentActive,
  onSend,
  onStop,
  placeholder = "Send a message…",
  error,
  className = "",
  onResize,
  pendingImages,
  onImagesAdded,
  onImageRemoved,
}: ChatComposeAreaProps) {
  const isMobile = useIsMobile();
  const prevHeightRef = useRef(0);

  // Auto-resize textarea to fit content, capped at 120px.
  // Only calls onResize when the height actually changes — not on every keystroke —
  // so callers can scroll to accommodate the new size without spurious snaps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value is the resize trigger
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const newHeight = Math.min(el.scrollHeight, 120);
    el.style.height = `${newHeight}px`;
    if (newHeight !== prevHeightRef.current) {
      prevHeightRef.current = newHeight;
      onResize?.();
    }
  }, [value, onResize]);

  function handlePaste(e: React.ClipboardEvent) {
    if (!onImagesAdded) return;
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const newImages: PendingImage[] = imageItems.flatMap((item) => {
      const file = item.getAsFile();
      if (!file) return [];
      return [{ id: crypto.randomUUID() as string, file, previewUrl: URL.createObjectURL(file) }];
    });
    onImagesAdded(newImages);
  }

  function handleDragOver(e: React.DragEvent) {
    if (!onImagesAdded) return;
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDrop(e: React.DragEvent) {
    if (!onImagesAdded) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    const newImages: PendingImage[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    onImagesAdded(newImages);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault();
      if (!agentActive && (value.trim() || pendingImages?.length) && !sending) onSend();
    }
    if (e.key === "." && e.metaKey && agentActive) {
      e.preventDefault();
      onStop();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      textareaRef.current?.blur();
    }
  }

  return (
    <section
      className={className}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      aria-label="Compose message"
    >
      {pendingImages && pendingImages.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-2">
          {pendingImages.map((img) => (
            <div key={img.id} className="relative group">
              <img
                src={img.previewUrl}
                alt=""
                className="h-16 w-16 object-cover rounded-lg border border-border"
              />
              {onImageRemoved && (
                <button
                  type="button"
                  onClick={() => onImageRemoved(img.id)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-surface-3 border border-border flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors"
                  aria-label="Remove image"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={sending}
          placeholder={placeholder}
          rows={1}
          className="flex-1 font-sans text-forge-body bg-surface border border-border rounded-xl px-3.5 py-2.5 outline-none resize-none overflow-hidden text-text-primary placeholder:text-text-quaternary focus:border-text-quaternary transition-colors leading-relaxed disabled:opacity-40 min-h-[42px] max-h-[120px]"
        />
        {agentActive ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            className={`shrink-0 h-10 rounded-full bg-status-warning hover:opacity-90 flex items-center justify-center text-white transition-opacity gap-1.5 ${isMobile ? "w-10" : "px-4"}`}
          >
            <Square size={13} fill="currentColor" />
            {!isMobile && (
              <span className="font-mono text-forge-mono-sm font-semibold">
                Stop<span className="opacity-60 ml-1.5">⌘.</span>
              </span>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={(!value.trim() && !pendingImages?.length) || sending}
            aria-label="Send"
            className={`shrink-0 h-10 rounded-full bg-accent hover:bg-accent-hover flex items-center justify-center text-white transition-colors disabled:opacity-30 gap-1.5 ${isMobile ? "w-10" : "px-4"}`}
          >
            <ArrowUp size={15} />
            {!isMobile && (
              <span className="font-mono text-forge-mono-sm font-semibold">
                Send<span className="opacity-60 ml-1.5">↵</span>
              </span>
            )}
          </button>
        )}
      </div>
      {error && (
        <p className="font-sans text-forge-mono-sm text-status-error mt-1.5 px-0.5">{error}</p>
      )}
    </section>
  );
});
