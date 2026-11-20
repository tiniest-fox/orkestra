import { Either } from "effect"
import { describe, expect, it } from "vitest"
import { McpServer } from "../../agent/types/session.js"
import { DeclaredServer, type McpFile } from "../types/mcp.js"
import { connectionsOf, type Dialed, resolveServers as resolveWith } from "./mcp-resolve.js"

const linear = DeclaredServer.Http({
  name: "linear",
  url: "https://mcp.linear.app/mcp",
  headers: { Authorization: "Bearer ${LINEAR_API_KEY}" },
})
const files = DeclaredServer.Stdio({
  name: "files",
  command: "files-mcp",
  args: ["--root", "."],
  env: { TOKEN: "${FILES_TOKEN}", ROOT: "${HOME}/work", MODE: "read" },
})
const file = (...servers: DeclaredServer[]): McpFile => ({ servers, problems: [] })
const resolveServers = (f: McpFile, env: Readonly<Record<string, string | undefined>>) =>
  resolveWith(f, env, new Map(), [])

describe("resolving the declared servers against the engine's environment", () => {
  it("fills every reference inside a string", () => {
    const resolved = resolveServers(file(linear, files), {
      LINEAR_API_KEY: "lin_123",
      FILES_TOKEN: "f",
      HOME: "/home/me",
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
    })
  })

  it("leaves out a server with an unset secret, naming the server and the secret", () => {
    const resolved = resolveServers(file(linear, files), { FILES_TOKEN: "f", HOME: "/h" })
    expect(Object.keys(resolved.servers)).toEqual(["files"])
    expect(resolved.lines).toEqual([
      "MCP server `linear` was left out of this turn: the secret `LINEAR_API_KEY` is not set in the engine's environment.",
    ])
    expect([...resolved.skipped.keys()]).toEqual(["linear"])
  })

  it("names every secret a server is missing, and counts an empty one as unset", () => {
    expect(resolveServers(file(files), { FILES_TOKEN: "" }).lines).toEqual([
      "MCP server `files` was left out of this turn: the secrets `FILES_TOKEN`, `HOME` are not set in the engine's environment.",
    ])
  })

  it("fills once, so a secret holding `${` reaches the session as it is", () => {
    const resolved = resolveServers(file(linear), { LINEAR_API_KEY: "a${HOME}b" })
    expect(resolved.servers["linear"]).toEqual(
      McpServer.Http({
        url: "https://mcp.linear.app/mcp",
        headers: { Authorization: "Bearer a${HOME}b" },
      }),
    )
  })

  it("leaves out a server naming a backup secret, though the engine holds its value", () => {
    const resolved = resolveWith(
      file(linear, files),
      { LINEAR_API_KEY: "lin_123", FILES_TOKEN: "f", HOME: "/h" },
      new Map(),
      ["FILES_TOKEN"],
    )
    expect(Object.keys(resolved.servers)).toEqual(["linear"])
    expect(resolved.lines).toEqual([
      "MCP server `files` was left out of this turn: the secret `FILES_TOKEN` is a backup file's, which no session is handed.",
    ])
  })

  it("puts the file's problems before the skips", () => {
    const resolved = resolveServers({ servers: [linear], problems: ["the file was wrong"] }, {})
    expect(resolved.lines[0]).toBe("the file was wrong")
    expect(resolved.lines).toHaveLength(2)
  })
})

describe("a `connection:` server", () => {
  const work = DeclaredServer.Connection({
    name: "linear",
    url: "https://mcp.linear.app/mcp",
    connection: "linear-work",
  })
  const proxy = McpServer.Stdio({ command: "node", args: ["mcp-proxy.js"], env: {} })

  it("is the only kind the host is asked about", () => {
    expect(connectionsOf(file(linear, work, files))).toEqual([work])
  })

  it("is the server the host's answer starts", () => {
    const dialed: Dialed = new Map([["linear", Either.right(proxy)]])
    expect(resolveWith(file(work), {}, dialed, [])).toEqual({
      servers: { linear: proxy },
      lines: [],
      skipped: new Map(),
    })
  })

  it("is left out with the host's reason, on the line a missing secret gets", () => {
    const dialed: Dialed = new Map([["linear", Either.left("the host binds no linear-work")]])
    const resolved = resolveWith(file(work, files), { FILES_TOKEN: "f", HOME: "/h" }, dialed, [])
    expect(Object.keys(resolved.servers)).toEqual(["files"])
    expect(resolved.lines).toEqual([
      "MCP server `linear` was left out of this turn: the host binds no linear-work.",
    ])
    expect([...resolved.skipped.keys()]).toEqual(["linear"])
  })
})
