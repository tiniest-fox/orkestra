// The launch window's bridge, built once for the two preloads that put it on a page:
// `preload.ts` on the launch window, and `rail-preload.ts` on a window's rail, whose empty
// pane lists the same recent projects and opens the same picker.
//
// Everything the page can do is a named function here; the page never sees
// `ipcRenderer`. What comes back from an `invoke` is `unknown` by the contract, and the
// page's seam decodes it.

import { ipcRenderer } from "electron"
import type { LauncherBridge } from "@orkestra/shared/launcher"
import { CHANNELS } from "./bridge.js"

export const launcherBridge: LauncherBridge = {
  recents: async () => {
    const rows: unknown = await ipcRenderer.invoke(CHANNELS.recents)
    return rows
  },
  onRecents: (listener) => {
    const relay = (_event: unknown, rows: unknown): void => listener(rows)
    ipcRenderer.on(CHANNELS.recentsChanged, relay)
    return () => {
      ipcRenderer.off(CHANNELS.recentsChanged, relay)
    }
  },
  open: async (path) => {
    await ipcRenderer.invoke(CHANNELS.open, path)
  },
  pick: async () => {
    await ipcRenderer.invoke(CHANNELS.pick)
  },
}
