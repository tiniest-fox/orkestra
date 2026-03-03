//! Full-screen loading indicator with a spinner and message.

import type { ReactNode } from "react";

interface LoadingScreenProps {
  message: string;
  children?: ReactNode;
}

export function LoadingScreen({ message, children }: LoadingScreenProps) {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-secondary text-sm">{message}</p>
        {children}
      </div>
    </div>
  );
}
