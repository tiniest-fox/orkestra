/**
 * The two things this component exists to get right: the block shapes that are unreadable
 * as characters, and the fact that its input was written by a model.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import Markdown, { MarkdownDocument, MarkdownImages, MarkdownLinks } from "./Markdown"

// The theme is picked by asking `matchMedia`; this pins it to light.
beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})
afterAll(() => {
  vi.unstubAllGlobals()
})
afterEach(cleanup)

/** What the drawer hands down: the path, addressed to one trak's checkout. */
const inCheckout = (path: string): string => `/api/traks/t1/image?path=${encodeURIComponent(path)}`

/**
 * The same, after the trak has logged an event: the drawer versions the address so a shot
 * re-taken under the same name is fetched again, which means the address of one picture
 * moves while the picture is on screen.
 */
const inCheckoutLater = (path: string): string => `${inCheckout(path)}&v=2`

describe("Markdown", () => {
  it("draws a GFM table as a table fence draws, which is the shape prose cannot stand in for", () => {
    const { container } = render(
      <Markdown>{"| Question | Default |\n| - | - |\n| `scope` | (a) |"}</Markdown>,
    )

    // No `<table>`: it is the marked table, whose heads appear once more on each narrow line.
    expect(container.querySelector("table")).toBeNull()
    expect(screen.getAllByText("Default").length).toBeGreaterThan(0)
    expect(screen.getByText("(a)")).toBeDefined()
    expect(screen.getByText("scope").tagName).toBe("CODE")
  })

  it("keeps a GFM table whose cell holds a link as a grid, so the link survives", () => {
    render(<Markdown>{"| Where |\n| - |\n| [the PR](https://example.com) |"}</Markdown>)

    expect(screen.getByRole("columnheader", { name: "Where" })).toBeDefined()
    expect(screen.getByRole("link", { name: "the PR" })).toBeDefined()
  })

  it("renders a list as a list rather than as lines beginning with a dash", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>)

    expect(screen.getAllByRole("listitem")).toHaveLength(2)
  })

  it("renders emphasis as weight, so the asterisks stop being visible", () => {
    render(<Markdown>{"**What exists**"}</Markdown>)

    expect(screen.getByText("What exists")).toBeDefined()
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  it("escapes markup in the source rather than running it", () => {
    // The whole reason this renders elements instead of an HTML string. The text comes
    // from a model, and the one mistake that matters is treating it as trusted.
    const { container } = render(<Markdown>{"<img src=x onerror=alert(1)>"}</Markdown>)

    expect(container.querySelector("img")).toBeNull()
  })

  it("joins an agent's lines split by a single newline into one paragraph", () => {
    const { container } = render(<Markdown>{"a line the agent\nhard-wrapped"}</Markdown>)

    expect(container.querySelectorAll("p")).toHaveLength(1)
    expect(container.querySelector("br")).toBeNull()
  })

  it("draws nothing at all for an empty string", () => {
    const { container } = render(<Markdown>{""}</Markdown>)

    expect(container.textContent).toBe("")
  })

  it("keeps a mermaid source visible when it cannot be drawn", async () => {
    // The state that actually ships on a bad diagram, and the one worth guaranteeing: the
    // words must survive — a block that drew nothing would be hiding what was written. The
    // source does not parse, and the test waits for `render` to reject, because happy-dom
    // draws a valid diagram and the source shows before any draw has settled.
    const { default: mermaid } = await import("mermaid")
    const renders = vi.spyOn(mermaid, "render")
    render(<Markdown>{"```mermaid\nflowchart TD\n  A -->\n```"}</Markdown>)

    await waitFor(() => {
      expect(renders).toHaveBeenCalledOnce()
    })
    await Promise.allSettled(renders.mock.results.map((r): unknown => r.value))
    // As written — the left-to-right rewrite is for mermaid, not for the reader.
    expect(await screen.findByText(/flowchart TD/)).toBeDefined()
    // Inside the figure, whose band names the diagram's type.
    expect(screen.getByRole("figure").textContent).toContain("flowchart")
    expect(screen.queryByRole("img", { name: "diagram" })).toBeNull()
  })

  it("draws an unlabelled fenced block in a figure named output, uncoloured", () => {
    // The 685 of them across the filed traks are type declarations, shell commands,
    // error output and prose mixed together; prose coloured as code is worse than grey.
    const { container } = render(<Markdown>{"```\nconst a = 1\n```"}</Markdown>)

    const figure = container.querySelector("figure")
    expect(figure?.textContent.trim()).toBe("outputconst a = 1")
    expect(container.querySelector("span[style]")).toBeNull()
  })

  it("names a label nothing has a grammar for, and leaves it uncoloured", () => {
    const { container } = render(<Markdown>{"```text\nplain words\n```"}</Markdown>)

    expect(container.querySelector("figure")?.textContent.trim()).toBe("textplain words")
    expect(container.querySelector("span[style]")).toBeNull()
  })

  it("colours a `ts` fence once its grammar lands, in a figure named for it", async () => {
    const { container } = render(<Markdown>{"```ts\nconst a = 1\n```"}</Markdown>)

    // As written while it loads — the block never draws blank.
    expect(screen.getByText(/const a = 1/)).toBeDefined()
    await waitFor(() => {
      expect(container.querySelector("span[style]")).not.toBeNull()
    })
    expect(screen.getByText("ts")).toBeDefined()
    expect(container.querySelector("pre")?.textContent).toBe("const a = 1")
  })

  it("colours a `pseudo` fence in the notation's own hues", () => {
    const { container } = render(<Markdown>{"```pseudo\ndefine load(file)\n```"}</Markdown>)

    expect(screen.getByText("define").className).toContain("text-syntax-keyword")
    expect(screen.getByText("load").className).toContain("text-syntax-call")
    expect(container.querySelector("figure")?.textContent).toBe("pseudodefine load(file)")
  })
})

