import { useEffect, useRef } from "react";

/**
 * Requests notification permission from the OS on first render.
 *
 * On macOS, this triggers the system dialog asking the user to allow
 * notifications for Orkestra. Should be called once the app is ready
 * (not during splash screen) so the user sees a contextual request.
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

    // Notification plugin is Tauri-only; skip in PWA context.
    if (typeof window === "undefined" || !("__TAURI__" in window)) return;

    requestNotificationPermission();
  }, []);
}

async function requestNotificationPermission() {
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
