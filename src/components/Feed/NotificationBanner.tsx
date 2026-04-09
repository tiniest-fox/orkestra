// Mobile notification banner for opt-in to browser push notifications.

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useState } from "react";
import { useNotificationPermission } from "../../hooks/useNotificationPermission";
import { Button } from "../ui/Button";

export function NotificationBanner() {
  const { permission, requestPermission } = useNotificationPermission();
  const [dismissed, setDismissed] = useState(false);

  if (import.meta.env.TAURI_ENV_PLATFORM) return null;

  return (
    <AnimatePresence>
      {permission === "default" && !dismissed && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}
          className="flex items-center justify-between gap-2 px-4 py-2 bg-surface-2/90 backdrop-blur-sm border-b border-border"
        >
          <span className="text-forge-mono-sm text-text-secondary flex-1">
            Enable notifications to get alerts when reviews are ready
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="secondary" size="sm" onClick={() => requestPermission()}>
              Enable
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss notification banner"
            >
              <X size={14} />
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
