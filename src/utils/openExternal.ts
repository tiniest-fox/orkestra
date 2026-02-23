//! Opens a URL in the system browser. Uses a programmatic anchor click so that
//! Tauri's webview handles it as a target="_blank" navigation (window.open does not work).

export function openExternal(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
