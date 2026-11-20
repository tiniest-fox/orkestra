/**
 * A proposed step's instruction at the plan gate: the text, as a press that opens a field
 * in place of it. The field closes when focus leaves, with nothing drawn to say it can be
 * edited.
 *
 * `unzoomed`, because this is the one field a phone opens inside a card it is scrolled
 * into, and a zoom onto it carries the card away.
 */

import type { ReactNode } from "react"
import { useId, useState } from "react"
import Field from "../../../../components/Field"

const InstructionPress = ({
  mark,
  text,
  onChange,
  onClose,
}: {
  readonly mark: string
  readonly text: string
  readonly onChange: (text: string) => void
  /** The field closed, holding what it holds now. */
  readonly onClose: (text: string) => void
}): ReactNode => {
  const [open, setOpen] = useState(false)
  const id = useId()
  return open ? (
    <Field
      id={id}
      label={`Step ${mark} instruction`}
      value={text}
      placeholder="What this step is for"
      autoFocus
      unzoomed
      onChange={onChange}
      onBlur={() => {
        setOpen(false)
        onClose(text)
      }}
    />
  ) : (
    <button
      type="button"
      onClick={() => {
        setOpen(true)
      }}
      className="-mx-1 min-w-0 cursor-text rounded-control px-1 text-left hover:bg-hover-row"
    >
      <span className="whitespace-pre-wrap break-words text-base leading-5 text-fg-muted">
        {text}
      </span>
    </button>
  )
}

export default InstructionPress
