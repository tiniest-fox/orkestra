// The bridge the launch window reaches the main process through — the one script in that
// window with Electron's `require` in scope.
//
// Sandboxed, so this is CommonJS: Electron loads a preload from a path, and an ESM output
// fails at window creation, which reads as the page being broken rather than the bridge
// being unloadable. `build.ts` writes it as `dist/preload.cjs` for that reason.

import { contextBridge } from "electron"
import { BRIDGE_NAME } from "./bridge.js"
import { launcherBridge } from "./launcher-bridge.js"

contextBridge.exposeInMainWorld(BRIDGE_NAME, launcherBridge)
