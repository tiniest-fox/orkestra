import { describe, expect, it } from "vitest"
import { DeclaredServer } from "../types/mcp.js"
import { parseMcpFile } from "./mcp-file.js"

const SHOWN = ".orkestra/mcp.yaml"
const parse = (text: string | undefined) => parseMcpFile(SHOWN, text)

/** One server under `servers:`, so each refusal reads as the entry it is about. */
const one = (entry: string, name = "x"): string =>
  `servers:\n  ${name}:\n${entry
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n")}\n`

describe("mcp.yaml", () => {
  it("parses a stdio server and an http server, each value kept as written", () => {
    const text = `servers:
  files:
    command: npx
    args: ["-y", "@acme/files-mcp", "--root", "."]
    env:
      FILES_TOKEN: "\${FILES_TOKEN}"
      MODE: read
  linear:
    url: https://mcp.linear.app/mcp
    headers:
      Authorization: "Bearer \${LINEAR_API_KEY}"
`
    expect(parse(text)).toEqual({
      servers: [
        DeclaredServer.Stdio({
          name: "files",
          command: "npx",
          args: ["-y", "@acme/files-mcp", "--root", "."],
          env: { FILES_TOKEN: "${FILES_TOKEN}", MODE: "read" },
        }),
        DeclaredServer.Http({
          name: "linear",
          url: "https://mcp.linear.app/mcp",
          headers: { Authorization: "Bearer ${LINEAR_API_KEY}" },
        }),
      ],
      problems: [],
    })
  })

  it("defaults a stdio server's args and env, and an http server's headers, to empty", () => {
    expect(parse(one("command: srv")).servers).toEqual([
      DeclaredServer.Stdio({ name: "x", command: "srv", args: [], env: {} }),
    ])
    expect(parse(one("url: https://x.io/mcp")).servers).toEqual([
      DeclaredServer.Http({ name: "x", url: "https://x.io/mcp", headers: {} }),
    ])
  })

  it("parses an http server's `connection:` as the name a sign-in is bound to", () => {
    expect(parse(one("url: https://mcp.linear.app/mcp\nconnection: linear-work")).servers).toEqual([
      DeclaredServer.Connection({
        name: "x",
        url: "https://mcp.linear.app/mcp",
        connection: "linear-work",
      }),
    ])
  })

  it("says nothing for a project without the file", () => {
    expect(parse(undefined)).toEqual({ servers: [], problems: [] })
  })

  it("loads no server from a file that is not YAML, and says so once", () => {
    const parsed = parse("servers:\n  x: [unclosed\n")
    expect(parsed.servers).toEqual([])
    expect(parsed.problems).toHaveLength(1)
    expect(parsed.problems[0]).toMatch(/^`\.orkestra\/mcp\.yaml` was not read.*invalid YAML/)
  })

  it.each([
    ["a list", "- command: srv\n"],
    ["no `servers:` key", "server:\n  x:\n    command: srv\n"],
    ["a `servers:` list", "servers:\n  - command: srv\n"],
    ["an empty file", ""],
  ])("loads no server from %s", (_, text) => {
    expect(parse(text)).toEqual({
      servers: [],
      problems: [
        "`.orkestra/mcp.yaml` was not read, so no server it declares was added: it has no `servers:` map — servers are listed under `servers:`, by name.",
      ],
    })
  })
})

describe("a server mcp.yaml gets wrong", () => {
  it.each([
    ["both command and url", "command: srv\nurl: https://x.io", "not both"],
    ["neither command nor url", "args: [a]", "not both"],
    ["a connection beside headers", "url: https://x.io\nconnection: a\nheaders: {}", "in place of"],
    ["a connection on a stdio server", "command: srv\nconnection: a", "`connection:` is not a key"],
    ["a connection that is not a name", "url: https://x.io\nconnection: a.b", "is a server name"],
    ["a connection to an engine name", "url: https://x.io\nconnection: orkestra-x", "engine's own"],
    ["an unknown key", "command: srv\ntimeout: 30", "`timeout:` is not a key of a stdio server"],
    ["headers on a stdio server", "command: srv\nheaders: {}", "`headers:` is not a key"],
    ["a reference in args", "command: srv\nargs: ['${TOKEN}']", "only in `env` or `headers`"],
    ["a reference in command", "command: '${BIN}'", "only in `env` or `headers`"],
    ["a reference in url", "url: 'https://${HOST}/mcp'", "only in `env` or `headers`"],
    ["a broken reference", "command: srv\nenv:\n  A: '${not-a-name}'", "named as `${NAME}`"],
    ["an unclosed reference", "url: https://x.io\nheaders:\n  A: 'Bearer ${X'", "`${NAME}`"],
    ["a number in env", "command: srv\nenv:\n  PORT: 3000", "quote a number"],
    ["args that are not a list", "command: srv\nargs: a", "`args:` has to be a list"],
    ["an empty command", "command: ''", "non-empty"],
  ])("leaves out a server with %s, naming it and why", (_, entry, why) => {
    const parsed = parse(one(entry))
    expect(parsed.servers).toEqual([])
    expect(parsed.problems).toHaveLength(1)
    expect(parsed.problems[0]).toContain("MCP server `x` in `.orkestra/mcp.yaml` was left out:")
    expect(parsed.problems[0]).toContain(why)
  })

  it("refuses a name starting `orkestra-`, which is the engine's own", () => {
    expect(parse(one("command: srv", "orkestra-trak")).problems).toEqual([
      "MCP server `orkestra-trak` in `.orkestra/mcp.yaml` was left out: names starting `orkestra-` are the engine's own servers.",
    ])
  })

  it("refuses a name either CLI would have to quote", () => {
    expect(parse(one("command: srv", "my.server")).problems[0]).toContain(
      "only letters, digits, `-` and `_`",
    )
  })

  it.each([
    [
      "the engine's passphrase in env",
      "command: srv\nenv:\n  KEY: '${ORKESTRA_PASSPHRASE}'",
      "ORKESTRA_PASSPHRASE",
    ],
    [
      "the engine's passphrase in headers",
      "url: https://x.io\nheaders:\n  Authorization: 'Bearer ${ORKESTRA_PASSPHRASE}'",
      "ORKESTRA_PASSPHRASE",
    ],
    [
      "any other Orkestra variable in headers",
      "url: https://x.io\nheaders:\n  A: '${ORKESTRA_PROJECT_DIR}'",
      "ORKESTRA_PROJECT_DIR",
    ],
    ["HOME in env", "command: srv\nenv:\n  DIR: '${HOME}/data'", "HOME"],
  ])("leaves out a server whose reference names %s, which no secret may be", (_, entry, name) => {
    const parsed = parse(one(entry))
    expect(parsed.servers).toEqual([])
    expect(parsed.problems).toEqual([
      `MCP server \`x\` in \`.orkestra/mcp.yaml\` was left out: a reference may not name \`${name}\` — the host and the engines it starts set it themselves, and it is never a secret.`,
    ])
  })

  it("keeps every good server beside one that is wrong", () => {
    const text = `servers:
  good:
    command: srv
  bad:
    command: srv
    url: https://x.io
`
    const parsed = parse(text)
    expect(parsed.servers.map((s) => s.name)).toEqual(["good"])
    expect(parsed.problems).toHaveLength(1)
    expect(parsed.problems[0]).toContain("`bad`")
  })
})
