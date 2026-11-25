import { Either } from "effect"
import { describe, expect, it } from "vitest"
import { McpServer } from "../../agent/types/session.js"
import {
  connectionsOf,
  DeclaredServer,
  type Dialed,
  hostUnasked,
  resolveServers as resolveWith,
} from "./mcp-servers.js"

const linear = DeclaredServer.Http({
  name: "linear",
  url: "https://mcp.linear.app/mcp",
  headers: { Authorization: "Bearer ${LINEAR_API_KEY}" },
})
const files = DeclaredServer.Stdio({
  name: "files",
  command: "files-mcp",
  args: ["--root", "."],
  env: { TOKEN: "${FILES_TOKEN}", ROOT: "${HOME_DIR}/work", MODE: "read" },
})
const resolveServers = (
  list: readonly DeclaredServer[],
  env: Readonly<Record<string, string | undefined>>,
) => resolveWith(list, env, new Map(), [])

describe("resolving the host's servers against the engine's environment", () => {
  it("fills every reference inside a string, in `Stdio` and `Http` alike", () => {
    const resolved = resolveServers([linear, files], {
      LINEAR_API_KEY: "lin_123",
      FILES_TOKEN: "f",
      HOME_DIR: "/home/me",
    })
    expect(resolved).toEqual({
      servers: {
        linear: McpServer.Http({
          url: "https://mcp.linear.app/mcp",
          headers: { Authorization: "Bearer lin_123" },
        }),
        files: McpServer.Stdio({
          command: "files-mcp",
          args: ["--root", "."],
          env: { TOKEN: "f", ROOT: "/home/me/work", MODE: "read" },
        }),
      },
      lines: [],
      skipped: new Map(),
      connections: [],
    })
  })

  it("leaves out a server with an unset secret, naming the server and the secret", () => {
    const resolved = resolveServers([linear, files], { FILES_TOKEN: "f", HOME_DIR: "/h" })
    expect(Object.keys(resolved.servers)).toEqual(["files"])
    expect(resolved.lines).toEqual([
      "MCP server `linear` was left out of this turn: the secret `LINEAR_API_KEY` is not set in the engine's environment.",
    ])
    expect([...resolved.skipped.keys()]).toEqual(["linear"])
  })

  it("names every secret a server is missing, and counts an empty one as unset", () => {
    expect(resolveServers([files], { FILES_TOKEN: "" }).lines).toEqual([
      "MCP server `files` was left out of this turn: the secrets `FILES_TOKEN`, `HOME_DIR` are not set in the engine's environment.",
    ])
  })

  it("fills once, so a secret holding `${` reaches the session as it is", () => {
    const resolved = resolveServers([linear], { LINEAR_API_KEY: "a${HOME_DIR}b" })
    expect(resolved.servers["linear"]).toEqual(
      McpServer.Http({
        url: "https://mcp.linear.app/mcp",
        headers: { Authorization: "Bearer a${HOME_DIR}b" },
      }),
    )
  })

  it("leaves out a server naming a backup secret, though the engine holds its value", () => {
    const resolved = resolveWith(
      [linear, files],
      { LINEAR_API_KEY: "lin_123", FILES_TOKEN: "f", HOME_DIR: "/h" },
      new Map(),
      ["FILES_TOKEN"],
    )
    expect(Object.keys(resolved.servers)).toEqual(["linear"])
    expect(resolved.lines).toEqual([
      "MCP server `files` was left out of this turn: the secret `FILES_TOKEN` is a backup file's, which no session is handed.",
    ])
  })

  it("leaves out a server naming a variable the engine sets for itself", () => {
    const leaky = DeclaredServer.Http({
      name: "leaky",
      url: "https://x.io/mcp",
      headers: { Authorization: "Bearer ${ORKESTRA_ENGINE_KEY}" },
    })
    const resolved = resolveServers([leaky], { ORKESTRA_ENGINE_KEY: "k" })
    expect(resolved.servers).toEqual({})
    expect(resolved.lines).toEqual([
      "MCP server `leaky` was left out of this turn: the secret `ORKESTRA_ENGINE_KEY` is one the engine sets for itself, which no session is handed.",
    ])
  })

  it("says once that the host was not asked, and dials none of its servers", () => {
    expect(hostUnasked("the host did not answer")).toEqual({
      servers: {},
      lines: ["The host's MCP servers were left out of this turn: the host did not answer."],
      skipped: new Map(),
      connections: [],
    })
  })
})

describe("a `Connection` server", () => {
  const work = DeclaredServer.Connection({ name: "linear", url: "https://mcp.linear.app/mcp" })
  const proxy = McpServer.Stdio({ command: "node", args: ["mcp-proxy.js"], env: {} })

  it("is the only kind the host is asked about", () => {
    expect(connectionsOf([linear, work, files])).toEqual([work])
  })

  it("resolves to the server the host's answer starts", () => {
    const dialed: Dialed = new Map([["linear", Either.right(proxy)]])
    expect(resolveWith([work], {}, dialed, [])).toEqual({
      servers: { linear: proxy },
      lines: [],
      skipped: new Map(),
      connections: [work],
    })
  })

  it("is left out with the host's reason, on the line a missing secret gets", () => {
    const dialed: Dialed = new Map([["linear", Either.left("the host has no linear sign-in")]])
    const resolved = resolveWith([work, files], { FILES_TOKEN: "f", HOME_DIR: "/h" }, dialed, [])
    expect(Object.keys(resolved.servers)).toEqual(["files"])
    expect(resolved.lines).toEqual([
      "MCP server `linear` was left out of this turn: the host has no linear sign-in.",
    ])
    expect([...resolved.skipped.keys()]).toEqual(["linear"])
  })
})
