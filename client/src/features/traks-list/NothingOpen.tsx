import type { ReactNode } from "react"
import { Archive } from "lucide-react"
import Button from "../../components/Button"
import EmptyState from "../../components/EmptyState"

/**
 * What the list says when everything on it is put away: `EmptyState`, drawn where the
 * sections would be, above the archived header.
 *
 * The shell rather than a bare sentence, so this reads as the same kind of thing as the
 * page's other three empty states rather than a fourth appearance — the same graphic,
 * the same measure, and the one press that puts something live here in its action slot.
 *
 * `TrakSections` decides when it is drawn — no section filed, no hold standing — and
 * this component decides nothing: a lid a person shut, or the forge's hold, are facts
 * it never sees.
 *
 * The button is a link to the same place the app bar's goes and spends nothing by
 * itself — the form it opens is where a trak is started.
 */
const NothingOpen = (): ReactNode => (
  <EmptyState
    icon={Archive}
    title="Nothing in hand"
    action={
      <Button to="/traks/new" size="sm">
        New Trak
      </Button>
    }
  >
    Everything here is put away — the archive below counts them. A new trak is what would put
    something live on this page.
  </EmptyState>
)

export default NothingOpen
