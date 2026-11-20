/**
 * Where the pull request view's GitHub login stands, as the shell last reported it, and
 * the two things the panel can ask of it. Nothing is reported outside Orkestra.app.
 *
 * **A closed not-Chromium note stays closed until the window does**, so it is kept in
 * `sessionStorage` rather than in state: switching tabs unmounts the panel, and the note
 * would come back on every return. `window.sessionStorage` for `useRunMode`'s reason.
 *
 * Kind `hook`: it reaches the shell's bridge and the window's storage.
 */

import { useEffect, useState } from "react"
import { pageBridge, watchLogin } from "../../../api/page"
import { storageKey } from "../../../base"
import type { PageLogin } from "../../../api/types"
import { type LoginLine, loginLine } from "./loginLine"

const CLOSED_KEY = "orkestra:pull-request-login-note-closed"

export interface PullRequestLogin {
  readonly line: LoginLine | undefined
  readonly act: (does: "copy" | "sign-in") => void
  readonly close: () => void
}

export const usePullRequestLogin = (): PullRequestLogin => {
  const [login, setLogin] = useState<PageLogin | undefined>(undefined)
  const key = storageKey(CLOSED_KEY, document.baseURI)
  const [closed, setClosed] = useState(() => window.sessionStorage.getItem(key) !== null)
  useEffect(() => watchLogin(setLogin), [])
  const line = login === undefined ? undefined : loginLine(login)
  return {
    line: line?.closable === true && closed ? undefined : line,
    act: (does) => {
      if (does === "copy") pageBridge()?.copyLogin()
      else pageBridge()?.signIn()
    },
    close: () => {
      setClosed(true)
      window.sessionStorage.setItem(key, "closed")
    },
  }
}
