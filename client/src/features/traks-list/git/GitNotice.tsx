/**
 * A problem a press earned, said in full with its way through beside it: the title in the
 * problem's tone, the sentence, the files, the one press that fixes it where there is one,
 * and a dismiss. The strip
 * floats it over the bar's right end; the phone's dock draws it `tap`, as a row above the
 * band.
 *
 * **The fix press is drawn here rather than as a `Button`**, because the round settled it
 * in the problem's tone and no variant carries one. It is a quiet button's plate and edge
 * with the tone's ink.
 *
 * **Neither press spends.** The stash press is `git` against the project checkout, and
 * *Resolve in a Trak* opens the New Trak page with the request written — the person
 * starts that trak there.
 */

import type { ReactNode } from "react"
import { Archive, Bot, TriangleAlert, X } from "lucide-react"
import { toneFill, toneInk } from "../../../format/tone"
import type { GitFix, GitProblem } from "./gitView"

const FIX_GLYPH = { Stash: Archive, Resolve: Bot } as const

const GitNotice = ({
  problem,
  idle,
  tap,
  fix,
  dismiss,
}: {
  readonly problem: GitProblem
  /** Nothing is running, so the fix may be pressed. */
  readonly idle: boolean
  /** The phone's row: presses at the 44px floor. */
  readonly tap: boolean
  readonly fix: (fix: GitFix) => void
  readonly dismiss: () => void
}): ReactNode => {
  const way = problem.fix
  const Glyph = way === undefined ? undefined : FIX_GLYPH[way._tag]
  return (
    <div role="alert" className="flex flex-col gap-2">
      <div className={`flex items-start gap-2 ${toneInk[problem.tone]}`}>
        <TriangleAlert size={13} aria-hidden className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{problem.title}</div>
          <div className="mt-0.5 text-sm break-words text-fg-muted">{problem.body}</div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className={`-mt-1 -mr-1 flex shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-hover-bare ${tap ? "size-11" : "size-6"}`}
        >
          <X size={13} aria-hidden />
        </button>
      </div>
      {problem.files.length > 0 && (
        <ul
          className={`max-h-40 space-y-0.5 overflow-y-auto rounded-control px-2 py-1.5 font-mono text-2xs text-fg ${toneFill[problem.tone]}`}
        >
          {problem.files.map((file) => (
            <li key={file} className="truncate">
              {file}
            </li>
          ))}
        </ul>
      )}
      {way !== undefined && Glyph !== undefined && (
        <span className="flex">
          <button
            type="button"
            disabled={!idle}
            onClick={() => {
              fix(way)
            }}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-control border border-border bg-surface font-medium whitespace-nowrap transition-colors hover:border-accent/60 disabled:cursor-not-allowed disabled:opacity-45 ${
              tap ? "h-11 px-4 text-base" : "h-7 px-2.5 text-sm"
            } ${toneInk[problem.tone]}`}
          >
            <Glyph size={tap ? 16 : 13} aria-hidden />
            {way.label}
          </button>
        </span>
      )}
    </div>
  )
}

export default GitNotice