describe("Markdown — a person's text", () => {
  it("keeps a person's single newline as a line break, and still draws their markdown", () => {
    const { container } = render(<Markdown said>{"first line\nsecond line\n\n- one"}</Markdown>)

    const paragraph = container.querySelector("p")
    expect(paragraph?.innerHTML).toBe("first line<br>\nsecond line")
    expect(screen.getByRole("listitem")).toHaveTextContent("one")
  })

  it("keeps a line break inside a person's tight list item", () => {
    render(<Markdown said>{"1. first step\n2. second step\n   continued under it"}</Markdown>)

    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(items[1]?.innerHTML).toBe("second step<br>\ncontinued under it")
  })

  it("adds no line break around a person's nested list", () => {
    const { container } = render(<Markdown said>{"- outer\n  - inner\n- next"}</Markdown>)

    expect(container.querySelector("br")).toBeNull()
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
  })

  it("keeps a line break in a person's loose list, and adds none between its items", () => {
    const { container } = render(<Markdown said>{"- one\n  more of one\n\n- two"}</Markdown>)

    expect(container.querySelectorAll("br")).toHaveLength(1)
    expect(container.querySelector("li p")?.innerHTML).toBe("one<br>\nmore of one")
  })

  it("keeps a line break in a person's quote", () => {
    const { container } = render(<Markdown said>{"> they said\n> this"}</Markdown>)

    expect(container.querySelector("blockquote p")?.innerHTML).toBe("they said<br>\nthis")
  })

  it("leaves a person's fenced block as they wrote it", () => {
    const { container } = render(<Markdown said>{"```\na\nb\n```"}</Markdown>)

    expect(container.querySelector("br")).toBeNull()
    expect(container.querySelector("pre")?.textContent).toBe("a\nb\n")
  })
})

