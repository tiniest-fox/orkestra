// The bridges a window's own page — the project rail — reaches the main process through.
//
// **Two, and the page they are on is the shell's own.** A window loads `rail.html` off
// disk, as the launch window loads its page; the engine's pages, which render
// agent-written prose, are drawn in views of their own with `page-preload.ts` and never
// see either of these. `window.orkestraRail` is the rail — its state and its presses —
// and `window.orkestra` is the launch window's own bridge, here for the recent projects
// and the folder picker an empty window offers.
//
// CommonJS for `preload.ts`'s reason; `build.ts` writes it as `dist/rail-preload.cjs`.

import { contextBridge, ipcRenderer } from "electron"
import type { RailBridge } from "@orkestra/shared/rail"
import { BRIDGE_NAME, RAIL_BRIDGE_NAME, RAIL_CHANNELS } from "./bridge.js"
import { launcherBridge } from "./launcher-bridge.js"

const rail: RailBridge = {
  state: async () => {
    const state: unknown = await ipcRenderer.invoke(RAIL_CHANNELS.state)
    return state
  },
  onState: (listener) => {
    const relay = (_event: unknown, state: unknown): void => listener(state)
    ipcRenderer.on(RAIL_CHANNELS.stateChanged, relay)
    return () => {
      ipcRenderer.off(RAIL_CHANNELS.stateChanged, relay)
    }
  },
  select: (path) => {
    ipcRenderer.send(RAIL_CHANNELS.select, path)
  },
  retry: (path) => {
    ipcRenderer.send(RAIL_CHANNELS.retry, path)
  },
  remove: (path) => {
    ipcRenderer.send(RAIL_CHANNELS.remove, path)
  },
  menu: (path) => {
    ipcRenderer.send(RAIL_CHANNELS.menu, path)
  },
  place: (bounds) => {
    ipcRenderer.send(RAIL_CHANNELS.place, bounds)
  },
}

contextBridge.exposeInMainWorld(RAIL_BRIDGE_NAME, rail)
contextBridge.exposeInMainWorld(BRIDGE_NAME, launcherBridge)
