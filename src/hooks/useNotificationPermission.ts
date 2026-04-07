import { useEffect, useRef } from "react";

/**
 * Requests notification permission from the OS on first render.
 *
 * On macOS, this triggers the system dialog asking the user to allow
 * notifications for Orkestra. Should be called once the app is ready
 * (not during splash screen) so the user sees a contextual request.
 *
 * In PWA context (when TAURI_ENV_PLATFORM is not set), requests Web
 * Notification API permission instead.
 *
 * Note: On desktop platforms, the current `tauri-plugin-notification` v2
 * Rust backend always returns "granted" — the real permission check happens
 * through the JS plugin's bridge to the native notification API. This hook
 * ensures the correct permission flow regardless of backend limitations.
 */
export function useNotificationPermission() {
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;

    if (import.meta.env.TAURI_ENV_PLATFORM) {
      requestTauriPermission();
    } else {
      requestBrowserPermission();
    }
  }, []);
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

async function requestBrowserPermission() {
  if (!("Notification" in window)) {
    console.log("[notifications] Browser notifications not supported");
    return;
  }
  if (Notification.permission === "granted") {
    console.log("[notifications] Permission already granted");
    return;
  }
  if (Notification.permission === "denied") {
    console.log("[notifications] Permission denied by user");
    return;
  }
  try {
    const result = await Notification.requestPermission();
    console.log(`[notifications] Permission ${result}`);
  } catch (err) {
    console.error("[notifications] Failed to request permission:", err);
  }
}
