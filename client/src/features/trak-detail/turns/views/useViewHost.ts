/**
 * One view's frame, hosted: its messages answered, its tool calls sent through the
 * engine, its height taken from what it reports.
 *
 * `viewHost.ts` decides what each message earns; this does it. A hook rather than part
 * of the component because it listens on `window` — a frame's messages arrive there,
 * and only `event.source` says which frame sent one.
 *
 * **Every message is checked against this frame's own window and no other.** The
 * frame's origin is opaque, so the origin says nothing; the source is the whole of who
 * is speaking. Replies are posted to `*` for the same reason: there is no origin to name.
 * The window is the same object whatever document the frame holds, so the frame's loads
 * are counted too, and a frame that has loaded a second document is answered nothing.
 *
 * **A call from the view is sent whether or not a person pressed anything.** A view may
 * call a tool as it loads, and with no turn running that starts a CLI — which spends
 * nothing, and is ended by the engine once it has been idle.
 *
 * `starting` is the first call after a turn, while the CLI it needs comes up; `failed`
 * is that CLI not coming up, in a sentence, until the next call is sent.
 */

import type { RefObject } from "react"
import { useEffect, useRef, useState } from "react"
import { RefusedError } from "../../../../api/http"
import type { ViewDto, ViewResultDto } from "../../../../api/types"
import { refusalSaid } from "../../../../format/refusal"
import { type HostAct, hostActs, rpcError, rpcResult, toolResult } from "./viewHost"

export interface ViewHosted {
  /** The height the view last reported, in CSS pixels; `undefined` before it has. */
  readonly height: number | undefined
  readonly starting: boolean
  readonly failed: string | undefined
  /**
   * For the frame's own `onLoad`. The first load is the document the engine served;
   * any later one is the frame holding something else, and the host answers nothing
   * from then on — see `loaded` below.
   */
  readonly loaded: () => void
}

const theme = (): "light" | "dark" =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"

/** What a refused or failed call is told, as the sentence a person would be shown. */
const said = (error: unknown): string =>
  error instanceof RefusedError ? refusalSaid(error.refusal) : "The tool could not be called."

export const useViewHost = (
  frame: RefObject<HTMLIFrameElement | null>,
  view: ViewDto,
  press: (tool: string, args: unknown) => Promise<ViewResultDto>,
  running: boolean,
): ViewHosted => {
  const [height, setHeight] = useState<number | undefined>(undefined)
  const [starting, setStarting] = useState(false)
  const [failed, setFailed] = useState<string | undefined>(undefined)
  // Whether a CLI started for this view's calls is believed to be up. A turn starting
  // ends that CLI, so the belief ends with it.
  const attended = useRef(false)
  // How many documents the frame has loaded, counted against the HTML it was given: a
  // view fetched again is a first load again.
  //
  // **A second load of one document's frame ends the conversation for good.** The
  // served document refuses every address its frame could be sent to, so this is not
  // how a view is kept in; it is what a frame that got out anyway is met with. Such a
  // document speaks through the window the view spoke through, so `event.source`
  // cannot tell them apart, and it was served by nobody here.
  const loads = useRef({ html: view.html, count: 0 })
  const loaded = (): void => {
    loads.current =
      loads.current.html === view.html
        ? { html: view.html, count: loads.current.count + 1 }
        : { html: view.html, count: 1 }
  }

  useEffect(() => {
    if (running) attended.current = false
    const post = (message: unknown): void => {
      frame.current?.contentWindow?.postMessage(message, "*")
    }
    const call = async (act: Extract<HostAct, { kind: "call" }>): Promise<void> => {
      if (!view.answers) {
        post(rpcError(act.id, "this trak's checkout is removed"))
        return
      }
      setFailed(undefined)
      if (!running && !attended.current) setStarting(true)
      try {
        const result = await press(act.tool, act.args)
        if (!running) attended.current = true
        post(rpcResult(act.id, toolResult(result)))
      } catch (error) {
        if (error instanceof RefusedError && error.refusal._tag === "CliNotStarted") {
          setFailed(said(error))
        }
        post(rpcError(act.id, said(error)))
      } finally {
        setStarting(false)
      }
    }
    const heard = (event: MessageEvent): void => {
      const from = frame.current?.contentWindow
      if (from === undefined || from === null || event.source !== from) return
      if (loads.current.html === view.html && loads.current.count > 1) return
      for (const act of hostActs(event.data, view, theme())) {
        if (act.kind === "post") post(act.message)
        if (act.kind === "size") setHeight(act.height)
        if (act.kind === "call") void call(act)
        if (act.kind === "open") {
          window.open(act.url, "_blank", "noopener,noreferrer")
          post(rpcResult(act.id, {}))
        }
      }
    }
    window.addEventListener("message", heard)
    return () => {
      window.removeEventListener("message", heard)
    }
  }, [frame, view, press, running])

  return { height, starting, failed, loaded }
}
