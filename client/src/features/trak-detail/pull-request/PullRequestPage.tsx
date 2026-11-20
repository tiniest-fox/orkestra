/**
 * The trak's pull request in the side panel: an address bar, and GitHub's own page under it,
 * drawn by the shell's native view. The bar is a lock, the address, then Reload, Open in a
 * browser, Full view and Close, and nothing else heads the page: the tab carries the state, and
 * GitHub's page the title.
 *
 * **Only inside Orkestra.app.** GitHub refuses to be framed, so there is no `<iframe>` to
 * fall back on as a process's page has, and the panel offers no tab where the bridge is
 * missing. The view is what is seen, and `useNativePage` keeps it on the box. The box holds a
 * loading state, which is seen only while the shell holds the view hidden — for a trak's
 * page, until it has loaded, so another trak's pull request is never drawn in its place.
 *
 * The address is the one the forge reported. Navigating inside GitHub's page does not move
 * it: the shell keeps the view on `https://github.com`, and nothing reports where it went.
 *
 * The view carries the default browser's GitHub login, copied by the shell, and a line
 * under the bar says when it could not — `PullRequestLogin`.
 */

import type { ReactNode } from "react"
import { Lock, Maximize2, Minimize2, RotateCw, X } from "lucide-react"
import Button from "../../../components/Button"
import EmptyState from "../../../components/EmptyState"
import { useNativePage } from "../processes/useNativePage"
import ForgeLink from "./reviews/ForgeLink"
import PullRequestLogin from "./PullRequestLogin"
import { usePullRequestLogin } from "./usePullRequestLogin"
import type { Heading } from "./pullRequest"

const PullRequestPage = ({
  trak,
  pull,
  reloads,
  onReload,
  full,
  onFull,
  onClose,
}: {
  /** The trak it belongs to — with the address, what names the page to the shell. */
  readonly trak: string
  readonly pull: Heading
  readonly reloads: number
  readonly onReload: () => void
  readonly full: boolean
  /** The desk's full-view toggle; `undefined` in a window narrow enough to be a phone's. */
  readonly onFull: (() => void) | undefined
  /** The desk's way to shut the panel; `undefined` where Back does it. */
  readonly onClose: (() => void) | undefined
}): ReactNode => {
  // Before the view: the shell copies as the view is first shown, and reports it once.
  const login = usePullRequestLogin()
  const native = useNativePage(JSON.stringify([trak, "pull-request", pull.url]), pull.url, reloads)
  const name = `Pull request #${String(pull.number)}`
  return (
    <>
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <Lock size={12} aria-hidden className="shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-fg-muted">
          {pull.url.replace(/^https:\/\//, "")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={RotateCw}
          aria-label="Reload the page"
          onClick={onReload}
        />
        <span className="flex text-fg-muted">
          <ForgeLink url={pull.url} label="Open in a browser" />
        </span>
        {onFull !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            icon={full ? Minimize2 : Maximize2}
            aria-label={full ? "Back to side by side" : "Full view"}
            onClick={onFull}
          />
        )}
        {onClose !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            aria-label="Close the side panel"
            onClick={onClose}
          />
        )}
      </header>
      {login.line !== undefined && (
        <PullRequestLogin line={login.line} onAct={login.act} onClose={login.close} />
      )}
      <div
        ref={native}
        role="region"
        aria-label={`${name}'s page`}
        className="flex min-h-0 w-full flex-1 flex-col"
      >
        <EmptyState loading shape="blocks" />
      </div>
    </>
  )
}

export default PullRequestPage
