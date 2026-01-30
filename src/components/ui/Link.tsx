/**
 * Link - Styled anchor component with hover states.
 * Fits the purple accent of the design system.
 */

import type { AnchorHTMLAttributes, ReactNode } from "react";

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
  /** External link (opens in new tab) */
  external?: boolean;
}

export function Link({ children, external, className = "", ...props }: LinkProps) {
  const externalProps = external ? { target: "_blank", rel: "noopener noreferrer" } : {};

  return (
    <a
      className={`text-purple-600 hover:text-purple-700 underline underline-offset-2 decoration-purple-300 hover:decoration-purple-500 dark:text-purple-400 dark:hover:text-purple-300 dark:decoration-purple-600 dark:hover:decoration-purple-400 transition-colors ${className}`}
      {...externalProps}
      {...props}
    >
      {children}
      {external && (
        <svg
          className="inline-block w-3.5 h-3.5 ml-0.5 -mt-0.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      )}
    </a>
  );
}
