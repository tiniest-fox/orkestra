import { describe, expect, it } from "vitest"
import { viewDocument, viewPolicy } from "./view-policy.js"

/** The policy for a view whose server declared nothing. */
const NOTHING_ALLOWED =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

describe("viewPolicy", () => {
  it("allows no request at all where the server declared nothing", () => {
    expect(viewPolicy(undefined)).toBe(NOTHING_ALLOWED)
  })

  it("widens only the directives a declared host is for", () => {
    const policy = viewPolicy({
      connect: ["https://api.example.com"],
      resource: ["https://cdn.example.com"],
      frame: [],
      baseUri: [],
    })
    expect(policy).toContain("connect-src https://api.example.com;")
    expect(policy).toContain("script-src 'unsafe-inline' https://cdn.example.com;")
    expect(policy).toContain("img-src data: blob: https://cdn.example.com;")
    expect(policy).toContain("frame-src 'none'")
    expect(policy).not.toContain("script-src 'unsafe-inline' https://api.example.com")
  })

  it("drops a declared host that would end its directive and start another", () => {
    const policy = viewPolicy({
      connect: ["https://ok.example.com", "x; script-src *", "'unsafe-eval'", 'a"b', "a b"],
      resource: [],
      frame: [],
      baseUri: [],
    })
    expect(policy).toContain("connect-src https://ok.example.com;")
    expect(policy).not.toContain("script-src *")
    expect(policy).not.toContain("unsafe-eval")
  })
})

describe("viewDocument", () => {
  const html = '<!DOCTYPE html><script>x = "</script><script>alert(1)"</script><p>view</p>'
  const served = viewDocument(html, undefined)

  it("opens with the policy, ahead of anything the server wrote", () => {
    expect(
      served.startsWith(
        `<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="${NOTHING_ALLOWED}">`,
      ),
    ).toBe(true)
  })

  it("holds the server's HTML as text of its own script, where nothing in it can end that script", () => {
    // One script and one closing tag: the server's own tags are carried as escapes.
    expect(served.match(/<script>/g)).toHaveLength(1)
    expect(served.match(/<\/script>/g)).toHaveLength(1)
    expect(served).not.toContain("<p>view</p>")
    expect(served).toContain(String.raw`\u003cp>view\u003c/p>`)
  })

  it("puts the view in a frame that may run script and nothing else", () => {
    expect(served).toContain('view.setAttribute("sandbox", "allow-scripts")')
  })
})

describe("viewPolicy and a frame", () => {
  it("allows no frame address, whatever the server declared for frames", () => {
    const policy = viewPolicy({
      connect: [],
      resource: [],
      frame: ["https://embed.example.com"],
      baseUri: [],
    })
    expect(policy).toContain("frame-src 'none'")
    expect(policy).not.toContain("embed.example.com")
  })
})
