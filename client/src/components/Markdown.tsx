/**
 * Markdown, as elements rather than as the characters an agent typed.
 *
 * **Every string an agent writes is markdown**, and the pane drew all of them as
 * `whitespace-pre-wrap` — which is right about the newlines and wrong about everything
 * else. A three-column table of options reads as a paragraph of pipes, and the emphasis an
 * agent used to separate a heading from its body arrives as asterisks.
 *
 * **No HTML string and no sanitizer.** `react-markdown` builds React elements, so markup
 * in an agent's text is escaped by the renderer rather than parsed and then cleaned up
 * afterwards — the safe default rather than a call nobody may get wrong: the text comes
 * from a model, and the one mistake that matters is treating it as trusted.
 *
 * **One block is exempt, and only that one.** A ```mermaid fence goes to `MermaidBlock`,
 * which injects the SVG `mermaid.render` produced — not the agent's characters, which are
 * its *input*, and which it parses under `securityLevel: "strict"`. That is the whole of
 * the exemption: the trust moved to mermaid's sanitiser, and every other string on this
 * page is still escaped. A second `dangerouslySetInnerHTML` here needs its own such
 * reason, not this one by analogy.
 *
 * **One element makes a request, and it is `img`.** Everything else here is characters
 * this pane already holds; an `<img src>` is an address the agent picked and the browser
 * fetches. So it is drawn only where the src names a file inside that trak's own checkout
 * and a page has said which trak that is — `MarkdownImages` below — and as its alt text in
 * every other case, a remote src included.
 *
 * **A link leaves for a browser tab unless a page takes it.** `MarkdownLinks` below is how
 * the trak screen opens its side panel on a link to one of its own processes or its pull
 * request; only a plain press is offered, so a modifier or a middle press still leaves.
 *
 * **Every block that is not prose is a figure** — a table, a diagram, a code, diff, output
 * or pseudo fence, and the three navigators — and every figure stands in one `Figure`: the
 * same line all round, the same header band and footer. It is drawn wherever markdown is,
 * a message as much as a filed document.
 *
 * **The ink is the caller's.** Nothing below sets a text colour, so a block inherits
 * whichever of `fg` / `fg-muted` / `fg-subtle` it is standing in — the same words are the
 * subject of a message bubble and a supporting note under a question, and a component that
 * fixed the colour would be right in one of those places. What the mappings do set is
 * *structure*: weight, rules, gutters, and the fill on a code span.
 */

import type { Components, ExtraProps } from "react-markdown"
import type { MouseEvent, ReactNode } from "react"
import { createContext, useContext, useRef, useState } from "react"
import Markdown_ from "react-markdown"
import remarkGfm from "remark-gfm"
import { parseChanges } from "../format/changeMap"
import { grammarOf } from "../format/grammar"
import { markedTableOf } from "../format/markedTable"
import { parseOverview } from "../format/overview"
import { parseWalkthrough } from "../format/walkthrough"
import { tableOf } from "../format/markdownTable"
import ArchitectureMap from "./ArchitectureMap"
import ChangeMap from "./ChangeMap"
import CodeBlock from "./CodeBlock"
import DiffBlock from "./DiffBlock"
import Figure from "./Figure"
import Lightbox from "./Lightbox"
import MarkedTable from "./MarkedTable"
import MermaidBlock from "./MermaidBlock"
import PseudoCode, { CODE } from "./PseudoCode"
import Walkthrough from "./Walkthrough"

/** How a path inside a trak's checkout becomes a URL something can serve it from. */
export type ResolveImage = (path: string) => string

/**
 * Which checkout the images in this subtree are drawn out of, or nothing.
 *
 * **Nothing is the default, and it draws every image as its alt text.** Neither call site
 * knows which trak it is showing — `AgentMessage` takes a string and `ArtifactBody` a
 * section — and a piece of a spawn has a checkout of its own, so the answer travels from
 * the page that holds the id rather than through the ten components in between, none of
 * which has any other use for it.
 */
const Images = createContext<ResolveImage | undefined>(undefined)

