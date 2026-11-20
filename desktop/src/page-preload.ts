// The bridge a project window reaches the native page view through — the one script in
// that window with Electron's `require` in scope.
//
// **Narrow on purpose.** A project window shows the engine's own pages over loopback, and
// those pages render agent-written prose, so whatever this puts on `window` is reachable
// from everything the engine serves. It is one-way messages about the native views and
// nothing else: no `invoke`, no path, no `ipcRenderer`. The one listener hears the pull
// request view's login state — a word and a browser's name, never a cookie. The main process
// checks every argument again, since a page can call these with anything.
//
// CommonJS for `preload.ts`'s reason; `build.ts` writes it as `dist/page-preload.cjs`.

import { contextBridge, ipcRenderer } from "electron"
import type { PageBridge } from "@orkestra/shared/page"
import { PAGE_BRIDGE_NAME, PAGE_CHANNELS } from "./bridge.js"

const bridge: PageBridge = {
  show: (run, url, bounds) => {
    ipcRenderer.send(PAGE_CHANNELS.show, run, url, bounds)
  },
  hide: () => {
    ipcRenderer.send(PAGE_CHANNELS.hide)
  },
  reload: () => {
    ipcRenderer.send(PAGE_CHANNELS.reload)
  },
  onLogin: (listener) => {
    const relay = (_event: unknown, login: unknown): void => listener(login)
    ipcRenderer.on(PAGE_CHANNELS.login, relay)
    return () => {
      ipcRenderer.off(PAGE_CHANNELS.login, relay)
    }
  },
  copyLogin: () => {
    ipcRenderer.send(PAGE_CHANNELS.copyLogin)
  },
  signIn: () => {
    ipcRenderer.send(PAGE_CHANNELS.signIn)
  },
}

contextBridge.exposeInMainWorld(PAGE_BRIDGE_NAME, bridge)
