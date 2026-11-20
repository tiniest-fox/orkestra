/**
 * The two presses the launch window has: a row, and the button for a folder that is not
 * on the list. Neither spends — an engine starts, no `claude` does — and both are held
 * to the acting-hook contract anyway: disabled while either is in flight, and a callback
 * that refuses when disabled, because two presses in a row would boot two engines.
 *
 * Nothing is invalidated on success. The shell pushes the list's next state over the
 * bridge and `useRecents` writes it in, and on success this window is closed by the shell
 * before the answer arrives.
 */

import { useMutation } from "@tanstack/react-query"
import { openProject, pickProject } from "../../api/launcher"
import { hostTransport } from "../../slots"

export interface OpenProject {
  /** The path being opened, while one is. What a row reads to draw itself busy. */
  readonly opening: string | undefined
  /** Whether the picker is up. */
  readonly picking: boolean
  readonly disabled: boolean
  readonly open: (path: string) => void
  readonly pick: () => void
}

export const useOpenProject = (): OpenProject => {
  const open = useMutation({
    mutationFn: (path: string) => openProject(path, hostTransport),
  })
  const pick = useMutation({ mutationFn: pickProject })
  const disabled = open.isPending || pick.isPending
  return {
    opening: open.isPending ? open.variables : undefined,
    picking: pick.isPending,
    disabled,
    open: (path) => {
      if (disabled) return
      open.mutate(path)
    },
    pick: () => {
      if (disabled) return
      pick.mutate()
    },
  }
}