/** The provider, so a page can say which trak the markdown below it belongs to. */
export const MarkdownImages = ({
  resolve,
  children,
}: {
  readonly resolve: ResolveImage
  readonly children: ReactNode
}): ReactNode => <Images value={resolve}>{children}</Images>

/** The checkout this subtree draws images out of, for a surface that is not markdown. */
export const useMarkdownImages = (): ResolveImage | undefined => useContext(Images)

/**
 * Offered a plain press on a link: `true` where it took it, and the browser does not open.
 * `undefined`, the default, takes none.
 */
export type FollowLink = (href: string) => boolean

/** Which page, if any, takes a press on a link in this subtree — `Images`' shape and reason. */
const Links = createContext<FollowLink | undefined>(undefined)

/** The provider, so a page can take the links in the markdown below it. */
export const MarkdownLinks = ({
  follow,
  children,
}: {
  readonly follow: FollowLink | undefined
  readonly children: ReactNode
}): ReactNode => <Links value={follow}>{children}</Links>

/**
 * Whether the markdown below is a document a person opened to read, rather than an agent's
 * message — `Images`' shape, since the mappings are a module constant. `false`, the
 * default, is the message.
 */
const Document = createContext(false)

/** The provider, so the file drawer can draw a README's headings as a document's. */
export const MarkdownDocument = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <Document value>{children}</Document>
)

/**
 * A heading's class: weight alone in a message, and a step of the scale in a document,
 * where the headings open the parts of a page rather than separating parts of one answer.
 */
const useHeading = (level: 1 | 2 | 3): string => {
  if (!useContext(Document)) return "font-semibold"
  switch (level) {
    case 1:
      return "border-b border-border pb-1 text-lg font-semibold"
    case 2:
      return "pt-1 text-lg font-semibold"
    case 3:
      return "pt-1 text-base font-semibold"
  }
}

const H1 = ({ children }: { readonly children?: ReactNode }): ReactNode => (
  <h1 className={useHeading(1)}>{children}</h1>
)
const H2 = ({ children }: { readonly children?: ReactNode }): ReactNode => (
  <h2 className={useHeading(2)}>{children}</h2>
)
const H3 = ({ children }: { readonly children?: ReactNode }): ReactNode => (
  <h3 className={useHeading(3)}>{children}</h3>
)

/**
 * A link, opening a new tab — unless a page took the press.
 *
 * `target="_blank"` stays on it either way, so it can be copied and modifier-pressed; that
 * is also why the default is prevented only once the page has taken the press, since
 * Orkestra.app's shell opens the browser for any new window that is not stopped here.
 */
const MarkdownLink = ({
  href,
  children,
}: {
  readonly href?: string | undefined
  readonly children?: ReactNode
}): ReactNode => {
  const follow = useContext(Links)
  const press =
    follow === undefined || href === undefined
      ? undefined
      : (event: MouseEvent) => {
          const plain =
            event.button === 0 &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey
          if (plain && follow(href)) event.preventDefault()
        }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={press}
      className="text-accent underline"
    >
      {children}
    </a>
  )
}

/**
 * The path this `src` names inside the checkout, or `undefined` for everything else.
 *
 * **An `<img src>` is an outbound request the agent chose**, which is what makes this the
 * one mapping below with a rule rather than a class list: a remote or `data:` src makes
 * any pane a beacon reporting when a person read the trak, from text a model produced. So
 * the shape that is allowed is stated rather than the shapes that are not subtracted — a
 * bare relative path, with no scheme, no authority, no root and no climb.
 *
 * `?` and `#` go with them because the server reads the whole string as a filename, so a
 * src carrying either is asking for a file nobody would have named. The engine confines
 * again after resolving symlinks; this is what stops the request being made at all.
 */
const insideCheckout = (src: string | undefined): string | undefined => {
  if (src === undefined || src === "") return undefined
  if (/^[a-z][\d+.a-z-]*:/i.test(src) || src.startsWith("//") || src.startsWith("/"))
    return undefined
  if (src.includes("?") || src.includes("#")) return undefined
  return src.split("/").includes("..") ? undefined : src
}

