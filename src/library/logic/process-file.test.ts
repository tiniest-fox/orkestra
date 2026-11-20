import { Either } from "effect"
import { describe, expect, it } from "vitest"
import { parseProcess } from "./process-file.js"

const file = (frontmatter: string, body = 'exec vite --port "$PORT"\n'): string =>
  `#!/bin/bash\n# ---\n${frontmatter
    .split("\n")
    .map((l) => `# ${l}`)
    .join("\n")}\n# ---\n\n${body}`

/** The parsed declaration, or the failure's reason — so no assertion is conditional. */
const parse = (text: string, name = "dev"): unknown =>
  Either.match(
    parseProcess(`processes/${name}.sh`, name, `/repo/.orkestra/processes/${name}.sh`, text),
    { onLeft: (e) => e.reason, onRight: (p) => p },
  )

describe("a hosted process declaration", () => {
  it("takes its name from the file and defaults to no page and thirty seconds to come up", () => {
    expect(parse(file("description: The dev server."))).toEqual({
      name: "dev",
      description: "The dev server.",
      page: false,
      readySeconds: 30,
      needs: [],
      path: "/repo/.orkestra/processes/dev.sh",
    })
  })

  it("reads `page:` and `ready_seconds:`", () => {
    expect(parse(file("description: d\npage: true\nready_seconds: 90"))).toMatchObject({
      page: true,
      readySeconds: 90,
    })
  })

  it("reads `needs:` as the names of the processes to start first", () => {
    expect(parse(file("description: d\nneeds: [web, api]"))).toMatchObject({
      needs: ["web", "api"],
    })
  })

  it("refuses `needs:` that is not a list of names", () => {
    expect(parse(file("description: d\nneeds: web"))).toContain("`needs:` a list of process names")
  })

  it("refuses `port:`, because the engine picks the port", () => {
    expect(parse(file("description: d\nport: 5173"))).toContain("the engine picks the port")
  })

  it("refuses `timeout_seconds:`, which is a check's and means nothing for a server", () => {
    expect(parse(file("description: d\ntimeout_seconds: 60"))).toContain("`ready_seconds:`")
  })

  it("refuses a name that would not make an environment variable", () => {
    expect(parse(file("description: d"), "Dev_Server")).toContain("lowercase-kebab")
  })

  it("refuses a declaration that starts nothing", () => {
    expect(parse(file("description: d", ""))).toContain("has to start something")
  })
})
