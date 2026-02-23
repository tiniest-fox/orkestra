//! Safely resolve and call a Tauri unlisten function.
//!
//! Tauri's `_unlisten` can throw when React StrictMode (or fast cleanup) calls
//! `unlisten()` before the injected `listen_js_script` has added the eventId to
//! the JS-side listener registry. The IPC resolves before the eval completes,
//! so `listeners[eventId]` is undefined and `.handlerId` throws.
//!
//! This wrapper catches that race and avoids unhandled promise rejections.

type UnlistenFn = () => void;

export function safeUnlisten(promise: Promise<UnlistenFn>): void {
  promise.then((unlisten) => unlisten()).catch(() => {});
}