/**
 * An image, where it names a file in the trak's checkout and something is drawing for a
 * trak — and its alt text everywhere else, which includes a file that is no longer there.
 *
 * **A shot dies with the checkout it was taken in**, so a 404 is the ordinary end of one
 * and must read as the words the agent wrote beside it. The browser's own broken-image
 * icon is the failure this whole route exists to remove, and it would be back for every
 * trak that has been closed.
 *
 * **The picture is the press**, and only a picture that drew has one: a src the rule above
 * refused and a file that is gone are both words, and a press on words would be offering to
 * open something there is nothing behind. A shot is written at a width the pane cannot
 * show, so pressing it opens it over the window — `Lightbox`, which is also what a diagram
 * opens into. The button is bare on purpose: no plate and no edge, because the affordance is
 * the picture itself. It carries the cursor and `Button`'s own focus ring, so the system
 * decides nothing twice.
 *
 * No colour is set, for the reason nothing else here sets one: the alt text is prose
 * standing in the ink of whatever it is standing in.
 */
const MarkdownImage = ({
  src,
  alt,
}: {
  readonly src?: string | undefined
  readonly alt?: string | undefined
}): ReactNode => {
  const resolve = useContext(Images)
  // The path that failed rather than a flag: React keeps state at a place in the tree, and
  // a pane redrawn with different text at that place would otherwise show the next image
  // as alt text for a load that never happened. The path and not the URL, because the URL
  // carries a version the page moves whenever the trak logs an event: keyed on it, a shot
  // that had fallen back to its words would remount as an `<img>` and 404 all over again.
  const [failed, setFailed] = useState<string | undefined>(undefined)
  // The path that was opened, for the same reason on both counts: at that place in the tree
  // the next image would otherwise arrive already open, over a press nobody made, and keyed
  // on the URL the open view would shut itself at the trak's next event with nobody pressing.
  const [opened, setOpened] = useState<string | undefined>(undefined)
  const press = useRef<HTMLButtonElement>(null)

  const path = insideCheckout(src)
  const url = resolve === undefined || path === undefined ? undefined : resolve(path)
  // Ahead of the press, so a file that went away while it was open falls back to the words
  // the same as one that was never there — the view goes with the picture it was showing.
  if (url === undefined || path === failed)
    return <span>{alt === undefined || alt === "" ? src : alt}</span>

  // The words the agent wrote beside the picture, where it wrote any. They name the press
  // through its contents and the open view through its label; with none, the button has
  // nothing to be called and says what it does instead.
  const named = alt === undefined || alt === "" ? undefined : alt
  const failing = (): void => {
    setFailed(path)
  }

  return (
    <>
      <button
        ref={press}
        type="button"
        aria-label={named === undefined ? "Open the image" : undefined}
        className="cursor-zoom-in rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={() => {
          setOpened(path)
        }}
      >
        <img src={url} alt={alt ?? ""} className="max-w-full rounded-control" onError={failing} />
      </button>
      {opened === path && (
        <Lightbox
          label={named ?? "image"}
          onClose={() => {
            setOpened(undefined)
            // Back onto the picture that was pressed. Here rather than in `Lightbox`,
            // which does not own this node — and a handler rather than an effect, because
            // the button never unmounted.
            press.current?.focus()
          }}
        >
          {/* No width and no height, so it draws at its own pixels and no larger — a proof
              shot of one control blown up to fill a screen is a blur. `max-h-full` is what
              keeps a long one whole instead of running off the bottom. */}
          <img
            src={url}
            alt={alt ?? ""}
            className="max-h-full max-w-full rounded-control"
            onError={failing}
          />
        </Lightbox>
      )}
    </>
  )
}

/** A fenced block as it was written: its label, what follows the label, and its text. */
interface Fence {
  /** `""` for a block with no label. */
  readonly lang: string
  /** The rest of the info string — the language of a ```diff ts fence. */
  readonly meta: string
  readonly source: string
}

/**
 * A fenced block's label, meta and source, or `undefined` where the block is not one.
 *
 * Read off the hast node rather than the rendered children: the info string lives in
 * `code`'s class list and its data, which React children have already flattened away by the
 * time a component sees them.
 */
