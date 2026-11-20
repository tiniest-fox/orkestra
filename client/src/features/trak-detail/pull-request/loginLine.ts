/**
 * What the pull request panel says about its GitHub login: one terse sentence naming the
 * browser, a glyph per cause, amber only for the two failures, and one action on each of those.
 * A successful copy says nothing.
 */

import { Info, KeyRound, LoaderCircle, LogIn, UserX, type LucideIcon } from "lucide-react"
import type { PageLogin } from "../../../api/types"

export interface LoginLine {
  readonly icon: LucideIcon
  /** The glyph turns: something is under way in the browser. */
  readonly spin: boolean
  /** Amber: a copy failed, and the person can do something about it. */
  readonly failure: boolean
  readonly text: string
  /** `copy` runs the copy again; `sign-in` opens GitHub's sign-in in the browser. */
  readonly action: { readonly label: string; readonly does: "copy" | "sign-in" } | undefined
  /** Only the not-Chromium note can be closed: nothing about it changes until the browser does. */
  readonly closable: boolean
}

const line = (
  icon: LucideIcon,
  text: string,
  more: Partial<Omit<LoginLine, "icon" | "text">> = {},
): LoginLine => ({
  icon,
  text,
  spin: false,
  failure: false,
  action: undefined,
  closable: false,
  ...more,
})

export const loginLine = ({ state, browser }: PageLogin): LoginLine | undefined => {
  switch (state) {
    case "copied":
      return undefined
    case "signed-out":
      return line(LogIn, `Sign in to GitHub in ${browser} — this panel uses that login.`)
    case "waiting":
      return line(LoaderCircle, `Finish signing in in ${browser}, then come back.`, { spin: true })
    case "keychain":
      return line(KeyRound, `macOS didn’t let Orkestra read ${browser}’s login.`, {
        failure: true,
        action: { label: "Try again", does: "copy" },
      })
    case "browser-out":
      return line(UserX, `${browser} isn’t signed in to GitHub.`, {
        failure: true,
        action: { label: `Sign in in ${browser}`, does: "sign-in" },
      })
    case "not-chromium":
      return line(Info, `${browser} can’t share its GitHub login — sign in below.`, {
        closable: true,
      })
  }
}
