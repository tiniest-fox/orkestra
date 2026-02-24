//! Self-contained diff tab — file list sidebar + syntax-highlighted content pane.
//! Handles all scroll tracking, file jumping, and collapse state internally.
//! Registers c / ] / [ / j·k hotkeys when active.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSyntaxCss } from "../../hooks/useSyntaxCss";
import { FORGE_SYNTAX_OVERRIDES } from "../../styles/syntaxHighlighting";
import { DiffContent } from "../Diff/DiffContent";
import { DiffFileList } from "../Diff/DiffFileList";
import { DiffSkeleton } from "../Diff/DiffSkeleton";
import { useNavHandler } from "../ui/HotkeyScope";
import { useDrawerDiff } from "./DrawerTaskProvider";

interface DrawerDiffTabProps {
  /** Whether this tab is currently visible — controls data loading and hotkey registration. */
  active: boolean;
}

export function DrawerDiffTab({ active }: DrawerDiffTabProps) {
  const { diff, diffLoading } = useDrawerDiff();
  const { css } = useSyntaxCss();
  const [activePath, setActivePath] = useState<string | null>(null);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const fileSectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setScrollRef = useCallback((el: HTMLDivElement | null) => {
    (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    setScrollEl(el);
  }, []);

  // Pre-select the first file when the diff loads.
  useEffect(() => {
    if (diff && diff.files.length > 0 && activePath === null) {
      setActivePath(diff.files[0].path);
    }
  }, [diff, activePath]);

  function handleFileSectionRef(path: string, el: HTMLDivElement | null) {
    if (el) fileSectionRefs.current.set(path, el);
    else fileSectionRefs.current.delete(path);
  }

  function handleToggleCollapsed(path: string) {
    const isCollapsed = collapsedPaths.has(path);
    if (!isCollapsed) {
      const el = fileSectionRefs.current.get(path);
      const container = scrollRef.current;
      if (el && container) {
        const elTop = el.getBoundingClientRect().top;
        const containerTop = container.getBoundingClientRect().top;
        const targetScrollTop = container.scrollTop + (elTop - containerTop);
        setCollapsedPaths((prev) => {
          const next = new Set(prev);
          next.add(path);
          return next;
        });
        requestAnimationFrame(() => {
          container.scrollTop = targetScrollTop;
        });
        return;
      }
    }
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const jumpingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleJumpTo(path: string) {
    setActivePath(path);
    if (jumpingRef.current) clearTimeout(jumpingRef.current);
    jumpingRef.current = setTimeout(() => {
      jumpingRef.current = null;
    }, 600);
    const el = fileSectionRefs.current.get(path);
    if (el && scrollRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const ACTIVE_FILE_BUFFER = 24;
  const pickActiveFile = useCallback(() => {
    if (jumpingRef.current) return;
    const container = scrollRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;

    let active: string | null = null;
    let bestTop = -Infinity;
    let nextPath: string | null = null;
    let nextTop = Infinity;

    for (const [path, el] of fileSectionRefs.current) {
      const rect = el.getBoundingClientRect();
      if (rect.top <= containerTop) {
        if (rect.bottom > containerTop + ACTIVE_FILE_BUFFER && rect.top > bestTop) {
          bestTop = rect.top;
          active = path;
        }
      } else {
        if (rect.top < nextTop) {
          nextTop = rect.top;
          nextPath = path;
        }
      }
    }

    if (active === null && bestTop === -Infinity && nextPath !== null) {
      active = nextPath;
    }
    if (active !== null) setActivePath(active);
  }, []);

  useEffect(() => {
    if (!scrollEl) return;
    scrollEl.addEventListener("scroll", pickActiveFile, { passive: true });
    return () => scrollEl.removeEventListener("scroll", pickActiveFile);
  }, [scrollEl, pickActiveFile]);

  useEffect(() => {
    const id = requestAnimationFrame(pickActiveFile);
    return () => cancelAnimationFrame(id);
  }, [pickActiveFile]);

  // Keyboard navigation — only meaningful when this tab is active.
  useNavHandler("ArrowDown", () => {
    if (active) scrollRef.current?.scrollBy({ top: 120, behavior: "smooth" });
  });
  useNavHandler("j", () => {
    if (active) scrollRef.current?.scrollBy({ top: 120, behavior: "smooth" });
  });
  useNavHandler("ArrowUp", () => {
    if (active) scrollRef.current?.scrollBy({ top: -120, behavior: "smooth" });
  });
  useNavHandler("k", () => {
    if (active) scrollRef.current?.scrollBy({ top: -120, behavior: "smooth" });
  });
  useNavHandler("c", () => {
    if (active && activePath) handleToggleCollapsed(activePath);
  });
  useNavHandler("]", () => {
    if (!active || !diff) return;
    const paths = diff.files.map((f) => f.path);
    const next = paths[(activePath ? paths.indexOf(activePath) : -1) + 1];
    if (next) handleJumpTo(next);
  });
  useNavHandler("[", () => {
    if (!active || !diff) return;
    const paths = diff.files.map((f) => f.path);
    const prev = paths[(activePath ? paths.indexOf(activePath) : paths.length) - 1];
    if (prev) handleJumpTo(prev);
  });

  return (
    <div className="flex flex-1 overflow-hidden">
      {css && (
        <style
          // biome-ignore lint/security/noDangerouslySetInnerHtml: syntect CSS output is trusted
          dangerouslySetInnerHTML={{ __html: css.light + FORGE_SYNTAX_OVERRIDES }}
        />
      )}
      {diffLoading && !diff ? (
        <div className="flex-1 overflow-auto p-4">
          <DiffSkeleton />
        </div>
      ) : diff && diff.files.length > 0 ? (
        <>
          <div className="w-56 shrink-0 overflow-y-auto border-r border-border">
            <DiffFileList files={diff.files} activePath={activePath} onJumpTo={handleJumpTo} />
          </div>
          <div ref={setScrollRef} className="flex-1 overflow-y-auto">
            <DiffContent
              files={diff.files}
              comments={[]}
              activePath={activePath}
              collapsedPaths={collapsedPaths}
              onToggleCollapsed={handleToggleCollapsed}
              onFileSectionRef={handleFileSectionRef}
            />
          </div>
        </>
      ) : (
        <div className="flex-1 p-6 font-mono text-[11px] text-text-quaternary">No changes.</div>
      )}
    </div>
  );
}
