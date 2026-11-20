/**
 * The drawer's top band: what this trak is, and the way out — `components/ScreenHeader`
 * filled for a trak.
 *
 * **Not where it stands.** No state phrase is drawn here, and nothing may put one back:
 * every surface under this band says the same fact in more detail — the ending row's
 * caption, the engine-work block, the gate cards, the failure notice — and a chip here
 * was the same words a hand's width above them.
 *
 * **`name` is the plan's title, and the request only until there is one** — the caller
 * chooses between them, because the two differ in what they are for rather than in
 * shape. The request itself is not lost by that: `RequestView`, further down, shows it
 * word for word under a heading that says so.
 *
 * **The one band that is on screen at every altitude**, which is what makes it the right
 * place for a press about the whole trak rather than about a position. Whether a control
 * exists is `controls.ts` reading `state`, and a press that spends belongs to the page that
 * holds the hook. Placement is all this owns: the ending's `⋯` on the title row, and the
 * run-mode picker, the openers and the side panel's opener in the actions row.
 *
 * **The metadata row is the id and the goal the trak belongs to**, and nothing else. The
 * model and effort the step runs on is not here: it sits under the chat box at the head of
 * the spend row, beside the field it governs — `chat-bar/TrakChatBar`. A trak id is three
 * words a person types into `ork resume`, so it keeps its width and the goal's title is
 * what truncates.
 *
 * **Beside the side panel it is the same two rows**: the 440px column takes the title row
 * and the actions row as they are, with no form of its own.
 */

import type { ReactNode } from "react"
import ScreenHeader from "../../components/ScreenHeader"

const TrakHeader = ({
  name,
  id,
  goal,
  menu,
  actions,
  back,
}: {
  readonly name: string
  readonly id: string
  /** The link to the goal that opened this trak, or nothing where none did. */
  readonly goal: ReactNode
  /** The trak's ending `⋯`, or nothing where the state offers none. */
  readonly menu: ReactNode
  /** The actions row, or `undefined` where nothing is drawn in it — so no empty row. */
  readonly actions: ReactNode
  /** Below the breakpoint — `ScreenHeader`'s way out. */
  readonly back: boolean
}): ReactNode => (
  <ScreenHeader
    title={name}
    meta={goal === undefined ? [id] : [id, goal]}
    phone={back}
    menu={menu}
    actions={actions}
  />
)

export default TrakHeader