describe("Markdown — a walkthrough fence", () => {
  it("draws a walkthrough as a stepper, blank lines between its paths included", () => {
    const source = [
      "actors: A, B",
      "",
      "path: First",
      "1. Go",
      "   at: A -> B",
      "",
      "path: Second",
      "1. Stay",
      "   at: A",
    ].join("\n")
    const { container } = render(<Markdown>{`\`\`\`walkthrough\n${source}\n\`\`\``}</Markdown>)

    expect(screen.getByRole("tab", { name: "First" })).toBeDefined()
    expect(screen.getByRole("tab", { name: "Second" })).toBeDefined()
    expect(container.querySelector("pre")).toBeNull()
  })

  it.each([
    ["does not parse", "1. Go\n   at: A -> B"],
    ["names more than five actors", "actors: A, B, C, D, E, F\n1. Go\n   at: A -> F"],
  ])("draws a fence that %s as its source, with no steps or tabs", (_, source) => {
    const { container } = render(<Markdown>{`\`\`\`walkthrough\n${source}\n\`\`\``}</Markdown>)

    expect(container.querySelector("pre")?.textContent).toBe(`${source}\n`)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByRole("tab")).toBeNull()
  })
})

describe("Markdown — a changes fence", () => {
  it("draws a changes fence as its buckets rather than as code", () => {
    const source = [
      "## The dispatch",
      "why: one branch per label",
      "~ a/b.ts",
      "  the branch",
    ].join("\n")
    const { container } = render(<Markdown>{`\`\`\`changes\n${source}\n\`\`\``}</Markdown>)

    expect(screen.getByRole("region", { name: "The dispatch" })).toBeDefined()
    expect(container.querySelector("pre")).toBeNull()
  })

  it("draws a fence that does not parse as its source, with no buckets", () => {
    const source = "~ a/b.ts\n  a file before any bucket"
    const { container } = render(<Markdown>{`\`\`\`changes\n${source}\n\`\`\``}</Markdown>)

    expect(container.querySelector("pre")?.textContent).toBe(`${source}\n`)
    expect(screen.queryByRole("region")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })
})

/** A diff's rows as the two facts each one carries: which ground, and what it says. */
const rows = (container: HTMLElement) =>
  [...container.querySelectorAll("div.whitespace-pre")].map((row) => ({
    wash: [...row.classList].find((c) => c.startsWith("bg-")),
    text: row.textContent,
  }))

describe("Markdown — a diff fence", () => {
  it("washes an added row green and a removed row red, with the sign in a gutter", () => {
    const { container } = render(<Markdown>{"```diff\n context\n-gone\n+here\n```"}</Markdown>)

    expect(rows(container)).toEqual([
      { wash: "bg-canvas", text: "context" },
      { wash: "bg-diff-del-wash", text: "−gone" },
      { wash: "bg-diff-add-wash", text: "+here" },
    ])
    // The sign is text a reader can select and copy — not decoration.
    const sign = screen.getByText("+")
    expect(sign.getAttribute("aria-hidden")).toBeNull()
    expect(sign.className).not.toContain("select-none")
    expect(sign.className).toContain("text-tone-good")
  })

  it("gives a `@@` row a band with rules and no sign column, and a file header neither", () => {
    const { container } = render(
      <Markdown>{"```diff\n--- a/x.ts\n@@ -1 +1 @@\n-a\n+b\n```"}</Markdown>,
    )

    const [header, range] = [...container.querySelectorAll("div.whitespace-pre")]
    expect(header?.className).toContain("bg-canvas")
    expect(header?.className).not.toContain("border-y")
    expect(header?.textContent).toBe("--- a/x.ts")
    expect(range?.className).toContain("bg-surface")
    expect(range?.className).toContain("border-y")
    expect(range?.textContent).toBe("@@ -1 +1 @@")
    expect(range?.querySelector("span.sticky")).toBeNull()
  })

  it("draws its own rows rather than the plate, so nothing nests a plate in a plate", () => {
    const { container } = render(<Markdown>{"```diff\n+x\n```"}</Markdown>)

    expect(container.querySelector("pre")).toBeNull()
    expect(container.querySelector("code")).toBeNull()
    expect(container.querySelector("span[style]")).toBeNull()
  })

  it("colours the text as the language named after the word, and names it", async () => {
    const { container } = render(
      <Markdown>{"```diff ts\n-const a = 1\n+const a = 2\n```"}</Markdown>,
    )

    await waitFor(() => {
      expect(container.querySelector("span[style]")).not.toBeNull()
    })
    expect(screen.getByText("diff · ts")).toBeDefined()
    expect(rows(container).map((r) => r.text)).toEqual(["−const a = 1", "+const a = 2"])
  })
})

describe("Markdown — an image the agent wrote", () => {
  it("draws a path inside the checkout, through the resolver it was handed", () => {
    render(
      <MarkdownImages resolve={inCheckout}>
        <Markdown>{"![the drawer](.atelier/proof/.shots/pane.png)"}</Markdown>
      </MarkdownImages>,
    )

    expect(screen.getByRole("img", { name: "the drawer" }).getAttribute("src")).toBe(
      inCheckout(".atelier/proof/.shots/pane.png"),
    )
  })

  it("draws the alt text where nothing said which trak this is", () => {
    // The default, and it is the one every other surface gets: an image with no checkout
    // behind it has no address that could be right.
    const { container } = render(<Markdown>{"![the drawer](shot.png)"}</Markdown>)

    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("the drawer")).toBeDefined()
    // Words, so there is nothing to press: a press would be offering to open something
    // there is nothing behind.
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("draws the alt text for a remote src rather than fetching it", () => {
    // The hazard the mapping exists for: an `<img src>` is an outbound request the agent
    // chose, so a remote one would report when a person read the trak.
    const { container } = render(
      <MarkdownImages resolve={inCheckout}>
        <Markdown>{"![a beacon](https://example.test/pixel.png)"}</Markdown>
      </MarkdownImages>,
    )

    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("a beacon")).toBeDefined()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("draws the alt text for a `data:` src, which carries its own bytes", () => {
    const { container } = render(
      <MarkdownImages resolve={inCheckout}>
        <Markdown>
          {
            "![inline](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=)"
          }
        </Markdown>
      </MarkdownImages>,
    )

    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("inline")).toBeDefined()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("draws the alt text for a path that climbs out of the checkout", () => {
    const { container } = render(
      <MarkdownImages resolve={inCheckout}>
        <Markdown>{"![escaping](../../etc/shadow.png)"}</Markdown>
      </MarkdownImages>,
    )

    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("escaping")).toBeDefined()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("falls back to the alt text when the file is no longer there", () => {
    // A shot dies with its checkout, so a 404 is the ordinary end of one — and the
    // browser's broken-image icon is the failure this whole route exists to remove.
    render(
      <MarkdownImages resolve={inCheckout}>
        <Markdown>{"![the drawer](shot.png)"}</Markdown>
      </MarkdownImages>,
    )

    fireEvent.error(screen.getByRole("img", { name: "the drawer" }))

    expect(screen.queryByRole("img")).toBeNull()
    expect(screen.getByText("the drawer")).toBeDefined()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("stays as its words when the address moves under it", () => {
    // The failure is remembered by the picture and not by its address: the trak logging
    // an event moves the address, and a shot that had fallen back to its words would
    // otherwise come back as an `<img>` and 404 again at every event.
    const { rerender } = render(
      <MarkdownImages resolve={inCheckout}>
        <Markdown>{"![the drawer](shot.png)"}</Markdown>
      </MarkdownImages>,
    )
    fireEvent.error(screen.getByRole("img", { name: "the drawer" }))

    rerender(
      <MarkdownImages resolve={inCheckoutLater}>
        <Markdown>{"![the drawer](shot.png)"}</Markdown>
      </MarkdownImages>,
    )

    expect(screen.queryByRole("img")).toBeNull()
    expect(screen.getByText("the drawer")).toBeDefined()
  })

  it("draws the next picture at that place, rather than inheriting the last one's failure", () => {
    // Why the failure is remembered by the picture at all rather than by a flag: React
    // keeps state at a place in the tree, so a pane redrawn with different text there
    // would otherwise show a shot that never loaded as alt text for a load nobody made.
    const { rerender } = render(
      <MarkdownImages resolve={inCheckout}>
        <Markdown>{"![the drawer](shot.png)"}</Markdown>
      </MarkdownImages>,
    )
    fireEvent.error(screen.getByRole("img", { name: "the drawer" }))

    rerender(
      <MarkdownImages resolve={inCheckout}>
        <Markdown>{"![the shelf](other.png)"}</Markdown>
      </MarkdownImages>,
    )

    expect(screen.getByRole("img", { name: "the shelf" }).getAttribute("src")).toBe(
      inCheckout("other.png"),
    )
  })
})

describe("Markdown — a picture opened over the window", () => {
  it("opens on a press, and Escape shuts it and gives the picture back its focus", () => {
    render(
      <MarkdownImages resolve={inCheckout}>
        <Markdown>{"![the drawer](shot.png)"}</Markdown>
      </MarkdownImages>,
    )

    // Named by the words the agent wrote beside the picture, through the picture itself.
    const press = screen.getByRole("button", { name: "the drawer" })
    fireEvent.click(press)

    const open = screen.getByRole("dialog", { name: "the drawer" })
    // The same picture a second time, on the wash, at the same address.
    expect(screen.getAllByRole("img", { name: "the drawer" })).toHaveLength(2)
    // The way out holds focus, which is the whole reason Escape below reaches the view
    // rather than the page behind it.
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus()

    fireEvent.keyDown(open, { key: "Escape" })

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(press).toHaveFocus()
  })

  it("reaches the press by Tab, and names it where the agent wrote no words", async () => {
    render(
      <MarkdownImages resolve={inCheckout}>
        <Markdown>{"![](shot.png)"}</Markdown>
      </MarkdownImages>,
    )

    await userEvent.tab()

    // Nothing inside can name it, so the button says what it does instead.
    expect(screen.getByRole("button", { name: "Open the image" })).toHaveFocus()
  })

  it("takes the view down with the picture when the file goes away while it is open", () => {
    // The checkout can be merged or closed while somebody is looking at the shot, and the
    // failure the route exists to remove would otherwise be a broken-image icon filling
    // the window.
    render(
      <MarkdownImages resolve={inCheckout}>
        <Markdown>{"![the drawer](shot.png)"}</Markdown>
      </MarkdownImages>,
    )

    fireEvent.click(screen.getByRole("button", { name: "the drawer" }))
    const onTheWash = within(screen.getByRole("dialog")).getByRole("img", { name: "the drawer" })
    fireEvent.error(onTheWash)

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("img")).toBeNull()
    expect(screen.getByText("the drawer")).toBeDefined()
  })

  it("stays open when the address moves under it, and shows the picture at the new one", () => {
    // The detail is polled while somebody is looking, and every event the trak logs moves
    // the address. The view is of the picture and not of an address, so it stays up — and
    // what it draws is the current address, which is the whole point of the address moving.
    const { rerender } = render(
      <MarkdownImages resolve={inCheckout}>
        <Markdown>{"![the drawer](shot.png)"}</Markdown>
      </MarkdownImages>,
    )
    fireEvent.click(screen.getByRole("button", { name: "the drawer" }))

    rerender(
      <MarkdownImages resolve={inCheckoutLater}>
        <Markdown>{"![the drawer](shot.png)"}</Markdown>
      </MarkdownImages>,
    )

    const open = screen.getByRole("dialog", { name: "the drawer" })
    expect(within(open).getByRole("img", { name: "the drawer" }).getAttribute("src")).toBe(
      inCheckoutLater("shot.png"),
    )
  })

  it("does not hand the open view to the next picture at that place", () => {
    // The other half of why the press is remembered by the picture: at that place in the
    // tree the next image would otherwise arrive already open, over a press nobody made.
    const { rerender } = render(
      <MarkdownImages resolve={inCheckout}>
        <Markdown>{"![the drawer](shot.png)"}</Markdown>
      </MarkdownImages>,
    )
    fireEvent.click(screen.getByRole("button", { name: "the drawer" }))

    rerender(
      <MarkdownImages resolve={inCheckout}>
        <Markdown>{"![the shelf](other.png)"}</Markdown>
      </MarkdownImages>,
    )

    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("Markdown — a link the agent wrote", () => {
  it("offers a plain press to the page, and opens the browser only where the page declines", () => {
    const follow = vi.fn<(href: string) => boolean>((href) => href.startsWith("http://localhost"))
    render(
      <MarkdownLinks follow={follow}>
        <Markdown>{"[mine](http://localhost:5173/) and [theirs](https://example.com/)"}</Markdown>
      </MarkdownLinks>,
    )

    expect(fireEvent.click(screen.getByRole("link", { name: "mine" }))).toBe(false)
    expect(fireEvent.click(screen.getByRole("link", { name: "theirs" }))).toBe(true)
    expect(follow).toHaveBeenCalledTimes(2)
  })

  it("never offers a modifier press, and offers nothing where no page said it takes links", () => {
    const follow = vi.fn<(href: string) => boolean>(() => true)
    render(
      <MarkdownLinks follow={follow}>
        <Markdown>{"[mine](http://localhost:5173/)"}</Markdown>
      </MarkdownLinks>,
    )
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"])
      expect(fireEvent.click(screen.getByRole("link", { name: "mine" }), { [key]: true })).toBe(
        true,
      )
    expect(follow).not.toHaveBeenCalled()
    cleanup()

    render(<Markdown>{"[mine](http://localhost:5173/)"}</Markdown>)
    const link = screen.getByRole("link", { name: "mine" })
    expect(fireEvent.click(link)).toBe(true)
    expect(link).toHaveAttribute("target", "_blank")
  })
})

describe("Markdown — a table figure", () => {
  const DECISION = [
    "```decision",
    "Source form",
    "chose: One labelled fence",
    "over: A YAML fence",
    "why: It reads cleanly as the fallback.",
    "flag: hard to reverse",
    "",
    "Over-marking",
    "chose: No rule",
    "```",
  ].join("\n")

  it("draws a fence that reads as the marked table, blank lines and all", () => {
    render(<Markdown>{DECISION}</Markdown>)

    // A head is in the header and again as each cell's narrow label, since both layouts
    // are one tree; the key in the footer is drawn once.
    expect(screen.getAllByText("Chosen").length).toBeGreaterThan(1)
    expect(screen.getByText("Over-marking")).toBeDefined()
    expect(screen.getByText("Hard to reverse")).toBeDefined()
    expect(screen.queryByText(/chose:/)).toBeNull()
  })

  it("draws a row's detail with no press, as a column headed by its label", () => {
    render(<Markdown>{DECISION}</Markdown>)

    // Nothing opens: the detail is its own column, its head the row's label.
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getAllByText("Why").length).toBeGreaterThan(1)
    expect(screen.getByText("It reads cleanly as the fallback.")).toBeDefined()
  })

  it("says a cell's own verdict, and draws a run's cost in the footer", () => {
    render(
      <Markdown>
        {[
          "```runs",
          "lint",
          "result: failed",
          "said: 1 error.",
          "",
          "check",
          "result: passed",
          "said: Exit 0.",
          "",
          "test",
          "result: not run",
          "said: after lint failed",
          "",
          "cost: None.",
          "```",
        ].join("\n")}
      </Markdown>,
    )

    expect(screen.getByLabelText("No")).toBeDefined()
    expect(screen.getByLabelText("Yes")).toBeDefined()
    expect(screen.getByText("Not run, after lint failed")).toBeDefined()
    expect(screen.getByText("Cost")).toBeDefined()
    expect(screen.getByText("None.")).toBeDefined()
  })

  it("draws a figure fence that does not read as its own source", () => {
    const { container } = render(
      <Markdown>{"```decision\nSource form\nchosen: a misspelt key\n```"}</Markdown>,
    )

    expect(container.querySelector("pre")?.textContent.trim()).toBe(
      "Source form\nchosen: a misspelt key",
    )
  })
})

/**
 * Two parts: the first's file carrying its own sketch, with a blank line inside it that
 * `fenceOf` must hand over whole; the second with one sketch for the whole part.
 */
const OVERVIEW = [
  "```overview",
  "1. Client | Hosts the frame",
  "   in: client/src",
  "   + views/ViewFrame.tsx — The sandboxed frame",
  "     sketch:",
  "       define draw(view)",
  "",
  "         frame = sandbox(view)",
  "",
  "2. Engine | Keeps what a view needs",
  "   ~ server.ts — A route",
  "   sketch:",
  "     define serve(view)",
  "",
  "outside: CLI | The agent process",
  "Client -> Engine: a press",
  "order: Engine first, then Client.",
  "```",
].join("\n")

describe("Markdown — an overview fence", () => {
  it("rails the parts, then what is outside, and shows the first part's files", () => {
    render(<Markdown>{OVERVIEW}</Markdown>)

    expect(screen.getByRole("button", { name: /Client/, pressed: true })).toBeDefined()
    expect(screen.getByRole("button", { name: /CLI/, pressed: false })).toBeDefined()
    expect(screen.getByText("2 parts")).toBeDefined()
    const part = within(screen.getByRole("region", { name: "Client" }))
    expect(part.getByText("client/src/views/")).toBeDefined()
    expect(part.getByText("ViewFrame.tsx")).toBeDefined()
    expect(screen.getByText("Engine first, then Client.")).toBeDefined()
  })

  it("opens a file into its own sketch, whole, and shuts it on a second press", async () => {
    render(<Markdown>{OVERVIEW}</Markdown>)
    const file = screen.getByRole("button", { name: /ViewFrame\.tsx/ })

    await userEvent.click(file)

    expect(file.getAttribute("aria-expanded")).toBe("true")
    // The blank line inside the sketch survived the trip through the fence.
    const part = screen.getByRole("region", { name: "Client" })
    expect(within(part).getByText("pseudo")).toBeDefined()
    const lines = [...(part.querySelector(".whitespace-pre")?.children ?? [])]
    expect(lines.map((line) => line.textContent)).toEqual([
      "define draw(view)",
      " ",
      "  frame = sandbox(view)",
    ])
    await userEvent.click(file)
    expect(within(part).queryByText("pseudo")).toBeNull()
  })

  it("draws a part's own sketch under its tree, and does not open a file without one", async () => {
    render(<Markdown>{OVERVIEW}</Markdown>)

    await userEvent.click(screen.getByRole("button", { name: /Engine.*Keeps/ }))

    const part = within(screen.getByRole("region", { name: "Engine" }))
    expect(screen.getByRole("button", { name: /Engine.*Keeps/, pressed: true })).toBeDefined()
    expect(part.getByText("server.ts")).toBeDefined()
    expect(part.queryByRole("button")).toBeNull()
    expect(part.getByText("pseudo")).toBeDefined()
    expect(screen.queryByRole("region", { name: "Client" })).toBeNull()
  })

  it("says an outside entry is not changed by the plan", async () => {
    render(<Markdown>{OVERVIEW}</Markdown>)

    await userEvent.click(screen.getByRole("button", { name: /CLI/ }))

    const entry = within(screen.getByRole("region", { name: "CLI" }))
    expect(entry.getByText("CLI is not changed by this plan.")).toBeDefined()
  })

  it("draws a fence that does not read as its source, with no rail", () => {
    const { container } = render(<Markdown>{"```overview\noutside: CLI\n```"}</Markdown>)

    expect(screen.queryByRole("button")).toBeNull()
    expect(container.querySelector("pre")?.textContent.trim()).toBe("outside: CLI")
  })
})

describe("Markdown — headings", () => {
  it("draws a message's headings by weight alone, and a document's a step up the scale", () => {
    render(<Markdown>{"# Message"}</Markdown>)
    render(
      <MarkdownDocument>
        <Markdown>{"# Document"}</Markdown>
      </MarkdownDocument>,
    )
    expect(screen.getByRole("heading", { name: "Message" }).className).toBe("font-semibold")
    expect(screen.getByRole("heading", { name: "Document" }).className).toContain("text-lg")
  })
})
