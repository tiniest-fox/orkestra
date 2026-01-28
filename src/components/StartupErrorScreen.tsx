import type { StartupError } from "../types/startup";
import { getCategoryLabel } from "../types/startup";

interface Props {
  /** List of startup errors to display */
  errors: StartupError[];
  /** Callback to retry startup (re-check status after user fixes config) */
  onRetry: () => void;
  /** Whether a retry is currently in progress */
  isRetrying?: boolean;
}

/**
 * Full-page error screen shown when startup fails.
 *
 * Displays each error with its category, message, details, and remediation suggestion.
 * Includes a retry button so users can fix their config and try again.
 */
export function StartupErrorScreen({ errors, onRetry, isRetrying = false }: Props) {
  return (
    <div className="h-screen bg-stone-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white rounded-panel shadow-panel-elevated p-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
            <svg
              className="w-6 h-6 text-error"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-heading font-semibold text-stone-900">Startup Failed</h1>
            <p className="text-sm text-stone-500">Please fix the issues below and try again</p>
          </div>
        </div>

        {/* Errors */}
        <div className="space-y-4 mb-6">
          {errors.map((error) => (
            <div
              key={`${error.category}-${error.message}`}
              className="border border-red-200 rounded-panel-sm p-4 bg-red-50"
            >
              {/* Category badge */}
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-error rounded-full">
                  {getCategoryLabel(error.category)}
                </span>
              </div>

              {/* Error message */}
              <p className="text-red-800 font-medium mb-2">{error.message}</p>

              {/* Details list */}
              {error.details.length > 0 && (
                <ul className="list-disc list-inside text-sm text-red-700 mb-3 space-y-1 pl-1">
                  {error.details.map((detail) => (
                    <li key={detail} className="break-words">
                      {detail}
                    </li>
                  ))}
                </ul>
              )}

              {/* Remediation suggestion */}
              {error.remediation && (
                <div className="flex items-start gap-2 text-sm text-stone-600 bg-white/60 rounded-panel-sm p-2 mt-2">
                  <span className="text-sage-600 flex-shrink-0">Tip:</span>
                  <span>{error.remediation}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Retry button */}
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="w-full px-4 py-3 bg-sage-500 text-white rounded-panel-sm hover:bg-sage-600
                     transition-colors font-medium flex items-center justify-center gap-2
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRetrying ? (
            <>
              <svg
                className="w-4 h-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Retrying...
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Retry
            </>
          )}
        </button>
      </div>
    </div>
  );
}
