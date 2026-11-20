/**
 * A fenced block whose label names a language this build has a grammar for, coloured.
 *
 * **No plate of its own: it stands in a `Figure`**, whose header band names the language,
 * the same frame an unlabelled fence draws in — so a `ts` fence and a bare one beside it
 * read as the same object, one of them lit. While the grammar loads, where the chunk never
 * arrives, and for a language nothing here can colour, the source draws as written:
 * `useTokens` answers `undefined` for all three and the block does not care which.
 *
 * **Colour is an inline value, not a class**, for the reason `useTokens` gives: a syntax
 * palette is the theme's data, not a name the design system owns.
 */

import type { ReactNode } from "react"
import type { Grammar } from "../format/grammar"
import { useTokens } from "../hooks/useTokens"
import { CODE } from "./PseudoCode"

const CodeBlock = ({
  lang,
  source,
}: {
  readonly lang: Grammar
  readonly source: string
}): ReactNode => {
  const lines = useTokens(lang, [source])?.[0]

  return (
    <pre className={`m-0 ${CODE}`}>
      {lines === undefined
        ? source
        : lines.map((line, i) => (
            // A line has no identity of its own and the block is rebuilt whole whenever
            // the source changes — the one shape React's own guidance allows this for.
            // oxlint-disable-next-line react/no-array-index-key
            <span key={i}>
              {line.map((token, j) => (
                // oxlint-disable-next-line react/no-array-index-key
                <span key={j} style={{ color: token.color }}>
                  {token.text}
                </span>
              ))}
              {i < lines.length - 1 && "\n"}
            </span>
          ))}
    </pre>
  )
}

export default CodeBlock
