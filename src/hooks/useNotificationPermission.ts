// Hook for notification permission state and user-initiated opt-in.
// Browser/PWA path: exposes permission state + requestPermission() action — no auto-request.
// Tauri path: auto-requests on mount (native OS dialogs are not flagged as abusive).

import { useEffect, useRef, useState } from "react";

export function useNotificationPermission(): {
  permission: NotificationPermission | "unsupported";
  requestPermission: () => void;
} {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() => {
    if (!("Notification" in window) || !window.Notification) return "unsupported";
    return Notification.permission;
  });

  // Tauri path: auto-request on mount (native dialogs are fine)
  const tauriRequested = useRef(false);
  useEffect(() => {
    if (!import.meta.env.TAURI_ENV_PLATFORM) return;
    if (tauriRequested.current) return;
    tauriRequested.current = true;
    requestTauriPermission();
  }, []);

  const requestPermission = () => {
    if (import.meta.env.TAURI_ENV_PLATFORM) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    Notification.requestPermission()
      .then((result) => {
        setPermission(result);
        console.log(`[notifications] Permission ${result}`);
      })
      .catch((err) => {
        console.error("[notifications] Failed to request permission:", err);
      });
  };

  return { permission, requestPermission };
}

async function requestTauriPermission() {
  try {
    const { isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification"
    );
    const granted = await isPermissionGranted();
    if (granted) {
      console.log("[notifications] Permission already granted");
      return;
    }

    console.log("[notifications] Requesting permission...");
    const permission = await requestPermission();
    if (permission === "granted") {
      console.log("[notifications] Permission granted");
    } else {
      console.log(
        `[notifications] Permission not granted: ${permission}. ` +
          "Enable in System Settings > Notifications to receive task alerts.",
      );
    }
  } catch (err) {
    console.error("[notifications] Failed to request permission:", err);
  }
}
