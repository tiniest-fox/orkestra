//! Top-level React error boundary — catches uncaught render errors and shows a
//! recovery screen instead of a blank page.
//!
//! The fallback deliberately avoids importing context-dependent components so
//! it cannot itself throw. It replicates the FeedLoadingSkeleton shell (header
//! + body + footer) with an inline error display.

import React, { type ReactNode } from "react";

// ============================================================================
// Fallback UI
// ============================================================================

// Kept as a plain function (no hooks, no context) so it is safe to render even
// when providers are missing — exactly the class of error we are catching.
function ErrorFallback({ error }: { error: Error }) {
  return (
    <div className="w-screen h-screen overflow-clip flex flex-col">
      {/* Header — mirrors FeedLoadingSkeleton */}
      <div className="flex items-center px-6 h-11 border-b border-border bg-surface shrink-0">
        <span className="font-sans text-[13px] font-bold tracking-[0.06em] uppercase text-text-primary select-none">
          Orkestra
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-canvas px-6">
        <p className="text-sm font-semibold text-status-error">Something went wrong</p>
        <p className="text-xs text-text-tertiary text-center max-w-md font-mono break-all">
          {error.message}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 text-xs text-text-secondary underline hover:text-text-primary transition-colors"
        >
          Reload
        </button>
      </div>

      {/* Footer — mirrors FeedLoadingSkeleton desktop footer */}
      <div className="h-7 border-t border-border bg-surface shrink-0" />
    </div>
  );
}

// ============================================================================
// Boundary
// ============================================================================

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Wrap the app root with this component so uncaught render errors show a
 * recovery screen instead of a blank page.
 *
 * Place it as high as possible in the tree — ideally wrapping the entire
 * ReactDOM.createRoot render — so it catches errors thrown by providers too.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console so the error is visible in devtools even when the
    // boundary catches it (React suppresses the red overlay in production).
    console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}