const fenceOf = (node: ExtraProps["node"]): Fence | undefined => {
  const code = node?.children[0]
  if (code?.type !== "element" || code.tagName !== "code") return undefined
  const classes = code.properties["className"]
  const lang = (Array.isArray(classes) ? classes : [])
    .map(String)
    .find((c) => c.startsWith("language-"))
    ?.slice("language-".length)
  const text = code.children[0]
  if (text?.type !== "text") return undefined
  const data = code.data
  const meta =
    data !== undefined && "meta" in data && typeof data.meta === "string" ? data.meta : ""
  // hast keeps the newline that closes the last line, and a block that drew it would end
  // in an empty row.
  return { lang: lang ?? "", meta: meta.trim(), source: text.value.replace(/\n$/, "") }
}

/**
 * The figure a fence draws as, or `undefined` for none of the named ones.
 *
 * A figure whose text does not parse falls through, and so draws as the source the agent
 * wrote — which is also what the next agent reads, so nothing is lost.
 */
const figureOf = (fence: Fence): ReactNode => {
  const { lang, meta, source } = fence
  if (lang === "mermaid") return <MermaidBlock source={source} />
  if (lang === "diff")
    return (
      <Figure label={meta === "" ? "diff" : `diff · ${meta}`}>
        <DiffBlock source={source} lang={grammarOf(meta)} />
      </Figure>
    )
  if (lang === "pseudo")
    return (
      <Figure label="pseudo">
        <PseudoCode source={source} edge={false} />
      </Figure>
    )
  const table = markedTableOf(lang, source)
  if (table !== undefined) return <MarkedTable config={table} />
  const overview = lang === "overview" ? parseOverview(source) : undefined
  if (overview !== undefined) return <ArchitectureMap map={overview} />
  const walk = lang === "walkthrough" ? parseWalkthrough(source) : undefined
  if (walk !== undefined) return <Walkthrough walk={walk} />
  const changes = lang === "changes" ? parseChanges(source) : undefined
  if (changes !== undefined) return <ChangeMap buckets={changes} />
  const grammar = grammarOf(lang)
  if (grammar !== undefined)
    return (
      <Figure label={lang}>
        <CodeBlock lang={grammar} source={source} />
      </Figure>
    )
  return undefined
}

/**
 * One mapping per element the agents actually produce, and the list is the whole
 * vocabulary — an element with no entry renders with the browser's own styling, which
 * against these tokens reads as a bug. Add the mapping rather than a global stylesheet:
 * a `.markdown p` selector is a second place appearance is decided.
 */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="min-w-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="line-through">{children}</del>,

  // Headings keep the body's measure. An agent writes them to separate the parts of one
  // answer, not to open a document, so the useful difference is weight — a scale inside a
  // pane as narrow as 570px would make a message shout. A document under
  // `MarkdownDocument` takes the scale for the top three.
  h1: H1,
  h2: H2,
  h3: H3,
  h4: ({ children }) => <h4 className="font-medium">{children}</h4>,
  h5: ({ children }) => <h5 className="font-medium">{children}</h5>,
  h6: ({ children }) => <h6 className="font-medium">{children}</h6>,

  ul: ({ children }) => <ul className="flex list-disc flex-col gap-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-0.5 pl-4">{children}</ol>,
  li: ({ children }) => <li className="min-w-0">{children}</li>,

  // `text-sm` on mono is the system's rule rather than a choice here: mono renders one
  // step below the step it sits at, and this sits at `base`.
  code: ({ children }) => (
    <code className="rounded-control bg-surface-2 px-1 font-mono text-sm">{children}</code>
  ),
  // A fenced block holds a `code` element, so the span styling above is cancelled inside
  // it — the block's figure is its frame, and a fill on the text would be a plate on a
  // plate. Every labelled block is decided here rather than in the `code` mapping above,
  // because each replaces the whole `pre`: a `div` returned from `code` would nest inside
  // it, which is invalid markup besides.
  //
  // A label nothing claims draws as plain text in a figure named for it, and so does an
  // unlabelled block, named `output`: an agent's `text` and `output` fences are prose, and
  // prose coloured as code is worse than prose left grey.
  pre: ({ node, children }) => {
    const fence = fenceOf(node)
    const figure = fence === undefined ? undefined : figureOf(fence)
    if (figure !== undefined) return figure
    return (
      <Figure label={fence === undefined || fence.lang === "" ? "output" : fence.lang}>
        <pre className={`m-0 ${CODE} [&_code]:bg-transparent [&_code]:p-0`}>{children}</pre>
      </Figure>
    )
  },

  img: MarkdownImage,

  blockquote: ({ children }) => (
    <blockquote className="border-l border-border pl-2">{children}</blockquote>
  ),
  hr: () => <hr className="border-border" />,
  a: MarkdownLink,

  // The reason `remark-gfm` is here at all: an agent asking three questions with the
  // options carried beside them writes a table, and it is the one shape that is unreadable
  // as characters. It draws as the table fence draws, so a table reads one way whichever
  // way the agent wrote it — and as a plain grid in the same figure where a cell holds what
  // that table cannot carry, a link or a picture, or it has more columns than it lays out.
  table: ({ node, children }) => {
    const config = tableOf(node)
    if (config !== undefined) return <MarkedTable config={config} />
    return (
      <Figure label={undefined}>
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full border-collapse bg-surface text-left">{children}</table>
        </div>
      </Figure>
    )
  },
  th: ({ children }) => (
    <th className="border-b border-l border-guide bg-surface px-2.5 py-0.75 align-top text-2xs leading-4 font-semibold uppercase tracking-wider text-fg-subtle first:border-l-0">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-t border-l border-guide px-2.5 py-1.75 align-top first:border-l-0">
      {children}
    </td>
  ),
}

