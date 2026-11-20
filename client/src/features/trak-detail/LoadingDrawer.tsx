/**
 * The frame before the first poll of `/traks/:id` lands — right after a 202, or any
 * other cold open: a row clicked in the list, a bookmark, a reload. `useTrakDetail` has
 * no `initialData`, so this branch is the first frame of every visit, not only the one
 * after starting a trak.
 *
 * Split out of `TrakDetailPage` because the page was over the hundred-line limit, and
 * because this is a view like `DrawerPane` — a fixed thing to draw, not a decision.
 *
 * **The header holds its line rather than stating one.** Neither `description` nor the
 * trak's state is known yet, and a trak reopened cold may be running or done — so the
 * title is a plain placeholder bar, not the words `New Trak`, and there is no `Not
 * started` chip claiming a state nobody has read. It matches `Skeleton`'s `opacity-60`
 * and pulse rather than rendering through it: `Skeleton` draws a *group* of ghosts at a
 * region's own proportions, and this is one bar inside a header, not a region.
 *
 * **One state announcement, not three.** `EmptyState`'s own `role="status"` is the
 * element that says *Loading…*; the heading's `sr-only` text names the thing rather than
 * repeating the state, so a reader is not told twice.
 *
 * **The navigator is the real `StepBar`, `disabled`.** It draws the segments this trak
 * will have once its map lands, so nothing moves between the two frames — which also means
 * every control in it answers to the same name as the loaded page's. **A test that waits
 * for *Previous step* or *Map* to appear catches this frame rather than the real bar**:
 * wait for the loaded chat field first, whose `id` and `label` are this file's own on
 * purpose, so a query for *that* field can only ever resolve once the real one has
 * mounted.
 */

import type { ReactNode } from "react"
import ChatBar from "../../components/ChatBar"
import Drawer from "../../components/Drawer"
import EmptyState from "../../components/EmptyState"
import Rail from "../../components/Rail"
import ScreenHeader from "../../components/ScreenHeader"
import StepBar from "../../components/StepBar"
import type { Chat } from "./chat-bar/useSendChat"

const LoadingDrawer = ({
  chat,
  phone = false,
}: {
  readonly chat: Chat
  /** The loaded page's phone frame, held from the first one: back on the left instead
   *  of Close, no navigator and no rail — so nothing moves when the trak arrives. */
  readonly phone?: boolean
}): ReactNode => (
  <Drawer label="Trak">
    <ScreenHeader
      title={
        <>
          <span className="sr-only">Trak</span>
          <span
            aria-hidden
            className="inline-block h-3.5 w-32 animate-pulse rounded-control bg-surface-2 opacity-60"
          />
        </>
      }
      meta={["—"]}
      phone={phone}
    />

    {!phone && <StepBar level="step" caption="Loading…" disabled />}

    {/* The rail's box with nothing in it, for the reason the bar above is the real one
        `disabled`: it holds the 48px the marks will take, so the pane does not slide
        sideways the moment the first poll lands. The phone has no rail to hold. */}
    <div className="flex min-h-0 flex-1">
      {!phone && <Rail />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
          <EmptyState shape="blocks" loading />
        </div>
        <ChatBar
          id="trak-chat-loading"
          label="Loading the trak…"
          value={chat.draft}
          onChange={chat.write}
          onSend={chat.send}
          placeholder="Loading…"
          busy={chat.isPending}
          disabled
          said={chat.said}
          sendLabel="Send"
        />
      </div>
    </div>
  </Drawer>
)

export default LoadingDrawer
