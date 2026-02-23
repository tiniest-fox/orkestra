//! Self-contained diff tab — file list sidebar + syntax-highlighted content pane.
//! Handles all scroll tracking, file jumping, and collapse state internally.
//! Registers c / ] / [ / j·k hotkeys when active.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSyntaxCss } from "../../hooks/useSyntaxCss";
import { DiffSkeleton } from "../Diff/DiffSkeleton";
import { ForgeDiffContent } from "../Diff/Forge/ForgeDiffContent";
import { ForgeDiffFileList } from "../Diff/Forge/ForgeDiffFileList";
import { useNavHandler } from "../ui/HotkeyScope";
import { useDrawerDiff } from "./DrawerTaskProvider";

// Forge syntax theme — Catppuccin Latte spirit, Forge palette.
//
// Six hue families (strings and functions are now distinct):
//   Violet  (#7C3AED, --violet)     keywords, storage, modifiers
//   Sky     (#0284C7, --sky)        strings  — passive data, lighter/airier
//   Blue    (#1D64D8, --blue-family) functions — active, callable
//   Amber/Peach/Rust               constants, types, attrs, macros
//   Teal    (#0D9488, --teal)       string escapes, character constants
//   Pink-red (#C42444, --accent)   HTML/JSX tag names
//
// Scoped to .forge-theme + !important to beat syntect's high-specificity selectors.
const FORGE_SYNTAX_OVERRIDES = `
/* -- Comments — intentionally muted, italic -- */
.forge-theme .syn-comment,
.forge-theme .syn-comment span { color: #A090B8 !important; font-style: italic !important; }

/* -- Strings — sky blue (--sky: #0284C7), passive/data feel -- */
.forge-theme [class*="syn-string"],
.forge-theme [class*="syn-string"] span { color: #0284C7 !important; }

/* -- String escapes — teal (--teal: #0D9488), distinct from string body -- */
.forge-theme [class*="syn-string"] [class*="syn-escape"],
.forge-theme [class*="syn-constant"][class*="syn-character"][class*="syn-escape"] { color: #0D9488 !important; }

/* -- Keywords and storage — vivid violet (--violet: #7C3AED) -- */
.forge-theme .syn-keyword,
.forge-theme .syn-keyword span,
.forge-theme .syn-storage,
.forge-theme .syn-storage span,
.forge-theme .syn-storage.syn-type,
.forge-theme .syn-storage.syn-type span,
.forge-theme .syn-storage.syn-modifier,
.forge-theme .syn-storage.syn-modifier span,
.forge-theme .syn-keyword.syn-control,
.forge-theme .syn-keyword.syn-control span,
.forge-theme .syn-keyword.syn-operator,
.forge-theme .syn-keyword.syn-operator span,
.forge-theme .syn-keyword.syn-other,
.forge-theme .syn-keyword.syn-other span { color: #7C3AED !important; }

/* -- Numeric constants — deep amber (--amber: #D97706) -- */
.forge-theme .syn-constant.syn-numeric,
.forge-theme .syn-constant.syn-numeric span { color: #C96800 !important; }

/* -- Language constants (true/false/nil/null) — peach (--peach: #EA580C) -- */
.forge-theme .syn-constant.syn-language,
.forge-theme .syn-constant.syn-language span { color: #EA580C !important; }

/* -- Character constants — teal (--teal: #0D9488) -- */
.forge-theme .syn-constant.syn-character,
.forge-theme .syn-constant.syn-character span { color: #0D9488 !important; }

/* -- Other constants — amber -- */
.forge-theme .syn-constant.syn-other,
.forge-theme .syn-constant.syn-other span { color: #C96800 !important; }

/* -- Function names — royal blue (--blue: #2563EB), deeper than sky strings -- */
.forge-theme .syn-entity.syn-name.syn-function,
.forge-theme .syn-entity.syn-name.syn-function span { color: #1D64D8 !important; }

/* -- Support/builtin functions — same blue family, slightly lighter -- */
.forge-theme .syn-support.syn-function,
.forge-theme .syn-support.syn-function span { color: #2B74D6 !important; }

/* -- Type / class names — golden amber -- */
.forge-theme .syn-entity.syn-name.syn-type,
.forge-theme .syn-entity.syn-name.syn-type span,
.forge-theme .syn-entity.syn-name.syn-class,
.forge-theme .syn-entity.syn-name.syn-class span,
.forge-theme .syn-support.syn-type,
.forge-theme .syn-support.syn-type span,
.forge-theme .syn-support.syn-class,
.forge-theme .syn-support.syn-class span { color: #B8850A !important; }

/* -- HTML/JSX tag names — dark pink-red (brand --accent) -- */
.forge-theme .syn-entity.syn-name.syn-tag,
.forge-theme .syn-entity.syn-name.syn-tag span { color: #C42444 !important; }

/* -- HTML/JSX attribute names — rust-orange -- */
.forge-theme .syn-entity.syn-other.syn-attribute-name,
.forge-theme .syn-entity.syn-other.syn-attribute-name span { color: #AD5C1A !important; }

/* -- Variable parameters — vivid violet, lighter than keyword violet -- */
.forge-theme .syn-variable.syn-parameter,
.forge-theme .syn-variable.syn-parameter span { color: #8B5CF6 !important; }

/* -- Other variables — base text, don't over-color -- */
.forge-theme .syn-variable,
.forge-theme .syn-variable span { color: #1C1820 !important; }

/* -- Punctuation — intentionally muted purple-neutral -- */
.forge-theme .syn-punctuation,
.forge-theme .syn-punctuation span,
.forge-theme .syn-meta.syn-brace,
.forge-theme .syn-meta.syn-brace span { color: #7A7090 !important; }

/* -- Preprocessor / macros — peach (--peach: #EA580C) -- */
.forge-theme .syn-meta.syn-preprocessor,
.forge-theme .syn-meta.syn-preprocessor span,
.forge-theme .syn-support.syn-other.syn-macro,
.forge-theme .syn-support.syn-other.syn-macro span { color: #EA580C !important; }

/* -- Module / namespace names — golden amber -- */
.forge-theme .syn-entity.syn-name.syn-module,
.forge-theme .syn-entity.syn-name.syn-module span,
.forge-theme .syn-entity.syn-name.syn-namespace,
.forge-theme .syn-entity.syn-name.syn-namespace span { color: #B8850A !important; }

/* -- Invalid tokens — red (--red: #DC2626) -- */
.forge-theme .syn-invalid,
.forge-theme .syn-invalid span { color: #DC2626 !important; }
`;

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
          <div className="w-56 shrink-0 overflow-y-auto border-r border-[var(--border)]">
            <ForgeDiffFileList files={diff.files} activePath={activePath} onJumpTo={handleJumpTo} />
          </div>
          <div ref={setScrollRef} className="flex-1 overflow-y-auto">
            <ForgeDiffContent
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
        <div className="flex-1 p-6 font-forge-mono text-[11px] text-[var(--text-3)]">
          No changes.
        </div>
      )}
    </div>
  );
}