/** The part of an mdast node the transform below reads: a text's value, a parent's list. */
interface MdNode {
  readonly type: string
  readonly value?: string
  children?: MdNode[]
}

/**
 * A text node split at each newline, with a `break` between the pieces — a soft break made
 * hard. `undefined` for a text with no newline, so the tree keeps the node it has.
 */
const brokenText = (node: MdNode): MdNode[] | undefined => {
  if (node.type !== "text" || node.value === undefined || !/[\n\r]/.test(node.value))
    return undefined
  const pieces: MdNode[] = []
  for (const [i, piece] of node.value.split(/\r?\n|\r/).entries()) {
    if (i > 0) pieces.push({ type: "break" })
    if (piece !== "") pieces.push({ type: "text", value: piece })
  }
  return pieces
}

const breakSoftLines = (node: MdNode): void => {
  if (node.children === undefined) return
  node.children = node.children.flatMap((child) => {
    breakSoftLines(child)
    return brokenText(child) ?? [child]
  })
}

/**
 * Every soft line break in a person's text drawn as a line break. An agent hard-wraps and
 * markdown joins those lines; a person who pressed Enter or pasted a block of lines meant
 * each one.
 *
 * **In the syntax tree rather than in CSS**, because a soft break is a newline in a text
 * node wherever that node sits — a paragraph, a tight list item with no paragraph around
 * its text, a quote. `pre-line` on chosen elements misses the ones not chosen, and on a
 * list item it would also draw the newlines the renderer puts between an item's blocks as
 * blank lines. A fence's text is a `code` node's value, not a `text` node, so it is
 * untouched.
 */
const remarkSaidBreaks = () => breakSoftLines

const AGENT_PLUGINS = [remarkGfm]
const SAID_PLUGINS = [remarkGfm, remarkSaidBreaks]

/**
 * 12px between blocks rather than margins on each one: the blocks are generated, so the
 * spacing has to come from the container that can see all of them. A figure takes 6px more
 * on each side (`Figure`'s own margin), so 24px stands around it.
 *
 * `said` draws a person's words rather than an agent's — see `remarkSaidBreaks`.
 */
const Markdown = ({
  children,
  said = false,
}: {
  readonly children: string
  readonly said?: boolean
}): ReactNode => (
  <div className="flex min-w-0 flex-col gap-3 text-base leading-5">
    <Markdown_ components={COMPONENTS} remarkPlugins={said ? SAID_PLUGINS : AGENT_PLUGINS}>
      {children}
    </Markdown_>
  </div>
)

export default Markdown
