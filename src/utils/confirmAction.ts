// Async-safe confirmation dialog — uses Tauri's dialog plugin when available,
// falls back to window.confirm() in browser/PWA contexts.

export async function confirmAction(message: string): Promise<boolean> {
  if (import.meta.env.TAURI_ENV_PLATFORM) {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    return confirm(message, { title: "Orkestra", kind: "warning" });
  }
  return window.confirm(message);
}
