// Subtle reconnecting indicator shown when WebSocket is disconnected but UI stays mounted.

import { AnimatePresence, motion } from "framer-motion";
import { useConnectionState } from "../transport";

export function ReconnectingBanner() {
  const connectionState = useConnectionState();
  const isDisconnected = connectionState !== "connected";

  return (
    <AnimatePresence>
      {isDisconnected && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}
          className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center py-1.5 bg-surface-2/90 backdrop-blur-sm border-b border-border"
        >
          <div className="flex items-center gap-2 text-forge-mono-sm text-text-secondary">
            <div className="h-1.5 w-1.5 rounded-full bg-status-warning animate-pulse" />
            <span>Reconnecting…</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
