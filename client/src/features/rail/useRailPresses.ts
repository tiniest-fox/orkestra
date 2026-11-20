/**
 * The rail page's presses that differ between the shell and a host: selecting a project,
 * which closes the host's settings first; and a tile's menu, the shell's native one or the
 * page's own.
 */

import type { HostPresses } from "../../slots"
import type { RailPresses } from "./useRail"

export const useRailPresses = (host: HostPresses | undefined, presses: RailPresses) => {
  const select = (path: string): void => {
    host?.closeSettings()
    presses.select(path)
  }
  return {
    select,
    onMenu:
      host === undefined
        ? presses.menu
        : (path: string, x: number, y: number) => host.openMenu({ path, x, y }),
  }
}
