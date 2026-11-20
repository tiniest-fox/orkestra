import { describe, expect, it } from "vitest"
import { capturedEnv, environmentBlock, sandboxEnv, spawnEnv } from "./spawn-env.js"

describe("the environment a spawned process is given", () => {
  it("inherits the parent, which is how a check finds the tools a developer would", () => {
    expect(spawnEnv({ PATH: "/usr/bin", HOME: "/Users/x" }, {})).toEqual({
      PATH: "/usr/bin",
      HOME: "/Users/x",
    })
  })

  it("drops unset keys, because the child wants a string map", () => {
    expect(spawnEnv({ PATH: "/usr/bin", EMPTY: undefined }, {})).toEqual({ PATH: "/usr/bin" })
  })

  it("puts the caller's overrides on top", () => {
    expect(spawnEnv({ PATH: "/usr/bin" }, { PATH: "/opt/bin", EXTRA: "1" })).toEqual({
      PATH: "/opt/bin",
      EXTRA: "1",
    })
  })

  /**
   * The one this file exists for. A turn runs in a worktree and resolves its project
   * from where it stands; inheriting the daemon's answer makes it resolve the person's
   * project instead, and the cwd comparison that keeps one worktree's `ork` off
   * another's traks then passes.
   */
  it("keeps none of the engine's own variables, so a child cannot inherit which engine it is", () => {
    const inherited = spawnEnv(
      {
        PATH: "/usr/bin",
        ORKESTRA_PROJECT_DIR: "/Users/x/Repos/orkestra",
        ORKESTRA_API_PORT: "39756",
        ORKESTRA_CLIENT_PORT: "39757",
      },
      {},
    )
    expect(inherited).toEqual({ PATH: "/usr/bin" })
  })

  it("strips the whole family, not the three that exist today", () => {
    expect(spawnEnv({ ORKESTRA_SOMETHING_NEW: "x" }, {})).toEqual({})
  })

  it("leaves a variable that merely mentions the engine alone", () => {
    expect(spawnEnv({ MY_ORKESTRA_HOME: "/x", ORKESTRA: "/y" }, {})).toEqual({
      MY_ORKESTRA_HOME: "/x",
      ORKESTRA: "/y",
    })
  })

  it("drops Electron's run-as-Node switch, so a child reaching an Electron binary gets the app", () => {
    expect(spawnEnv({ PATH: "/opt/homebrew/bin:/usr/bin", ELECTRON_RUN_AS_NODE: "1" }, {})).toEqual(
      {
        PATH: "/opt/homebrew/bin:/usr/bin",
      },
    )
  })

  it("drops an inherited OpenAI key, which would bill Codex turns to the API instead of the subscription", () => {
    // `CODEX_API_KEY` stays: a person who sets a key named for Codex means Codex to use it.
    expect(
      spawnEnv({ OPENAI_API_KEY: "sk-x", CODEX_API_KEY: "ck-y", PATH: "/usr/bin" }, {}),
    ).toEqual({ CODEX_API_KEY: "ck-y", PATH: "/usr/bin" })
  })

  it("drops a Claude credential a host blanked, inherited or forwarded into a sandbox, and keeps a set one", () => {
    const parent = { CLAUDE_CODE_OAUTH_TOKEN: "", ANTHROPIC_API_KEY: "", OTHER: "" }
    expect(spawnEnv(parent, {})).toEqual({ OTHER: "" })
    expect(sandboxEnv(parent, {}, ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"])).toEqual({})
    expect(spawnEnv({ CLAUDE_CODE_OAUTH_TOKEN: "set" }, {})).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "set",
    })
  })

  it("keeps the Cloudflare credentials, which a CLI reads to publish a proof", () => {
    const credentials = { CLOUDFLARE_API_TOKEN: "cf-x", CLOUDFLARE_ACCOUNT_ID: "acct" }
    expect(spawnEnv(credentials, {})).toEqual(credentials)
  })

  it("still lets a caller send one deliberately — the strip is on what was inherited", () => {
    expect(spawnEnv({ ORKESTRA_API_PORT: "39756" }, { ORKESTRA_API_PORT: "44134" })).toEqual({
      ORKESTRA_API_PORT: "44134",
    })
  })
})

describe("the variables an env script left exported", () => {
  it("reads NUL-separated records, splitting each at its first `=`", () => {
    expect(capturedEnv("PATH=/opt/bin:/usr/bin\0RUBY_OPTS=-W0=x\0")).toEqual({
      PATH: "/opt/bin:/usr/bin",
      RUBY_OPTS: "-W0=x",
    })
  })

  it("keeps a value that spans lines, which an exported function does", () => {
    expect(capturedEnv("BASH_FUNC_x%%=() {  echo hi\n}\0HOME=/Users/x\0")).toEqual({
      "BASH_FUNC_x%%": "() {  echo hi\n}",
      HOME: "/Users/x",
    })
  })

  it("drops a record that is not a variable, and the empty one after the last NUL", () => {
    expect(capturedEnv("garbage\0=nameless\0A=1\0")).toEqual({ A: "1" })
    expect(capturedEnv("")).toEqual({})
  })

  it("strips what the inherited base strips: a script re-exporting the engine's variables puts the leak back", () => {
    expect(
      capturedEnv(
        "ORKESTRA_PROJECT_DIR=/Users/x/Repos/orkestra\0ELECTRON_RUN_AS_NODE=1\0OPENAI_API_KEY=sk-x\0A=1\0",
      ),
    ).toEqual({ A: "1" })
  })
})

describe("what a spawn is handed", () => {
  it("leaves out an inherited variable the caller withholds, and still takes one laid over", () => {
    expect(spawnEnv({ PATH: "/usr/bin", KEY: "k" }, {}, ["KEY"])).toEqual({ PATH: "/usr/bin" })
    expect(spawnEnv({ KEY: "k" }, { KEY: "sent" }, ["KEY"])).toEqual({ KEY: "sent" })
  })
})

describe("what a sandboxed spawn is handed", () => {
  it("takes only the named inherited variables, under its explicit env", () => {
    expect(
      sandboxEnv(
        { PATH: "/usr/bin", HOME: "/Users/x", GH_TOKEN: "gh", TOKEN: "t", UNSET: undefined },
        { GH_TOKEN: "explicit", A: "1" },
        ["GH_TOKEN", "TOKEN", "UNSET", "ABSENT"],
      ),
    ).toEqual({ GH_TOKEN: "explicit", TOKEN: "t", A: "1" })
  })

  it("writes NUL-ended records and an empty one, so a value may hold a newline", () => {
    expect(environmentBlock({ A: "1", B: "two\nlines" })).toBe("A=1\0B=two\nlines\0\0")
    expect(environmentBlock({})).toBe("\0")
  })
})
