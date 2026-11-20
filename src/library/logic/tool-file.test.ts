import { Either } from "effect"
import { describe, expect, it } from "vitest"
import { parseTool, toolEntry } from "./tool-file.js"

const file = (frontmatter: string, body = 'curl -fsSL "$URL" -o "$1/rclone"\n'): string =>
  `#!/bin/bash\n# ---\n${frontmatter
    .split("\n")
    .map((l) => `# ${l}`)
    .join("\n")}\n# ---\n\n${body}`

/** The parsed declaration, or the failure's path and reason — so no assertion is conditional. */
const parse = (text: string, name = "rclone"): unknown =>
  Either.match(parseTool(`tools/${name}.sh`, name, `/repo/.orkestra/tools/${name}.sh`, text), {
    onLeft: (e) => `${e.path}: ${e.reason}`,
    onRight: (t) => t,
  })

describe("a sandbox tool declaration", () => {
  it("takes its name from the file, and its description and version from the header", () => {
    expect(parse(file("description: Cloud storage sync.\nversion: 1.68.2"))).toEqual({
      name: "rclone",
      description: "Cloud storage sync.",
      version: "1.68.2",
      path: "/repo/.orkestra/tools/rclone.sh",
    })
  })

  it("refuses a header with no `version:`, naming the file and the key", () => {
    const reason = parse(file("description: d"))
    expect(reason).toContain("tools/rclone.sh")
    expect(reason).toContain("version")
  })

  it("refuses a key the header does not allow, naming the file and the key", () => {
    const reason = parse(file("description: d\nversion: v1\nplatform: linux"))
    expect(reason).toContain("tools/rclone.sh")
    expect(reason).toContain("unknown field `platform:`")
  })

  it("refuses `url:` with the reason that the script downloads the tool itself", () => {
    expect(parse(file("description: d\nversion: v1\nurl: https://x"))).toContain(
      "the script downloads the tool itself",
    )
  })

  it("refuses a version YAML reads as a number, which would lose a trailing zero", () => {
    expect(parse(file("description: d\nversion: 1.70"))).toContain("quote a version")
  })

  it("refuses a version that is not one directory name", () => {
    expect(parse(file('description: d\nversion: "../1"'))).toContain("a directory named for it")
  })

  it("refuses a name a call could not spell as a command", () => {
    expect(parse(file("description: d\nversion: v1"), "my tool")).toContain("cannot be a tool name")
  })

  it("refuses a declaration that installs nothing", () => {
    expect(parse(file("description: d\nversion: v1", ""))).toContain("has to install the tool")
  })
})

describe("a tool's entry", () => {
  it("runs the launcher with the script's path, the name and the version, then the call's arguments", () => {
    const tool = {
      name: "rclone",
      description: "d",
      version: "1.68.2",
      path: "/repo/it's/rclone.sh",
    }
    expect(toolEntry(tool, "/pkg/tool-launcher.sh")).toBe(
      `#!/bin/sh\nexec sh '/pkg/tool-launcher.sh' '/repo/it'\\''s/rclone.sh' 'rclone' '1.68.2' "$@"\n`,
    )
  })
})
