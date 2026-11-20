// The document a view is served as: the server's own HTML, held inside a frame of ours
// that carries its network policy and will not let it load anything else.
//
// A view is a document an MCP server wrote, drawn in a frame on the app's own page. The
// frame's sandbox is what keeps its script off that page; this is what keeps it off the
// network. One pure function of the text, so it is tested with no browser and no
// surface can forget to apply it.
//
// **Two frames, one inside the other, and the outer one is the point.** A policy says
// what a document may fetch and has no directive for where the document's own frame
// goes next: a view that sets `location`, follows a link or refreshes itself is
// navigating, and the only policy asked about that is the one on the document *holding*
// the frame — `frame-src`. The app's page cannot carry one, since it frames a hosted
// process's page by address. So the view sits in a frame inside a document written
// here, whose `frame-src 'none'` is what refuses the navigation, and that document sits
// in the frame the surface draws.
//
// **The policy is written once, on the outer document, and the view inherits it.** A
// `srcdoc` document takes the policy of the document that holds it, so the view is held
// to the same directives without a tag of its own — and a tag written into the server's
// HTML would have to get ahead of everything the server wrote to cover it.
//
// **A `<meta>` policy, because there is no response to put a header on**: the document
// reaches the frame as a string.
//
// Imports nothing, so the browser tier can load this file and put the real document in
// a real frame.

/** The hosts a view's server declared, by what each may be used for. */
interface Declared {
  readonly connect: readonly string[]
  readonly resource: readonly string[]
  readonly frame: readonly string[]
  readonly baseUri: readonly string[]
}

/**
 * One declared host as a policy source, or nothing where it is not plainly one. The
 * list came from a server, and a value holding a space, a quote or a semicolon would
 * end the directive it was written into and start another.
 */
const source = (declared: string): readonly string[] =>
  /^[A-Za-z0-9*.:/_-]+$/.test(declared) ? [declared] : []

const sources = (declared: readonly string[]): readonly string[] => declared.flatMap(source)

/** A directive naming `always` and the declared hosts, or `'none'` where both are empty. */
const directive = (
  name: string,
  always: readonly string[],
  declared: readonly string[],
): string => {
  const allowed = [...always, ...sources(declared)]
  return `${name} ${allowed.length === 0 ? "'none'" : allowed.join(" ")}`
}

/**
 * The policy for one view. With nothing declared, the view runs the script and styles
 * its own document carries, shows images it holds inline, and fetches nothing. Each
 * list the server declared widens the directives its kind of host is for and no other.
 *
 * **`frame-src` is `'none'` whatever the server declared for frames.** The directive is
 * read twice — by the view, for a frame it embeds, and by the document holding the view,
 * for where the view's own frame may go — and one list cannot allow the first without
 * the second. A document loaded into the view's frame is not the view: it inherits no
 * policy, and it speaks to the page through the same window the view did, before
 * anything can tell the two apart. So a view embeds no frame.
 *
 * `'unsafe-inline'` is the view's own script, which is the whole of a view. `'self'` is
 * never written: the frame's origin is opaque, so it would name nothing.
 */
export const viewPolicy = (declared: Declared | undefined): string => {
  const resource = declared?.resource ?? []
  return [
    "default-src 'none'",
    directive("script-src", ["'unsafe-inline'"], resource),
    directive("style-src", ["'unsafe-inline'"], resource),
    directive("img-src", ["data:", "blob:"], resource),
    directive("font-src", ["data:"], resource),
    directive("media-src", ["data:", "blob:"], resource),
    directive("connect-src", [], declared?.connect ?? []),
    "frame-src 'none'",
    "object-src 'none'",
    directive("base-uri", [], declared?.baseUri ?? []),
    "form-action 'none'",
  ].join("; ")
}

/**
 * The script of the document holding the view. It makes the view's frame, and carries
 * each message between the view and the page above — the one channel a view has.
 *
 * **It stops for good once the view's frame has loaded a second document.** The policy
 * refuses every address but one: `about:blank` is allowed anywhere. Nothing is carried
 * to or from a frame that has left the view, whatever it then holds.
 *
 * The frame is made here rather than written as markup so the count is listening
 * before the first load, which is the only way a second one can be told from it.
 */
const relay = (html: string): string => `(() => {
  const view = document.createElement("iframe")
  let loads = 0
  view.addEventListener("load", () => { loads += 1 })
  view.setAttribute("sandbox", "allow-scripts")
  view.srcdoc = ${embedded(html)}
  addEventListener("message", (event) => {
    if (loads > 1) return
    if (event.source === view.contentWindow) parent.postMessage(event.data, "*")
    else if (event.source === parent) view.contentWindow.postMessage(event.data, "*")
  })
  document.body.append(view)
})()`

/**
 * Text as a script's string literal. `<` is written as an escape so nothing in the
 * server's HTML can end the script it is carried in.
 */
const embedded = (text: string): string => JSON.stringify(text).replaceAll("<", "\\u003c")

/** The view's frame fills the document holding it, so the surface sizes one frame. */
const FILL =
  "html,body{margin:0;height:100%}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}"

/**
 * The document a surface sets as a frame's `srcdoc`: the policy, then the view in a
 * frame of its own. See the head of this file for why there are two.
 */
export const viewDocument = (html: string, declared: Declared | undefined): string =>
  `<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="${viewPolicy(declared)}">` +
  `<style>${FILL}</style><body><script>${relay(html)}</script></body>`
